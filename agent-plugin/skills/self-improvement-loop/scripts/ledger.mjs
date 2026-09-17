#!/usr/bin/env node
// Deterministic ledger ops for the self-improvement loop. Zero deps, Node 18+.
// The JSONL ledger is the machine truth; Markdown digests are regenerated views.
// Deterministic identity makes dedupe exact and recurrence counters meaningful.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const cmd = argv[0] || 'help'
const flag = {}
const pos = []
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { pos.push(a); continue }
  const k = a.slice(2)
  const n = argv[i + 1]
  if (n === undefined || n.startsWith('--')) flag[k] = true
  else { flag[k] = n; i++ }
}

const root = resolve(typeof flag.root === 'string' ? flag.root : process.cwd())
const dir = join(root, '.learnings')
const ledgerPath = join(dir, 'ledger.jsonl')
const archivePath = join(dir, 'archive.jsonl')
const inboxDir = join(dir, 'inbox')
const digestPath = join(dir, 'DIGEST.md')
const lockPath = join(dir, 'ledger.lock')

// Every mutation is read-modify-write on one file: two overlapping runs would each
// read the ledger and the second write would silently discard the first. The lock
// makes that impossible; a lock older than the threshold is treated as abandoned.
const LOCK_STALE_MS = 10000
const withLock = (fn) => {
  mkdirSync(dir, { recursive: true })
  let acquired = false
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' })
      acquired = true
    } catch {
      const stale = existsSync(lockPath) && (Date.now() - statSync(lockPath).mtimeMs) > LOCK_STALE_MS
      if (!stale) return { error: 'ledger is locked by another process (' + lockPath + '); retry in a moment' }
      try { unlinkSync(lockPath) } catch { /* another process may have released it */ }
    }
  }
  if (!acquired) return { error: 'could not acquire ledger lock at ' + lockPath }
  try { return fn() } finally { try { unlinkSync(lockPath) } catch { /* already gone */ } }
}

const now = () => new Date().toISOString()
// Unicode-safe: `\p{L}\p{N}` keeps CJK and every other script. Stripping to
// [a-z0-9] collapsed every non-Latin pattern_key to '' — and therefore to one
// shared identity — silently merging unrelated entries into a single row.
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
// `brief` returns plain text for verbatim context injection: an empty result must
// print nothing at all, not a blank line (a reminder that fires with no content is
// what teaches everyone to ignore it).
const emit = (o) => {
  if (typeof o === 'string') {
    if (o) process.stdout.write(o + '\n')
    return
  }
  process.stdout.write(JSON.stringify(o, null, 2) + '\n')
}
const days = (n) => n * 86400000
const str = (v) => (typeof v === 'string' ? v : undefined)

const ALLOWED_STATUS = ['open', 'watching', 'enforced', 'ineffective', 'resolved', 'wont_fix']
const ALLOWED_RESULT = ['held', 'recurred']
// Accept the obvious spellings (`wontfix`, `Wont Fix`) but never keep an unknown
// status: rollup only archives resolved/wont_fix, so a typo'd status would make an
// entry immortal with no error anywhere.
const canonicalStatus = (s) => {
  const v = String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (ALLOWED_STATUS.includes(v)) return v
  const loose = v.replace(/_/g, '')
  return ALLOWED_STATUS.find((x) => x.replace(/_/g, '') === loose) || null
}

const readJsonl = (p) => existsSync(p)
  ? readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
  : []
const writeJsonl = (rows, p) => writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))

// Identity IS the pattern key: the same problem yields the same id, so a repeat
// bumps a counter instead of creating a twin entry.
const identityKey = (e) => norm(e.pattern_key || e.summary)
const makeId = (e) => {
  const p = e.kind === 'error' ? 'err' : e.kind === 'feature' ? 'feat' : 'lrn'
  return p + '-' + createHash('sha1').update(identityKey(e)).digest('hex').slice(0, 8)
}

