# Ledger contract

The ledger is the machine source of truth for the whole series. Every command in
`promoting-learnings` and `verifying-learnings` operates on it through
`scripts/ledger.mjs`. Hand-editing the JSONL is never required and usually wrong.

## Files

| Path | Role |
|---|---|
| `.learnings/ledger.jsonl` | Active entries, one JSON object per line |
| `.learnings/archive.jsonl` | Rolled-up entries (still searchable) |
| `.learnings/inbox/*.json` | Staging area; `ingest` consumes and deletes these |
| `.learnings/DIGEST.md` | Regenerated human view — never hand-edit |

## Entry schema

```jsonc
{
  "id": "lrn-ab12cd34",          // sha1(normalized pattern_key), script-generated
  "kind": "learning",            // learning | error | feature
  "category": "correction",      // correction | knowledge_gap | best_practice
  "area": "tests",               // frontend|backend|infra|tests|docs|config|process
  "priority": "high",            // critical | high | medium | low
  "summary": "one line",
  "details": "context, not a transcript",
  "action": "next time, do X",
  "pattern_key": "symptom-slug", // stable identity; drives dedupe + promotion
  "status": "open",              // open|watching|ineffective|resolved|wont_fix
  "logged": "ISO-8601",
  "first_seen": "ISO-8601",
  "last_seen": "ISO-8601",
  "recurrence": 1,               // bumped automatically on re-ingest of same key
  "tasks": ["task-name"],        // distinct tasks; promotion needs >= 2
  "files": ["path/to/file"],
  "promoted_to": null,           // "CLAUDE.md#build" once promoted
  "watch": null,                 // observable predicate, e.g. "npm install in a diff"
  "verified": null,             // { at, result: held|recurred, note }
  "forced_promotion": null      // { at, reason } when promoted below threshold via --force
}
```

## Status lifecycle

```
open ──promote──► watching ──verify held──► resolved
                     │
                     └──verify recurred──► ineffective ──rewrite──► watching
open ──wont_fix──────────────────────────────────────────────► wont_fix
```

`rollup` archives only `resolved` / `wont_fix` entries idle past the cutoff. Nothing
is deleted.

## Commands

| Command | Purpose |
|---|---|
| `ingest` | Consume `inbox/*.json`; dedupe by identity; bump recurrence |
| `list [--status X] [--area Y] [--kind Z]` | Filter active entries |
| `stats [--budget N]` | Counts, budget overruns, recurrence-after-promotion % |
| `digest` | Regenerate `DIGEST.md` |
| `promote <id> --watch W [--target T] [--force --reason R]` | Set `watching`, attach predicate; refuses below threshold or without `--watch` |
| `verify <id> --result <held\|recurred> [--note N]` | Record verdict; `recurred` → `ineffective` (idempotent — re-recording does not inflate recurrence) |
| `status <id> <status>` | Set status; unknown values are rejected, common spellings normalized |
| `rollup [--days N]` | Archive closed, idle entries (default 30 days) |

All commands take `--root <path>` to operate on a project other than the cwd. A refused
operation prints `{"error": ...}` **and exits non-zero** — check the exit code.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, or `help` |
| 1 | Unknown command, or an operation that was refused (bad id, invalid status, below promotion threshold, missing `--watch`) |
