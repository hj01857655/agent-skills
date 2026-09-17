#!/usr/bin/env node
// Install / uninstall / inspect this skill across every agent platform present on this
// machine.
//
// Platforms are discovered by probing known skill roots rather than guessing: a root
// counts only if the platform's own directory exists, so this never creates a directory
// for an agent you do not have.
//
//   install.mjs              install into every platform found
//   install.mjs --dry-run    print the plan, touch nothing
//   install.mjs --list       show which platforms were detected
//   install.mjs --status     show where the skill is currently installed
//   install.mjs --uninstall  remove it from every platform that has a copy
//   install.mjs --only claude,breezell[,cursor]   limit to named platforms
//
// Uninstalling by hand across 23 roots is how copies get left behind; `--uninstall` is
// the other half of `install`.
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs'
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

// [id, label, skill root, gate] — `gate` is the platform's own directory: if it is absent,
// the agent is not installed here and we leave no trace. `id` is what `--only` takes:
// matching on the display label would fail for multi-word names (`claude` vs `Claude Code`).
const PLATFORMS = [
  ['breezell',        'Breezell',        join(H, '.breezell', 'skills'),                join(H, '.breezell')],
  ['claude',          'Claude Code',     join(H, '.claude', 'skills'),                  join(H, '.claude')],
  ['codex',           'Codex CLI',       join(H, '.codex', 'skills'),                   join(H, '.codex')],
  ['agents',          'Agent hub',       join(H, '.agents', 'skills'),                  join(H, '.agents')],
  ['cursor',          'Cursor',          join(H, '.cursor', 'skills'),                  join(H, '.cursor')],
  ['windsurf',        'Windsurf',        join(H, '.codeium', 'windsurf', 'skills'),     join(H, '.codeium')],
  ['windsurf-dir',    'Windsurf (dir)',  join(H, '.windsurf', 'skills'),                join(H, '.windsurf')],
  ['gemini',          'Gemini CLI',      join(H, '.gemini', 'skills'),                  join(H, '.gemini')],
  ['antigravity',     'Antigravity',     join(H, '.gemini', 'antigravity', 'skills'),   join(H, '.gemini', 'antigravity')],
  ['antigravity-ide', 'Antigravity IDE', join(H, '.antigravity-ide', 'skills'),         join(H, '.antigravity-ide')],
  ['copilot',         'GitHub Copilot',  join(H, '.copilot', 'skills'),                 join(H, '.copilot')],
  ['cline',           'Cline',           join(H, '.cline', 'skills'),                   join(H, '.cline')],
  ['continue',        'Continue',        join(H, '.continue', 'skills'),                join(H, '.continue')],
  ['kiro',            'Kiro',            join(H, '.kiro', 'skills'),                    join(H, '.kiro')],
  ['workbuddy',       'WorkBuddy',       join(H, '.workbuddy', 'skills'),               join(H, '.workbuddy')],
  ['qoderwork',       'QoderWork',       join(H, '.qoderwork', 'skills'),               join(H, '.qoderwork')],
  ['grok',            'Grok',            join(H, '.grok', 'skills'),                    join(H, '.grok')],
  ['amp',             'Amp',             join(H, '.amp', 'skills'),                     join(H, '.amp')],
  ['trae',            'Trae',            join(H, '.trae', 'skills'),                    join(H, '.trae')],
  ['zcode',           'ZCode',           join(H, '.zcode', 'skills'),                   join(H, '.zcode')],
  ['factory',         'Factory',         join(H, '.factory', 'skills'),                 join(H, '.factory')],
  ['devin',           'Devin',           join(H, '.devin', 'skills'),                   join(H, '.devin')],
  ['codebuddy',       'CodeBuddy',       join(H, '.codebuddy', 'skills'),               join(H, '.codebuddy')]
]
const ids = PLATFORMS.map((p) => p[0])

const only = typeof flag.only === 'string' ? flag.only.split(',').map((s) => s.trim().toLowerCase()) : null
const selected = (p) => !only || only.includes(p[0])
const unknown = only ? only.filter((o) => !ids.includes(o)) : []
const installedAt = (root) => existsSync(join(root, skillName, 'SKILL.md'))