function ingest() {
  mkdirSync(inboxDir, { recursive: true })
  const rows = readJsonl(ledgerPath)
  const byKey = new Map(rows.map((r) => [identityKey(r), r]))
  const report = { added: [], bumped: [], skipped: [] }
  for (const f of readdirSync(inboxDir).filter((n) => n.endsWith('.json'))) {
    const p = join(inboxDir, f)
    let entry
    try { entry = JSON.parse(readFileSync(p, 'utf8')) } catch { report.skipped.push({ file: f, reason: 'invalid JSON' }); continue }
    if (!entry.summary) { report.skipped.push({ file: f, reason: 'missing summary' }); continue }
    const hit = byKey.get(identityKey(entry))
    if (hit) {
      hit.recurrence = (hit.recurrence || 1) + 1
      hit.last_seen = now()
      hit.tasks = [...new Set([...(hit.tasks || []), ...(entry.task ? [entry.task] : [])])]
      hit.files = [...new Set([...(hit.files || []), ...(entry.files || [])])]
      if (entry.priority) hit.priority = entry.priority
      report.bumped.push({ id: hit.id, recurrence: hit.recurrence })
    } else {
      const row = {
        id: makeId(entry), kind: entry.kind || 'learning',
        category: entry.category || 'correction', area: entry.area || 'process',
        priority: entry.priority || 'medium', summary: entry.summary,
        details: entry.details || '', action: entry.action || '',
        pattern_key: entry.pattern_key || '', status: 'open',
        logged: now(), first_seen: now(), last_seen: now(), recurrence: 1,
        tasks: entry.task ? [entry.task] : [], files: entry.files || [],
        promoted_to: null, watch: null, verified: null
      }
      rows.push(row)
      byKey.set(identityKey(row), row)
      report.added.push({ id: row.id, summary: row.summary })
    }
    unlinkSync(p)
  }
  writeJsonl(rows, ledgerPath)
  return report
}

function mutate(id, fn) {
  const rows = readJsonl(ledgerPath)
  const row = rows.find((r) => r.id === id)
  if (!row) return { error: 'no such id: ' + id }
  const refused = fn(row)
  if (refused && refused.error) return refused
  writeJsonl(rows, ledgerPath)
  return row
}

function stats() {
  const rows = readJsonl(ledgerPath)
  const archived = readJsonl(archivePath)
  const count = (f) => rows.reduce((a, r) => { const k = f(r); a[k] = (a[k] || 0) + 1; return a }, {})
  // Lifetime promotion metrics include archived rows: pruning the ledger must not
  // reset the headline recurrence rate exactly when the history matters most.
  const lifetime = [...rows, ...archived]
  const promoted = lifetime.filter((r) => r.promoted_to)
  const recurred = promoted.filter((r) => r.verified && r.verified.result === 'recurred')
  const budget = Number(str(flag.budget) || 25)
  const byArea = count((r) => r.area)
  // Budget applies to work still in play; counting closed entries would force a prune
  // of things that already proved out.
  const openByArea = rows
    .filter((r) => r.status !== 'resolved' && r.status !== 'wont_fix')
    .reduce((a, r) => { a[r.area] = (a[r.area] || 0) + 1; return a }, {})
  return {
    active: rows.length, archived: archived.length,
    by_status: count((r) => r.status), by_area: byArea, open_by_area: openByArea,
    promoted: promoted.length,
    recurrence_after_promotion_pct: promoted.length ? Math.round((recurred.length / promoted.length) * 100) : null,
    awaiting_verification: rows.filter((r) => r.status === 'watching').length,
    watchlist: rows.filter((r) => r.status === 'watching').map((r) => ({ id: r.id, watch: r.watch, target: r.promoted_to })),
    // Rules a command now checks for us. These need no review discipline: `check` fails
    // on them. Counting them separately is the point — it is the difference between
    // rules that depend on attention and rules that do not.
    enforced_total: rows.filter((r) => r.status === 'enforced' && r.guard).length,
    over_budget: Object.entries(openByArea).filter(([, n]) => n > budget).map(([a, n]) => a + ':' + n),
    top_recurring: rows.slice().sort((a, b) => (b.recurrence || 1) - (a.recurrence || 1)).slice(0, 5)
      .map((r) => ({ id: r.id, key: r.pattern_key || r.summary, recurrence: r.recurrence, status: r.status }))
  }
}

