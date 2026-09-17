#!/usr/bin/env node
// Deterministic ledger ops for the self-improvement loop. Zero deps, Node 18+.
// The JSONL ledger is the machine truth; Markdown digests are regenerated views.
// Deterministic identity makes dedupe exact and recurrence counters meaningful.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
const emit = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n')
const days = (n) => n * 86400000
const str = (v) => (typeof v === 'string' ? v : undefined)

const ALLOWED_STATUS = ['open', 'watching', 'ineffective', 'resolved', 'wont_fix']
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
    if (r.verified && !ALLOWED_RESULT.includes(r.verified.result)) push(r.id, 'invalid verified.result: ' + r.verified.result)
    if (!r.tasks || r.tasks.length === 0) push(r.id, 'no task recorded (promotion needs >= 2 distinct tasks)')
    const k = identityKey(r)
    if (byKey.has(k)) push(r.id, 'identity collides with ' + byKey.get(k) + ' - merge them')
    else byKey.set(k, r.id)
  }
  return { active: rows.length, archived: archived.length, ok: issues.length === 0, issues }
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
    r.status = 'watching'
    r.watch = watch
    if (str(flag.target)) r.promoted_to = str(flag.target)
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
  merge: () => merge(pos[0], pos[1])
}

if (!commands[cmd]) {
  process.stdout.write('usage: ledger.mjs <ingest|list|stats|digest|rollup|status|promote|verify|merge|doctor> [args]\n')
  process.exit(cmd === 'help' ? 0 : 1)
}
// Only mutations take the lock; reads are harmless alongside a writer.
const WRITES = new Set(['ingest', 'rollup', 'status', 'promote', 'verify', 'merge'])
const result = WRITES.has(cmd) ? withLock(() => commands[cmd]()) : commands[cmd]()
emit(result)
// A refused operation must not exit 0, or a caller that checks the exit code sees success.
// A dirty `doctor` result is also a failure, so CI can gate on it.
if (result && (result.error || (cmd === 'doctor' && result.ok === false))) process.exit(1)
