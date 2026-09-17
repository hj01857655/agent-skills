#!/usr/bin/env node
// Deterministic ledger ops for the self-improvement skill series. Zero deps, Node 18+.
// The JSONL ledger is the machine truth; Markdown digests are regenerated views.
// Deterministic identity makes dedupe exact and recurrence counters meaningful.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
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

const now = () => new Date().toISOString()
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const emit = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n')
const days = (n) => n * 86400000
const str = (v) => (typeof v === 'string' ? v : undefined)

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
  fn(row)
  writeJsonl(rows, ledgerPath)
  return row
}

function stats() {
  const rows = readJsonl(ledgerPath)
  const archived = readJsonl(archivePath)
  const count = (f) => rows.reduce((a, r) => { const k = f(r); a[k] = (a[k] || 0) + 1; return a }, {})
  const promoted = rows.filter((r) => r.promoted_to)
  const recurred = promoted.filter((r) => r.verified && r.verified.result === 'recurred')
  const budget = Number(str(flag.budget) || 25)
  const byArea = count((r) => r.area)
  return {
    active: rows.length, archived: archived.length,
    by_status: count((r) => r.status), by_area: byArea,
    promoted: promoted.length,
    recurrence_after_promotion_pct: promoted.length ? Math.round((recurred.length / promoted.length) * 100) : null,
    over_budget: Object.entries(byArea).filter(([, n]) => n > budget).map(([a, n]) => a + ':' + n),
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

const commands = {
  ingest, stats, digest,
  rollup: () => rollup(Number(str(flag.days) || 30)),
  status: () => mutate(pos[0], (r) => { r.status = pos[1] }),
  promote: () => mutate(pos[0], (r) => {
    r.status = 'watching'
    if (str(flag.target)) r.promoted_to = str(flag.target)
    if (str(flag.watch)) r.watch = str(flag.watch)
  }),
  verify: () => mutate(pos[0], (r) => {
    r.verified = { at: now(), result: flag.result, note: str(flag.note) || '' }
    if (flag.result === 'recurred') { r.status = 'ineffective'; r.recurrence = (r.recurrence || 1) + 1; r.last_seen = now() }
    else r.status = 'resolved'
  }),
  list: () => readJsonl(ledgerPath).filter((r) =>
    (!flag.status || r.status === flag.status) && (!flag.area || r.area === flag.area) && (!flag.kind || r.kind === flag.kind))
}

if (!commands[cmd]) {
  process.stdout.write('usage: ledger.mjs <ingest|list|stats|digest|rollup|status|promote|verify> [args]\n')
  process.exit(cmd === 'help' ? 0 : 1)
}
emit(commands[cmd]())