// Some of these roots are owned by a package manager that keeps its own manifest
// (.agents uses `npx skills`, .breezell uses the skillhub store). A skill copied in by
// hand is absent from that manifest, so the manager may prune it on its next write.
// Warn rather than pretend the install is durable.
const foreignManagers = (root) => {
  const found = []
  for (const p of [join(root, '..', '.skill-lock.json'), join(root, '.skills_store_lock.json')]) {
    if (existsSync(p)) found.push(p)
  }
  return found
}

if (flag.list) {
  for (const [id, label, root, gate] of PLATFORMS) {
    const state = existsSync(gate) ? 'present' : 'absent '
    console.log(`${state}  ${id.padEnd(16)} ${label.padEnd(18)} ${root}`)
  }
  console.log('\nUsage: install.mjs [--dry-run] [--status] [--uninstall] [--only <id,id>]')
  process.exit(0)
}

if (unknown.length) {
  console.error(`unknown platform id(s): ${unknown.join(', ')}\nknown ids: ${ids.join(', ')}`)
  process.exit(1)
}

if (flag.status) {
  let count = 0
  for (const [, label, root, gate] of PLATFORMS) {
    if (!existsSync(gate)) continue
    const there = installedAt(root)
    if (there) count++
    console.log(`${there ? 'installed ' : 'absent    '} ${label.padEnd(18)} ${root}`)
  }
  console.log(`\n${count} platform(s) have a copy`)
  process.exit(0)
}

const uninstalling = !!flag.uninstall

const results = []
for (const platform of PLATFORMS) {
  const [id, label, root, gate] = platform
  if (!selected(platform)) continue
  if (!existsSync(gate)) { results.push({ label, root, action: 'skip', why: 'platform not installed' }); continue }
  const dest = join(root, skillName)
  const exists = installedAt(root)

  if (uninstalling) {
    if (!exists) { results.push({ label, root, action: 'skip', why: 'no copy' }); continue }
    if (flag['dry-run']) { results.push({ label, root, action: 'would-remove', why: 'dry run' }); continue }
    try { rmSync(dest, { recursive: true, force: true }); results.push({ label, root, action: 'removed' }) }
    catch (e) { results.push({ label, root, action: 'failed', why: e.message }) }
    continue
  }

  if (flag['dry-run']) { results.push({ label, root, action: exists ? 'overwrite' : 'install', why: 'dry run' }); continue }
  try {
    mkdirSync(root, { recursive: true })
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    cpSync(skillDir, dest, { recursive: true })
    // Never copy this installer into the installed copy — running it there would
    // resolve its own directory as the source and recurse into a growing tree.
    rmSync(join(dest, 'scripts', 'install.mjs'), { force: true })
    const managers = foreignManagers(root)
    results.push({ label, root, action: exists ? 'updated' : 'installed', managers })
  } catch (e) {
    results.push({ label, root, action: 'failed', why: e.message })
  }
}

const width = Math.max(...results.map((r) => r.label.length))
for (const r of results) {
  const mark = r.action === 'skip' ? '-' : r.action === 'failed' ? '!' : r.action === 'removed' ? 'x' : '+'
  console.log(`${mark} ${r.label.padEnd(width)}  ${r.action}${r.why ? ' (' + r.why + ')' : ''}  ${r.root}`)
}
const OK = ['installed', 'updated', 'removed']
const done = results.filter((r) => OK.includes(r.action)).length
const failed = results.filter((r) => r.action === 'failed').length
const verb = uninstalling ? 'removed' : 'installed'
console.log(`\n${done} ${verb}, ${results.filter((r) => r.action === 'skip').length} skipped, ${failed} failed`)

// Report roots whose skills are owned by another manifest-based manager.
const managed = [...new Set(results.filter((r) => r.managers && r.managers.length).map((r) => r.label))]
if (managed.length && !uninstalling) {
  console.log(`\nnote: ${managed.join(', ')} keep a manifest that does not list this skill.`)
  console.log('      A package manager operating there may prune it; re-run this installer if it disappears.')
}
if (flag['dry-run']) console.log('(dry run — nothing was written)')
if (failed) process.exit(1)