function digest() {
  const rows = readJsonl(ledgerPath)
  const order = { critical: 0, high: 1, medium: 2, low: 3 }
  const areas = [...new Set(rows.map((r) => r.area))].sort()
  const lines = ['# Learning digest', '', '> Regenerated by `ledger.mjs digest`. Do not hand-edit.', '']
  for (const a of areas) {
    const items = rows.filter((r) => r.area === a)
      .sort((x, y) => (order[x.priority] - order[y.priority]) || ((y.recurrence || 1) - (x.recurrence || 1)))
    lines.push('## ' + a, '')
    for (const r of items) {
      const watch = r.watch ? ' — watch: ' + r.watch : ''
      lines.push('- **' + r.id + '** [' + r.status + '/' + r.priority + ' x' + (r.recurrence || 1) + '] ' + r.summary + watch)
    }
    lines.push('')
  }
  writeFileSync(digestPath, lines.join('\n'))
  return { path: digestPath, entries: rows.length }
}

// The trigger half of the loop. Every other command depends on the agent remembering
// to run it; this one is meant to be injected verbatim into context by a hook or entry
// file. It prints plain text (not JSON) for that reason, and prints *nothing* when
// there is nothing to report - a reminder that fires with no content is what teaches
// everyone to ignore it.
function brief() {
  const rows = readJsonl(ledgerPath)
  const max = Number(str(flag.max) || 5)
  const watching = rows.filter((r) => r.status === 'watching')
  const ineffective = rows.filter((r) => r.status === 'ineffective')
  const ready = rows.filter((r) => r.status === 'open' && isEligible(r))
  const unguarded = watching.length
  const lines = []
  if (watching.length) {
    lines.push('[learnings] ' + unguarded + ' rule(s) awaiting verification - check whether each recurrence happened:')
    for (const r of watching.slice(0, max)) lines.push('  - ' + r.id + ': ' + r.watch)
    const guardable = watching.filter((r) => r.watch)
    if (guardable.length) lines.push('  (' + guardable.length + ' of these could become a guard: `ledger.mjs enforce <id> --cmd "..."` and stop reviewing them by hand)')
  }
  if (ineffective.length) {
    lines.push('[learnings] ' + ineffective.length + ' rule(s) marked ineffective - rewrite or automate, do not re-promote the same wording:')
    for (const r of ineffective.slice(0, max)) lines.push('  - ' + r.id + ': ' + r.summary)
  }
  if (ready.length) {
    lines.push('[learnings] ' + ready.length + ' entr(y/ies) at the promotion threshold - promote with a watch predicate, or say why not:')
    for (const r of ready.slice(0, max)) lines.push('  - ' + r.id + ' (x' + (r.recurrence || 1) + '): ' + r.summary)
  }
  return lines.join('\n')
}

function rollup(cutoffDays) {
  const rows = readJsonl(ledgerPath)
  const cutoff = Date.now() - days(cutoffDays)
  const keep = []
  const move = []
  for (const r of rows) {
    const closed = r.status === 'resolved' || r.status === 'wont_fix'
    const stale = new Date(r.last_seen || r.logged).getTime() < cutoff
    if (closed && stale) move.push(r); else keep.push(r)
  }
  if (move.length) writeJsonl([...readJsonl(archivePath), ...move], archivePath)
  writeJsonl(keep, ledgerPath)
  return { archived: move.length, remaining: keep.length }
}

// Extraction is the step past promotion: a rule that has held long enough to become a
// reusable technique is worth a skill of its own. The scaffold is deliberately a
// skeleton, not prose - filling it requires judgment this script cannot supply.
const slug = (s) => String(s || '').normalize('NFKC').toLowerCase().trim()
  .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unnamed-skill'

