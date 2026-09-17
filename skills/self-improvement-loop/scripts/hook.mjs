#!/usr/bin/env node
// Trigger adapter: turns the ledger's `brief` into context the agent sees without
// having to remember to ask. Wire it as a session-start / prompt-submit hook (see
// references/triggers.md) or call it from an entry file.
//
// Contract: print nothing when there is nothing to say, never exit non-zero, never
// block a session. A hook that fails, or that nags with no content, gets disabled by
// its user — which would silently remove the only part of this loop that is not
// dependent on the agent remembering.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Hooks are invoked with varying cwd; prefer the platform-provided project root.
const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd())
const ledger = join(root, '.learnings', 'ledger.mjs')

if (!existsSync(ledger)) process.exit(0)

// Drain stdin. Hook events deliver a JSON payload (and Claude Code waits for the
// pipe to close before proceeding), but the payload is not needed here. When stdin is
// a terminal there is no pipe to drain - run immediately instead of hanging forever.
let ran = false
if (process.stdin.isTTY) {
  run()
} else {
  try { process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', run); process.stdin.on('error', run) } catch { run() }
}
function run() {
  if (ran) return
  ran = true
  try {
    const r = spawnSync(process.execPath, [ledger, 'brief', '--root', root], { encoding: 'utf8', timeout: 5000 })
    const out = (r.stdout || '').trim()
    if (out) process.stdout.write(out + '\n')
  } catch { /* never break the session over a learning reminder */ }
  process.exit(0)
}
