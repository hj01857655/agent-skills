# Ledger contract

The ledger is the machine source of truth for the loop. Every command in the
Promote and Verify phases operates on it through `scripts/ledger.mjs`. Hand-editing
the JSONL is never required and usually wrong.

## Files

| Path | Role |
|---|---|
| `.learnings/ledger.jsonl` | Active entries, one JSON object per line |
| `.learnings/archive.jsonl` | Rolled-up entries (still searchable) |
| `.learnings/inbox/*.json` | Staging area; `ingest` consumes and deletes these |
| `.learnings/DIGEST.md` | Regenerated human view — never hand-edit |
| `.learnings/config.json` | The loop's own policy (thresholds) + its tuning history |
| `.learnings/hook.mjs` | Optional; vendored trigger adapter for platforms with hooks |
| `.learnings/detect-error.mjs` | Optional; vendored failure detector for `PostToolUseFailure` |
| `.learnings/.hook-state.json` | Failure-dedupe state for `detect-error.mjs`; safe to delete |
| `.learnings/ledger.lock` | Transient write lock; absent when idle |

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
  "status": "open",              // open|watching|enforced|ineffective|resolved|wont_fix
  "logged": "ISO-8601",
  "first_seen": "ISO-8601",
  "last_seen": "ISO-8601",
  "recurrence": 1,               // bumped automatically on re-ingest of same key
  "tasks": ["task-name"],        // distinct tasks; promotion needs >= 2
  "files": ["path/to/file"],
  "promoted_to": null,           // "CLAUDE.md#Build" once promoted
  "rule": null,                  // { id, file, section, text, sha, written_at } - the rule actually written
  "home_state": null,            // ok | deleted | drifted, from the last `check`
  "watch": null,                 // observable predicate, e.g. "npm install in a diff"
  "verified": null,              // { at, result: held|recurred, note } - stated level
  "probe_result": null,          // { at, result, note } - behavioral level
  "verify_level": null,          // artifact | behavior | stated - the strongest evidence held
  "last_probe": null,            // ISO-8601; drives the probe-due list in `brief`
  "forced_promotion": null,      // { at, reason } when promoted below threshold via --force
  "merged_into": null,           // id of the surviving entry when merged via `merge`
  "extracted_to": null,          // SKILL.md path once extracted via `extract`
  "guard": null,                 // { cmd, added } once enforced
  "guard_result": null           // { at, code, broken, output, phase } from the last probe or check
}
```

## Status lifecycle

```
open ──promote──► watching ──verify held──► resolved
  │                  │  │
  │                  │  └──enforce──► enforced ◄──┐
  │                  │                  │         │
  │                  └──verify recurred─┘         │
  │                            │                  │
  │                            ▼                  │
  │                       ineffective ──check fails─┤
  │                            │                  │
  │                            └──rewrite─────────┘
open ──wont_fix────────────────────────────────────► wont_fix
```

`enforced` is the strongest state: the rule is checked by a command, not by attention.
`check` demotes an enforced rule back to `ineffective` when its guard fails, and restores
`enforced` when the guard passes again.

`rollup` archives only `resolved` / `wont_fix` entries idle past the cutoff. Nothing
is deleted.

## Commands

| Command | Purpose |
|---|---|
| `ingest` | Consume `inbox/*.json`; dedupe by identity; bump recurrence |
| `list [--status X] [--area Y] [--kind Z]` | Filter active entries |
| `stats [--budget N]` | Counts, budget overruns, recurrence-after-promotion % |
| `digest` | Regenerate `DIGEST.md` |
| `promote <id> --watch W --target T [--rule R] [--force --reason R]` | **Writes** the rule into `T` (`FILE#Section`) behind a marker; refuses below threshold, without `--watch`, or without `--target` |
| `verify <id> --result <held\|recurred> [--note N]` | Record verdict; `recurred` → `ineffective` (idempotent — re-recording does not inflate recurrence) |
| `status <id> <status>` | Set status; unknown values are rejected, common spellings normalized |
| `merge <keep-id> <drop-id>` | Fold a duplicate into the surviving entry; the dropped one is marked `wont_fix` with `merged_into` |
| `extract <id> [--dir D] [--force]` | Generate a new skill skeleton from a settled rule; records `extracted_to` |
| `doctor` | Check ledger integrity: duplicate ids, invalid statuses, missing fields, promoted rules without a predicate, rules watching over 90 days |
| `enforce <id> --cmd C [--force] [--timeout MS]` | Compile a rule into an executable guard; probes it once and only marks `enforced` if it is clean |
| `probe <id> --result <held\|recurred> [--note N]` | Behavioral verification: the situation was reconstructed. Sets `verify_level: behavior` |
| `check` | Run every guard **and verify every rule is still in its home**; failing ones become `ineffective` and the command exits 1 (for CI) |
| `audit [--apply]` | Measure the loop's own funnel and retune `config.json` thresholds from observed outcomes |
| `brief [--max N]` | Plain-text reminder for context injection: watching / ineffective / promotion-ready entries; prints nothing when clean |
| `rollup [--days N]` | Archive closed, idle entries (default 30 days) |

All commands take `--root <path>` to operate on a project other than the cwd. A refused
operation prints `{"error": ...}` **and exits non-zero** — check the exit code.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, or `help` |
| 1 | Unknown command, or an operation that was refused (bad id, invalid status, below promotion threshold, missing `--watch` or `--target`) |
| 1 | `doctor` also exits 1 when it finds integrity problems, so CI can gate on it |
| 1 | `check` exits 1 when an enforced rule's guard fails — this is what makes a regression fail a build |
| 1 | `check` also exits 1 when a promoted rule has **vanished** from the file it was written to. A rule edited in place is reported as `drifted` but does not fail the build |

## Safe for concurrent runs

Every write (`ingest`, `status`, `promote`, `verify`, `merge`, `rollup`) takes an
exclusive lock at `.learnings/ledger.lock` and fails with a non-zero exit if another
process holds it. A lock older than 10 seconds is treated as abandoned and reclaimed.
Without this, two overlapping runs would each read the ledger, apply their own change,
and the second write would silently discard the first.