function extract(id) {
  const rows = readJsonl(ledgerPath)
  const row = rows.find((r) => r.id === id)
  if (!row) return { error: 'no such id: ' + id }
  if (row.extracted_to && !flag.force) return { error: 'already extracted to ' + row.extracted_to + ' (use --force to redo)' }

  const outDir = resolve(str(flag.dir) || join(root, 'skills', slug(row.pattern_key || row.summary)))
  if (existsSync(outDir) && !flag.force) return { error: 'directory already exists: ' + outDir + ' (use --force to overwrite)' }
  mkdirSync(outDir, { recursive: true })

  const name = slug(row.pattern_key || row.summary)
  const skillPath = join(outDir, 'SKILL.md')
  // description = when to use, never a workflow summary; the trigger comes from the
  // pattern_key so the new skill is discoverable by the same symptom that produced it.
  const body = [
    '---',
    'name: ' + name,
    'description: Use when ' + (row.summary || name).replace(/\s+/g, ' ').trim() + '.',
    'metadata:',
    '  version: 0.1.0',
    '  extracted_from: ' + row.id,
    '---',
    '',
    '# ' + name,
    '',
    '<!-- Skeleton generated by self-improvement-loop extract. It is a starting point,\n     not a finished skill: fill the sections, then test it the way you would test code. -->',
    '',
    '## When to use',
    '',
    'TODO: the symptoms that mean this applies — concrete and observable.',
    '',
    '## Core pattern',
    '',
    'Rule: ' + (row.action || 'TODO: state the rule as "do X" or "never Y".'),
    '',
    'Why it holds: ' + (row.details || 'TODO: the mechanism, not the incident.'),
    '',
    '## Before / after',
    '',
    '```',
    'TODO: one example, from real work. Before is what went wrong; after is what the rule produces.',
    '```',
    '',
    '## Common mistakes',
    '',
    '| Mistake | Correction |',
    '|---|---|',
    '| TODO | TODO |',
    '',
    '## Evidence',
    '',
    'Extracted from ledger entry `' + row.id + '` (recurrence ' + (row.recurrence || 1) + ', tasks: ' + ((row.tasks || []).join(', ') || 'none recorded') + ').',
    ''
  ].join('\n')
  writeFileSync(skillPath, body)

  row.extracted_to = skillPath
  if (!row.status || row.status === 'watching') row.status = 'resolved'
  writeJsonl(rows, ledgerPath)
  return { id: row.id, skill: skillPath, name, next: 'Fill the TODO sections, then verify the skill behaves as intended before relying on it.' }
}

// Promotion is gated, not advisory: the SKILL.md thresholds are enforced here, so a
// rule cannot enter the watch phase without evidence and a way to be verified.
const isEligible = (r) => (r.recurrence || 1) >= 3 || (r.category === 'correction' && (r.recurrence || 1) >= 2)
// A vague pattern_key is the one defect that silently corrupts everything downstream
// (dedupe, recurrence, promotion), so it is worth surfacing on demand.
const VAGUE_KEY = /^(fix|bug|issue|problem|error|thing|stuff|misc|tmp|test|other|问题|修复|错误)$/i

function doctor() {
  const rows = readJsonl(ledgerPath)
  const archived = readJsonl(archivePath)
  const issues = []
  const push = (id, problem) => issues.push({ id: id || '(no id)', problem })
  const byKey = new Map()
  for (const r of rows) {
    if (!r.id) push(r.id, 'missing id')
    if (!ALLOWED_STATUS.includes(r.status)) push(r.id, 'invalid status: ' + r.status)
    if (!r.summary) push(r.id, 'missing summary')
    if (!r.pattern_key) push(r.id, 'missing pattern_key (identity falls back to summary)')
    else if (VAGUE_KEY.test(String(r.pattern_key).trim())) push(r.id, 'pattern_key too vague to be an identity: ' + r.pattern_key)
    if ((r.status === 'watching' || r.promoted_to) && !r.watch) push(r.id, 'promoted/watching without a watch predicate')
    if (r.status === 'watching' && !r.promoted_to) push(r.id, 'watching but placed nowhere (no promoted_to) - promote with --target or revert to open')
    if (r.promoted_to && r.status === 'watching' && (new Date() - new Date(r.last_seen || r.logged)) > 90 * 86400000) push(r.id, 'watching for over 90 days without a verdict - verify or demote')
    if (r.verified && !ALLOWED_RESULT.includes(r.verified.result)) push(r.id, 'invalid verified.result: ' + r.verified.result)
    if (!r.tasks || r.tasks.length === 0) push(r.id, 'no task recorded (promotion needs >= 2 distinct tasks)')
    const k = identityKey(r)
    if (byKey.has(k)) push(r.id, 'identity collides with ' + byKey.get(k) + ' - merge them')
    else byKey.set(k, r.id)
  }
  return { active: rows.length, archived: archived.length, ok: issues.length === 0, issues }
}

