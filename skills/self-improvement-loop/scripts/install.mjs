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

// [id, label, native skill root, gate, extra roots]
//
// The roster follows the official Agent Skills showcase (46 products,
// https://agentskills.io/clients) rather than whatever happens to be installed here —
// probing only the local machine silently omits every platform you do not have, which is
// how a platform count ends up understated. `gate` is the platform's own directory: if it
// is absent the agent is not installed and we leave no trace. `extra` lists the shared
// compatibility roots the platform also reads; those are separate entries below, so a
// single install there covers a whole group.
//
// Paths verified against each vendor's docs are marked (docs). The rest are the
// conventional `~/.<id>/skills` layout and are flagged rather than asserted.
const PLATFORMS = [
  // --- verified against vendor documentation ---
  ['claude',          'Claude Code',      join(H, '.claude', 'skills'),                  join(H, '.claude'), ['.agents']],
  ['codex',           'Codex CLI',        join(H, '.codex', 'skills'),                   join(H, '.codex'), ['.agents']],
  ['copilot',         'GitHub Copilot',   join(H, '.copilot', 'skills'),                 join(H, '.copilot'), ['.claude', '.agents']],
  ['cursor',          'Cursor',           join(H, '.cursor', 'skills'),                  join(H, '.cursor'), ['.claude', '.agents']],
  ['gemini',          'Gemini CLI',       join(H, '.gemini', 'skills'),                  join(H, '.gemini'), []],
  ['antigravity',     'Antigravity',      join(H, '.gemini', 'antigravity', 'skills'),   join(H, '.gemini', 'antigravity'), ['.agents']],
  ['antigravity-ide', 'Antigravity IDE',  join(H, '.antigravity-ide', 'skills'),         join(H, '.antigravity-ide'), ['.agents']],
  ['opencode',        'OpenCode',         join(H, '.config', 'opencode', 'skills'),      join(H, '.config', 'opencode'), ['.claude', '.agents']],
  ['goose',           'Goose',            join(H, '.config', 'goose', 'skills'),         join(H, '.config', 'goose'), ['.agents']],
  ['roo',             'Roo Code',         join(H, '.roo', 'skills'),                     join(H, '.roo'), ['.claude']],
  // OpenHands reads the shared `.agents` root (its legacy `.openhands/` dir is deprecated),
  // so it gates on that and dedupes against the `agents` entry below.
  ['openhands',       'OpenHands',        join(H, '.agents', 'skills'),                  join(H, '.agents'), ['.claude']],
  ['kiro',            'Kiro',             join(H, '.kiro', 'skills'),                    join(H, '.kiro'), ['.claude']],
  ['trae',            'TRAE',             join(H, '.trae', 'skills'),                    join(H, '.trae'), ['.claude']],
  ['amp',             'Amp',              join(H, '.amp', 'skills'),                     join(H, '.amp'), ['.claude']],

  // --- shared compatibility roots: one install covers the group above ---
  ['agents',          'Shared .agents',   join(H, '.agents', 'skills'),                  join(H, '.agents'), []],

  // --- regional editions ship separate data directories, confirmed against vendor docs ---
  // WorkBuddy: Tencent ships a domestic build (`~/.workbuddy`) and an international one
  // (workbuddy.ai → `~/.workbuddy-ai`). They are distinct products with distinct models,
  // not one product with a renamed folder.
  ['workbuddy-ai',    'WorkBuddy (intl)', join(H, '.workbuddy-ai', 'skills'),            join(H, '.workbuddy-ai'), []],
  // Trae: trae.cn (domestic) → `~/.trae-cn`; trae.ai (international) → `~/.trae`.
  ['trae-cn',         'TRAE CN',          join(H, '.trae-cn', 'skills'),                 join(H, '.trae-cn'), ['.claude']],
  // Qoder: Qoder CN is a separate product line from Qoder international.
  ['qoder',           'Qoder',            join(H, '.qoder', 'skills'),                   join(H, '.qoder'), []],
  // iFlow CLI (心流): user settings live in `~/.iflow`, project in `.iflow/`.
  ['iflow',           'iFlow CLI',        join(H, '.iflow', 'skills'),                   join(H, '.iflow'), []],

  // --- conventional ~/.<id>/skills layout (not individually verified) ---
  ['breezell',        'Breezell',         join(H, '.breezell', 'skills'),                join(H, '.breezell'), []],
  ['cline',           'Cline',            join(H, '.cline', 'skills'),                   join(H, '.cline'), ['.claude']],
  ['continue',        'Continue',         join(H, '.continue', 'skills'),                join(H, '.continue'), ['.claude']],
  ['windsurf',        'Windsurf',         join(H, '.codeium', 'windsurf', 'skills'),     join(H, '.codeium'), ['.claude']],
  ['windsurf-dir',    'Windsurf (dir)',   join(H, '.windsurf', 'skills'),                join(H, '.windsurf'), ['.claude']],
  ['junie',           'Junie',            join(H, '.junie', 'skills'),                   join(H, '.junie'), ['.claude']],
  ['firebender',      'Firebender',       join(H, '.firebender', 'skills'),              join(H, '.firebender'), ['.claude']],
  ['factory',         'Factory / Piebald', join(H, '.factory', 'skills'),                join(H, '.factory'), ['.agents']],
  ['letta',           'Letta',            join(H, '.letta', 'skills'),                   join(H, '.letta'), []],
  ['mux',             'Mux',              join(H, '.mux', 'skills'),                     join(H, '.mux'), []],
  ['ona',             'Ona',              join(H, '.ona', 'skills'),                     join(H, '.ona'), ['.claude']],
  ['qodo',            'Qodo',             join(H, '.qodo', 'skills'),                    join(H, '.qodo'), []],
  ['tabnine',         'Tabnine',          join(H, '.tabnine', 'skills'),                 join(H, '.tabnine'), []],
  ['vibe',            'Mistral AI Vibe',  join(H, '.vibe', 'skills'),                    join(H, '.vibe'), []],
  ['commandcode',     'Command Code',     join(H, '.commandcode', 'skills'),             join(H, '.commandcode'), []],
  ['deepcode',        'Deep Code',        join(H, '.deepcode', 'skills'),                join(H, '.deepcode'), []],
  // OpenClaw loads, highest precedence first: workspace `/skills`, project
  // `.agents/skills`, personal `~/.agents/skills` (docs.openclaw.ai/tools/skills). There is
  // no `~/.openclaw/skills` root — an earlier revision of this file invented one.
  ['openclaw',        'OpenClaw',         join(H, '.agents', 'skills'),                  join(H, '.agents'), []],
  // DeepSeek Harness (dsh) scans `~/.agents/skills` at startup; same SKILL.md contract.
  ['dsh',             'DeepSeek Harness', join(H, '.agents', 'skills'),                  join(H, '.agents'), []],
  // VT Code reads `.agents/skills` and Claude-compatible paths.
  ['vtcode',          'VT Code',          join(H, '.agents', 'skills'),                  join(H, '.agents'), ['.claude']],
  ['hermes',          'Hermes Agent',     join(H, '.hermes', 'skills'),                  join(H, '.hermes'), []],
  ['autohand',        'Autohand Code CLI', join(H, '.autohand', 'skills'),               join(H, '.autohand'), []],
  ['zeroclaw',        'ZeroClaw',         join(H, '.zeroclaw', 'skills'),                join(H, '.zeroclaw'), []],
  ['vita',            'Vita',             join(H, '.vita', 'skills'),                    join(H, '.vita'), []],
  ['emdash',          'Emdash',           join(H, '.emdash', 'skills'),                  join(H, '.emdash'), []],
  ['bub',             'bub',              join(H, '.bub', 'skills'),                     join(H, '.bub'), []],
  ['pi',              'pi',               join(H, '.pi', 'skills'),                      join(H, '.pi'), []],
  ['nanobot',         'nanobot',          join(H, '.nanobot', 'skills'),                 join(H, '.nanobot'), []],
  ['superconductor',  'Superconductor',   join(H, '.superconductor', 'skills'),          join(H, '.superconductor'), []],
  ['openclaw-ws',     'OpenClaw (workspace)', join(H, '.openclaw', 'workspace', 'skills'), join(H, '.openclaw'), []],
  ['workshop',        'Workshop',         join(H, '.workshop', 'skills'),                join(H, '.workshop'), []],
  ['workbuddy',       'WorkBuddy',        join(H, '.workbuddy', 'skills'),               join(H, '.workbuddy'), []],
  ['qoderwork',       'QoderWork',        join(H, '.qoderwork', 'skills'),               join(H, '.qoderwork'), []],
  ['grok',            'Grok',             join(H, '.grok', 'skills'),                    join(H, '.grok'), []],
  ['zcode',           'ZCode',            join(H, '.zcode', 'skills'),                   join(H, '.zcode'), []],
  ['devin',           'Devin',            join(H, '.devin', 'skills'),                   join(H, '.devin'), []],
  ['codebuddy',       'CodeBuddy',        join(H, '.codebuddy', 'skills'),               join(H, '.codebuddy'), ['.claude']]
]

