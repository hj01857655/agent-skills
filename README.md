# self-improvement-loop

An agent skill that turns hard-won lessons into rules that are actually checked.

Most "self-improving agent" skills stop at *recording*: write the lesson to a file and
hope someone reads it. This one runs the full loop — **capture evidence → promote what
repeats → verify that promoted rules changed behavior** — and treats a rule that was
never checked as a wish, not a rule.

## Why the loop, not just the log

A log has no opinion. It grows, nobody reads it, and the same mistake comes back. Three
mechanisms are what make this different:

| Mechanism | What it prevents |
|---|---|
| **Write gate** (five questions) | The log filling with noise so the signal is unreadable |
| **Deterministic identity** — `sha1(normalized pattern_key)` | Duplicate rows for one problem, split recurrence counts, hand-written IDs that collide |
| **Watch predicate + verdict** | A promoted rule silently failing forever with nobody noticing |

The third is the point. Every promoted rule carries a one-line, observable predicate
describing what *the return of the mistake* looks like. When it returns, the rule is
marked `ineffective` and goes back to be rewritten or automated. That feedback path is
the difference between self-documenting and self-improving.

## Install

Two ways, both plain files — no build step, no dependencies beyond Node 18+ for the
optional script.

**As an agent skill** — copy this directory into your agent's skills folder:

| Agent | Skills directory |
|---|---|
| Breezell | `~/.breezell/skills/` |
| Claude Code | `~/.claude/skills/` |
| Codex CLI | `~/.codex/skills/` |
| Gemini CLI | `~/.gemini/skills/` |

```bash
cp -r skills/self-improvement-loop ~/.claude/skills/
```

**Per project** — vendor the script so the project stays self-contained:

```bash
mkdir -p .learnings
cp skills/self-improvement-loop/scripts/ledger.mjs .learnings/ledger.mjs
```

## Two-minute tour

```bash
# 1. Capture — queue a finding, then ingest it
mkdir -p .learnings/inbox
cat > .learnings/inbox/finding.json <<'EOF'
{
  "kind": "learning",
  "category": "correction",
  "area": "tests",
  "priority": "high",
  "summary": "Tests asserted top-level quota/used; the function reads usageData.usageBreakdownList[0]",
  "action": "Assert against the real shape: usageData.usageBreakdownList[0].{usageLimit,currentUsage}",
  "pattern_key": "test-fixture-mismatches-real-contract",
  "task": "gateway-refactor"
}
EOF
node .learnings/ledger.mjs ingest && node .learnings/ledger.mjs digest

# 2. Promote — only once the evidence is there (recurrence >= 3)
#    --watch and --target are both required: an unverifiable rule, or one placed
#    nowhere, is not a rule yet.
node .learnings/ledger.mjs promote lrn-ab12cd34 \
  --target "CLAUDE.md#tests" \
  --watch "a test references a top-level quota field"

# 3. Verify — did the rule hold?
node .learnings/ledger.mjs verify lrn-ab12cd34 --result recurred --note "b.test.ts did it again"
# -> status: ineffective, back in play
```

The script refuses a promotion below the threshold, and refuses one with no `--watch` —
those are the two ways a rule becomes unverifiable.

## Make it fire on its own

Everything above depends on someone remembering to run it. `brief` is the reminder, and
`references/triggers.md` wires it per platform (a Claude Code `SessionStart` hook, or one
line in `AGENTS.md`):

```bash
node .learnings/ledger.mjs brief   # prints what needs attention, or nothing
```

## Commands

| Command | Purpose |
|---|---|
| `ingest` | Consume `inbox/*.json`; dedupe by identity; bump recurrence |
| `list [--status X] [--area Y] [--kind Z]` | Filter entries |
| `promote <id> --watch W --target T [--force --reason R]` | Start watching a rule (both flags required) |
| `verify <id> --result held\|recurred [--note N]` | Record whether it held (idempotent) |
| `extract <id> [--dir D]` | Turn a settled rule into a new skill skeleton |
| `merge <keep-id> <drop-id>` | Fold a duplicate; evidence preserved, not deleted |
| `doctor` | Integrity check; exits 1 when dirty |
| `brief [--max N]` | Reminder text for context injection |
| `stats [--budget N]` | Counts, budget, recurrence-after-promotion % |
| `digest` | Regenerate `DIGEST.md` |
| `rollup [--days N]` | Archive closed, idle entries |

Full schema and lifecycle: [`references/ledger-contract.md`](skills/self-improvement-loop/references/ledger-contract.md).

## What this is not

- **Not a second memory system.** The ledger is a holding area for unconfirmed
  observations. Durable rules go to the project's native memory (`CLAUDE.md`,
  `AGENTS.md`, or your agent's memory tool) — one rule, one home.
- **Not self-modifying code.** This is *self-evaluation*: it measures whether its own
  rules changed behavior and corrects them in later sessions. The agent does the
  thinking; the skill supplies the loop, the thresholds, and the ledger.

## Provenance

Built as a direct response to `@clawhub_pskoett/self-improving-agent` (v3.0.24), whose
capture-only design left three gaps this closes: no deterministic identity, no objective
promotion threshold bound to the ledger, and no verification that a promoted rule held.