// --- Compiled rules -------------------------------------------------------------
// A rule that lives only as prose is verified by nothing: whether it held is a human
// judgement made from memory. This turns the watch predicate into an executable guard,
// so "did the rule hold?" becomes an exit code the agent — and CI — can read.
// This is the step past watching: watch asks a human to notice, enforce makes the
// violation fail on its own.

const runGuard = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: Number(str(flag.timeout) || 60000) })
  // A command that could not even start must not be read as "the rule is violated" — a
  // broken guard has to be distinguishable from a regression, or a typo in the guard
  // marks the rule as failed and teaches everyone to ignore the check. The signal
  // differs by shell: POSIX shells exit 127, cmd.exe exits 9009, and some shells only
  // say so in the text.
  const text = String((r.stderr || '') + (r.stdout || ''))
  const couldNotRun = r.error != null || r.status === 127 || r.status === 9009 ||
    /command not found|not recognized as an internal|No such file or directory/i.test(text)
  return { code: r.status, broken: couldNotRun, output: text.trim().slice(0, 2000) }
}

function enforce(id) {
  const cmd = str(flag.cmd)
  if (!cmd) return { error: '--cmd "<guard command>" is required; the guard must exit non-zero when the rule is violated' }
  const rows = readJsonl(ledgerPath)
  const row = rows.find((r) => r.id === id)
  if (!row) return { error: 'no such id: ' + id }
  if (!row.promoted_to && !flag.force) {
    return { error: 'entry is not promoted (no promoted_to); enforce a rule that has a home, or pass --force' }
  }
  // Prove the guard is meaningful before trusting it: run it once now. A guard that is
  // already failing is a false alarm, and one that passes by doing nothing is worse.
  const probe = runGuard(cmd, root)
  row.guard = { cmd, added: now() }
  row.guard_result = { at: now(), code: probe.code, broken: probe.broken, output: probe.output, phase: 'probe' }
  row.status = probe.broken ? row.status : 'enforced'
  writeJsonl(rows, ledgerPath)
  return {
    id: row.id, status: row.status, guard: cmd,
    probe: probe.broken ? 'BROKEN - command could not run (check the path/quoting); not marking enforced'
      : probe.code === 0 ? 'clean - exits 0 now, which is what a passing guard looks like'
      : 'FAILING NOW - the guard already reports a violation; fix the violation or the guard',
    next: 'Add `ledger.mjs check` to your test/CI command so a regression fails the build.'
  }
}

function check() {
  const rows = readJsonl(ledgerPath)
  const guards = rows.filter((r) => r.guard && r.guard.cmd && r.status !== 'wont_fix')
  const failures = []
  const broken = []
  for (const row of guards) {
    const res = runGuard(row.guard.cmd, root)
    const wasFailing = row.guard_result && row.guard_result.code !== 0 && !row.guard_result.broken
    row.guard_result = { at: now(), code: res.code, broken: res.broken, output: res.output, phase: 'check' }
    if (res.broken) {
      broken.push({ id: row.id, cmd: row.guard.cmd, output: res.output })
      continue
    }
    if (res.code !== 0) {
      failures.push({ id: row.id, cmd: row.guard.cmd, output: res.output, summary: row.summary })
      row.status = 'ineffective'
      // Idempotent per the same rule as `verify`: one ongoing violation is one
      // regression, not one per run, or a broken build would inflate recurrence.
      if (!wasFailing) { row.recurrence = (row.recurrence || 1) + 1; row.last_seen = now() }
    } else if (row.status === 'ineffective' && row.guard_result.code === 0) {
      row.status = 'enforced'
    }
  }
  writeJsonl(rows, ledgerPath)
  return {
    ran: guards.length, passed: guards.length - failures.length - broken.length,
    regressed: failures, broken_guards: broken, enforced_total: rows.filter((r) => r.status === 'enforced').length
  }
}