// Products in the official showcase with no installable filesystem root: they consume
// skills through their own API, package manager, or hosting. Listed so the gap is
// explicit rather than silent. See references/platforms.md.
const NO_LOCAL_ROOT = [
  'Claude (app)', 'VS Code (project .github/skills)', 'Agentman', 'Databricks Genie Code',
  'Snowflake Cortex Code', 'Google AI Edge Gallery', 'Laravel Boost', 'Pulumi Neo',
  'Spring AI', 'fast-agent', 'ChatGPT (app)'
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
  let local = 0
  for (const [id, label, root, gate, extra] of PLATFORMS) {
    const state = existsSync(gate) ? 'present' : 'absent '
    if (existsSync(gate)) local++
    const compat = extra && extra.length ? '  + ' + extra.join(',') : ''
    console.log(`${state}  ${id.padEnd(16)} ${label.padEnd(20)} ${root}${compat}`)
  }
  console.log(`\n${PLATFORMS.length} platform entries; ${local} present on this machine`)
  console.log(`${NO_LOCAL_ROOT.length} showcase products have no local root (see references/platforms.md):`)
  console.log(`  ${NO_LOCAL_ROOT.join(', ')}`)
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

// Two entries can name the same root (OpenHands reads the shared `.agents` root, which is
// also its own entry). Install once per distinct destination; report every milestone
// under the first label that owns it.
const seenRoots = new Set()
const results = []
for (const platform of PLATFORMS) {
  const [id, label, root, gate] = platform
  if (!selected(platform)) continue
  if (seenRoots.has(root)) { results.push({ label, root, action: 'same-as-above' }); continue }
  seenRoots.add(root)
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
  const mark = r.action === 'skip' ? '-' : r.action === 'failed' ? '!' : r.action === 'removed' ? 'x' : r.action === 'same-as-above' ? '=' : '+'
  console.log(`${mark} ${r.label.padEnd(width)}  ${r.action}${r.why ? ' (' + r.why + ')' : ''}  ${r.root}`)
}
const OK = ['installed', 'updated', 'removed']
const done = results.filter((r) => OK.includes(r.action)).length
const failed = results.filter((r) => r.action === 'failed').length
const verb = uninstalling ? 'removed' : 'installed'
console.log(`\n${done} ${verb}, ${results.filter((r) => r.action === 'skip').length} skipped, ${results.filter((r) => r.action === 'same-as-above').length} shared-root, ${failed} failed`)
if (flag['dry-run']) console.log('(dry run — nothing was written)')
if (failed) process.exit(1)
