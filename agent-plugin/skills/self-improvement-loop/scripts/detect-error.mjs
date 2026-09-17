#!/usr/bin/env node
// Failure detector: remind only when a tool call failed in a way worth recording.
//
// Wire to PostToolUseFailure (which carries error_message / error_type), NOT to
// PostToolUse with a regex over the tool output: PostToolUse fires only after a tool
// *succeeded*, and the CLAUDE_TOOL_OUTPUT env var it used to expose is deprecated.
//
// Contract: print nothing on success, on expected failures, or on a repeat of a failure
// already surfaced moments ago. Always exit 0 — a hook that breaks the session gets
// uninstalled, which would silently remove the reminder.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd())
const dir = join(root, '.learnings')
const ledger = join(dir, 'ledger.mjs')
const statePath = join(dir, '.hook-state.json')

// Nothing to remind about if the loop was never set up in this project.
if (!existsSync(ledger)) process.exit(0)

// Output channel matters as much as detection. For PostToolUse-type events Claude Code
// does NOT add plain stdout to context - it writes it to the debug log. The reminder only
// reaches the model as JSON `hookSpecificOutput.additionalContext`. Emitting plain text
// here was a silent no-op: the hook ran, matched, and nothing arrived. (UserPromptSubmit
// and SessionStart are the events that DO accept plain stdout, which is why hook.mjs can
// print text.)
const reminderFor = (tool, detail) => [
  '[learnings] a tool call failed in a way that may be worth recording:',
  '  ' + tool + ': ' + truncate(detail, 200),
  '  Apply the write gate (non-obvious? expensive? generalizable? actionable? not already known?).',
  '  If it passes: node .learnings/ledger.mjs ingest, after queueing a finding in .learnings/inbox/.'
].join('\n')
const contextPayload = (event, text) => JSON.stringify({
  hookSpecificOutput: { hookEventName: event || 'PostToolUseFailure', additionalContext: text }
})
const EXPECTED = [
  /\bcommand not found\b/i,
  /\bno such file or directory\b/i,
  /\bmissing script\b/i,
  /\bunknown option\b/i,
  /\bnot found: /i,
  /\bENOENT\b/i
]
// A repeat within this window is the same incident, not a new one.
const DEDUPE_MS = 10 * 60 * 1000

let ran = false
if (process.stdin.isTTY) {
  process.exit(0)
} else {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => { buf += c })
  process.stdin.on('end', () => run(buf))
  process.stdin.on('error', () => run(''))
}

function run(raw) {
  if (ran) return
  ran = true
  try {
    let payload = {}
    try { payload = JSON.parse(raw || '{}') } catch { /* a non-JSON payload is not our business */ }

    const tool = String(payload.tool_name || 'tool')
    const message = String(payload.error_message || payload.error || '').trim()
    if (!message) process.exit(0)

    // The stable part of a failure message is the `Exit code N` first line; the rest is
    // display text. So classify against the WHOLE message (a typo's "command not found"
    // is on a later line) but dedupe on the whole message too — keying on the first line
    // alone would make every failure look like the same one.
    if (EXPECTED.some((re) => re.test(message))) process.exit(0)
    const detail = message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(1).join(' ') || message
    const signature = tool + ': ' + detail

    // Suppress repeats of the same failure so a broken command in a loop cannot nag.
    const seen = readState()
    const key = createHash('sha1').update(signature.replace(/\s+/g, ' ')).digest('hex').slice(0, 10)
    const prior = seen[key]
    const now = Date.now()
    if (prior && now - prior < DEDUPE_MS) process.exit(0)
    seen[key] = now
    writeState(prune(seen, now))

    process.stdout.write(contextPayload(payload.hook_event_name, reminderFor(tool, detail)) + '\n')
  } catch { /* never break the session over a reminder */ }
  process.exit(0)
}

function readState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')) || {} } catch { return {} }
}

function writeState(state) {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(statePath, JSON.stringify(state)) } catch { /* best effort */ }
}

// Keep the state file from growing forever.
function prune(state, now) {
  const out = {}
  for (const [k, t] of Object.entries(state)) if (now - t < DEDUPE_MS) out[k] = t
  return out
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}