// Two entries can end up describing one problem (a renamed pattern_key, or a key that
// used to normalize to ''). Merging folds the evidence together instead of deleting it.
function merge(keepId, dropId) {
  const rows = readJsonl(ledgerPath)
  const keep = rows.find((r) => r.id === keepId)
  const drop = rows.find((r) => r.id === dropId)
  if (!keep) return { error: 'no such id: ' + keepId }
  if (!drop) return { error: 'no such id: ' + dropId }
  if (keep.id === drop.id) return { error: 'cannot merge an entry into itself' }
  keep.recurrence = (keep.recurrence || 1) + (drop.recurrence || 1)
  keep.tasks = [...new Set([...(keep.tasks || []), ...(drop.tasks || [])])]
  keep.files = [...new Set([...(keep.files || []), ...(drop.files || [])])]
  if (drop.details && !keep.details) keep.details = drop.details
  keep.last_seen = [keep.last_seen, drop.last_seen].filter(Boolean).sort().pop() || keep.last_seen
  drop.status = 'wont_fix'
  drop.merged_into = keep.id
  drop.merged_at = now()
  writeJsonl(rows, ledgerPath)
  return { kept: keep.id, dropped: drop.id, recurrence: keep.recurrence, tasks: keep.tasks.length }
}

const commands = {
  ingest, stats, digest,
  rollup: () => rollup(Number(str(flag.days) || 30)),
  status: () => {
    const next = canonicalStatus(pos[1])
    if (!next) return { error: 'invalid status: ' + pos[1] + ' (allowed: ' + ALLOWED_STATUS.join(', ') + ')' }
    return mutate(pos[0], (r) => { r.status = next })
  },
  promote: () => mutate(pos[0], (r) => {
    if (!isEligible(r) && !flag.force) {
      return { error: 'below promotion threshold: recurrence=' + (r.recurrence || 1) + ' (need >= 3, or >= 2 for a correction); use --force --reason "<why>" to override' }
    }
    if (flag.force && !str(flag.reason)) return { error: '--force requires --reason "<why this rule is promoted early>"' }
    const watch = str(flag.watch)
    if (!watch) return { error: '--watch "<observable predicate>" is required; a rule with no predicate can never be verified' }
    // Required, not optional: a rule that is "under watch" but placed nowhere is just an
    // open entry, and `stats` counts promoted by target — so allowing it would make the
    // status and the metric disagree.
    const target = str(flag.target)
    if (!target) return { error: '--target "<where the rule now lives>" is required (e.g. "CLAUDE.md#build"); one rule, one home' }
    r.status = 'watching'
    r.watch = watch
    r.promoted_to = target
    if (flag.force) r.forced_promotion = { at: now(), reason: str(flag.reason) }
  }),
  verify: () => {
    if (!ALLOWED_RESULT.includes(flag.result)) return { error: 'invalid --result: ' + flag.result + ' (allowed: ' + ALLOWED_RESULT.join(', ') + ')' }
    return mutate(pos[0], (r) => {
      const prev = r.verified ? r.verified.result : null
      r.verified = { at: now(), result: flag.result, note: str(flag.note) || '' }
      if (flag.result === 'recurred') {
        r.status = 'ineffective'
        // Idempotent: re-recording the same verdict must not inflate recurrence,
        // which is the input to the promotion threshold.
        if (prev !== 'recurred') { r.recurrence = (r.recurrence || 1) + 1; r.last_seen = now() }
      } else {
        r.status = 'resolved'
      }
    })
  },
  list: () => readJsonl(ledgerPath).filter((r) =>
    (!flag.status || r.status === flag.status) && (!flag.area || r.area === flag.area) && (!flag.kind || r.kind === flag.kind)),
  doctor,
  merge: () => merge(pos[0], pos[1]),
  extract: () => extract(pos[0]),
  enforce: () => enforce(pos[0]),
  check,
  brief
}

if (!commands[cmd]) {
  process.stdout.write('usage: ledger.mjs <ingest|list|stats|digest|rollup|status|promote|verify|merge|doctor|extract|enforce|check|brief> [args]\n')
  process.exit(cmd === 'help' ? 0 : 1)
}
// Only mutations take the lock; reads are harmless alongside a writer.
const WRITES = new Set(['ingest', 'rollup', 'status', 'promote', 'verify', 'merge', 'extract', 'enforce', 'check'])
const result = WRITES.has(cmd) ? withLock(() => commands[cmd]()) : commands[cmd]()
emit(result)
// A refused operation must not exit 0, or a caller that checks the exit code sees success.
// A dirty `doctor` result is also a failure, so CI can gate on it.
if (result && (result.error || (cmd === 'check' && result.regressed && result.regressed.length > 0) || (cmd === 'doctor' && result.ok === false))) process.exit(1)
