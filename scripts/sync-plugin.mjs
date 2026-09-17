#!/usr/bin/env node
// Regenerate the portable Agent Plugins 1.0 bundle from `skills/` (canonical).
//
// The portable package is a copy, so it drifts the moment `skills/` changes. Run this
// after editing any skill, then commit the result — publishing a stale bundle means
// `npx skills add` / plugin installs ship a skill that is not what the repo says it is.
//
// Usage: node scripts/sync-plugin.mjs [--check]
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(root, 'skills')
const bundle = join(root, 'agent-plugin')
const bundleSkills = join(bundle, 'skills')
const check = process.argv.includes('--check')

if (!existsSync(skillsDir)) {
  console.error('no skills/ directory — run from the repo root')
  process.exit(1)
}

const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md')))
  .map((d) => d.name)

if (!names.length) {
  console.error('no skill directories with SKILL.md found')
  process.exit(1)
}

if (check) {
  // Verify the bundle matches the source without writing anything.
  const drift = []
  for (const name of names) {
    const src = join(skillsDir, name, 'SKILL.md')
    const dst = join(bundleSkills, name, 'SKILL.md')
    if (!existsSync(dst)) { drift.push(`missing in bundle: ${name}`); continue }
    if (readFileSync(src, 'utf8') !== readFileSync(dst, 'utf8')) drift.push(`content differs: ${name}`)
  }
  if (drift.length) { console.error(drift.join('\n')); process.exit(1) }
  console.log(`bundle up to date (${names.length} skill(s))`)
  process.exit(0)
}

mkdirSync(bundleSkills, { recursive: true })
// Replace skill copies only — plugin.json is authored, not generated.
for (const name of names) {
  const dest = join(bundleSkills, name)
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  cpSync(join(skillsDir, name), dest, {
    recursive: true,
    // The installer is repo tooling, not part of a distributed skill.
    filter: (src) => !src.endsWith(join('scripts', 'install.mjs'))
  })
}
console.log(`synced ${names.length} skill(s) into agent-plugin/skills/: ${names.join(', ')}`)
