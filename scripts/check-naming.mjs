#!/usr/bin/env node
// Enforce the naming rule: `ratchet` is an alias for humans reading docs. It may appear
// in Markdown and nowhere else — code, config, and file paths carry the skill's real
// name, `self-improvement-loop`, because those are what the machine identifies it by.
//
// Run in CI (exit 1 fails the build) or by hand before committing a rename.
//
// Usage: node scripts/check-naming.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = 'self-improvement-loop'
const ALIAS = 'ratchet'
const DOC_EXT = new Set(['.md', '.mdx'])
// This file has to spell the alias out to define the rule, so it exempts itself. Kept as
// an exact path rather than a pattern: widening it would let the alias creep into code.
const SELF = 'scripts/check-naming.mjs'

const offenders = []
let scanned = 0

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    const rel = relative(root, full).replace(/\\/g, '/')
    scanned++

    // the rule's own definition file is the only place a non-Markdown alias is allowed
    if (rel === SELF) continue

    // 1. a file path must never carry the alias
    if (basename(rel).toLowerCase().includes(ALIAS)) {
      offenders.push(`${rel}: the file NAME contains the alias; paths use ${SKILL}`)
    }

    // 2. the alias may only appear inside Markdown
    let text
    try { text = readFileSync(full, 'utf8') } catch { continue }
    const isDoc = DOC_EXT.has(extname(rel).toLowerCase())
    if (isDoc) continue
    text.split('\n').forEach((line, i) => {
      if (new RegExp(`\\b${ALIAS}\\b`, 'i').test(line)) {
        offenders.push(`${rel}:${i + 1}: the alias appears in a non-Markdown file\n      ${line.trim().slice(0, 120)}`)
      }
    })
  }
}
walk(root)

if (offenders.length) {
  console.error(`naming rule violated — "${ALIAS}" is a docs-only alias; the identifier is "${SKILL}":\n`)
  offenders.forEach((o) => console.error('  - ' + o))
  console.error(`\n${offenders.length} problem(s) across ${scanned} files`)
  process.exit(1)
}
console.log(`naming ok — "${ALIAS}" appears only in Markdown; ${scanned} files scanned`)
