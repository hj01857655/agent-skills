#!/usr/bin/env node
// Install the skill into every agent platform present on this machine.
//
// Platforms are discovered by probing known skill roots rather than guessing: a root
// counts only if its parent platform directory already exists, so this never creates a
// directory for an agent you do not have. `--dry-run` prints the plan without touching
// anything.
//
// Usage: node scripts/install.mjs [--dry-run] [--only claude,breezell,...] [--list]
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skillDir = resolve(here, '..')
const skillName = 'self-improvement-loop'

const argv = process.argv.slice(2)
const flag = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const k = a.slice(2)
  const n = argv[i + 1]
  if (n === undefined || n.startsWith('--')) flag[k] = true
  else { flag[k] = n; i++ }
}

const H = homedir()

// [label, skill root, gate] — `gate` is the platform's own directory: if it is absent,
// the agent is not installed here and we leave no trace.
const PLATFORMS = [
  ['Breezell',        join(H, '.breezell', 'skills'),                join(H, '.breezell')],
  ['Claude Code',     join(H, '.claude', 'skills'),                  join(H, '.claude')],
  ['Codex CLI',       join(H, '.codex', 'skills'),                   join(H, '.codex')],
  ['Agent hub',       join(H, '.agents', 'skills'),                  join(H, '.agents')],
  ['Cursor',          join(H, '.cursor', 'skills'),                  join(H, '.cursor')],
  ['Windsurf',        join(H, '.codeium', 'windsurf', 'skills'),     join(H, '.codeium')],
  ['Windsurf (dir)',  join(H, '.windsurf', 'skills'),                join(H, '.windsurf')],
  ['Gemini CLI',      join(H, '.gemini', 'skills'),                  join(H, '.gemini')],
  ['Antigravity',     join(H, '.gemini', 'antigravity', 'skills'),   join(H, '.gemini', 'antigravity')],
  ['Antigravity IDE', join(H, '.antigravity-ide', 'skills'),         join(H, '.antigravity-ide')],
  ['GitHub Copilot',  join(H, '.copilot', 'skills'),                 join(H, '.copilot')],
  ['Cline',           join(H, '.cline', 'skills'),                   join(H, '.cline')],
  ['Continue',        join(H, '.continue', 'skills'),                join(H, '.continue')],
  ['Kiro',            join(H, '.kiro', 'skills'),                    join(H, '.kiro')],
  ['WorkBuddy',       join(H, '.workbuddy', 'skills'),               join(H, '.workbuddy')],
  ['QoderWork',       join(H, '.qoderwork', 'skills'),               join(H, '.qoderwork')],
  ['Grok',            join(H, '.grok', 'skills'),                    join(H, '.grok')],
  ['Amp',             join(H, '.amp', 'skills'),                     join(H, '.amp')],
  ['Trae',            join(H, '.trae', 'skills'),                    join(H, '.trae')],
  ['ZCode',           join(H, '.zcode', 'skills'),                   join(H, '.zcode')],
  ['Factory',         join(H, '.factory', 'skills'),                 join(H, '.factory')],
  ['Devin',           join(H, '.devin', 'skills'),                   join(H, '.devin')],
  ['CodeBuddy',       join(H, '.codebuddy', 'skills'),               join(H, '.codebuddy')]
]

const only = typeof flag.only === 'string' ? flag.only.split(',').map((s) => s.trim().toLowerCase()) : null
const selected = (p) => !only || only.includes(p[0].toLowerCase())

if (flag.list) {
  for (const [label, root, gate] of PLATFORMS) {
    const state = existsSync(gate) ? 'present' : 'absent '
    console.log(`${state}  ${label.padEnd(18)} ${root}`)
  }
  console.log('\nUsage: node scripts/install.mjs [--dry-run] [--only claude,breezell]')
  process.exit(0)
}

const results = []
for (const platform of PLATFORMS) {
  const [label, root, gate] = platform
  if (!selected(platform)) continue
  if (!existsSync(gate)) { results.push({ label, root, action: 'skip', why: 'platform not installed' }); continue }
  const dest = join(root, skillName)
  const exists = existsSync(join(dest, 'SKILL.md'))
  if (flag['dry-run']) { results.push({ label, root, action: exists ? 'overwrite' : 'install', why: 'dry run' }); continue }
  try {
    mkdirSync(root, { recursive: true })
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    cpSync(skillDir, dest, { recursive: true })
    // Never copy this installer into the installed copy — running it there would
    // resolve its own directory as the source and recurse into a growing tree.
    rmSync(join(dest, 'scripts', 'install.mjs'), { force: true })
    results.push({ label, root, action: exists ? 'updated' : 'installed' })
  } catch (e) {
    results.push({ label, root, action: 'failed', why: e.message })
  }
}

const width = Math.max(...results.map((r) => r.label.length))
for (const r of results) {
  const mark = r.action === 'skip' ? '-' : r.action === 'failed' ? '!' : '+'
  console.log(`${mark} ${r.label.padEnd(width)}  ${r.action}${r.why ? ' (' + r.why + ')' : ''}  ${r.root}`)
}
const done = results.filter((r) => ['installed', 'updated'].includes(r.action)).length
const failed = results.filter((r) => r.action === 'failed').length
console.log(`\n${done} installed, ${results.filter((r) => r.action === 'skip').length} skipped, ${failed} failed`)
if (flag['dry-run']) console.log('(dry run — nothing was written)')
if (failed) process.exit(1)
