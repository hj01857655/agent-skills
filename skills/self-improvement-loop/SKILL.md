---
name: self-improvement-loop
description: Use when a non-obvious failure just happened, the user corrects the assistant ("no, that's wrong", "actually..."), an external tool or API misbehaves surprisingly, documented behavior turns out different than expected, or a clearly better approach is found. Also use at a task boundary, when the user asks what has been learned, when a mistake feels familiar, or during a periodic review.
metadata:
  version: 1.0.0
---

# Self-Improvement Loop

A learning system that never checks itself is just a diary. This runs the full loop: capture evidence, promote what repeats, verify that promoted rules actually changed behavior.

Three phases, one ledger. Run only the phase the moment calls for.

| Phase | Trigger | Output |
|---|---|---|
| **Capture** | A failure, correction, or discovery worth keeping | An entry in `.learnings/ledger.jsonl` |
| **Promote** | A task boundary; an entry crossed the threshold | A durable rule in the project's native memory |
| **Verify** | A periodic review; a mistake feels familiar | A verdict on each watching rule; a pruned ledger |

## Capture: the write gate

Most sessions produce noise. Logging every non-zero exit code buries the signal. Before writing anything, answer all five. **Any "no" means do not log.**

1. **Non-obvious?** Would a competent engineer, reading the code and docs, have gotten this right the first time?
2. **Expensive to relearn?** If forgotten, would someone burn >15 minutes to rediscover it?
3. **Generalizable?** Does it apply beyond this one line of code? (A typo does not. A wrong assumption does.)
4. **Actionable?** Can you state the rule as "next time, do X" or "next time, never Y"?
5. **Not already known?** Is it absent from the project's docs, memory, and existing ledger entries?

If the gate rejects it, say so in one line and move on. Silence is the correct output for routine failures.

### Two homes, one rule each

| What it is | Where it goes |
|---|---|
| A durable fact about *this project* (convention, gotcha, build step) | The project's native memory |
| A raw observation you are not yet sure about | The ledger, to accumulate evidence |

The ledger is **not** a second memory system. It is a holding area for unconfirmed observations; nothing in it is authoritative until the Promote phase moves it.

**Native memory targets** — pick one, by platform:

- **Breezell** — call `update_memory` (scope `workspace`).
- **Claude Code** — append to `CLAUDE.md`.
- **Codex CLI** — append to `AGENTS.md`.
- **Any other agent** — append to `.agent-memory.md` at the project root.
- **Project with a docs folder** — prefer that folder (e.g. `docs/conventions.md`).

Never write the same rule to two homes. Duplicated memory drifts.

### The ledger

Records live in `.learnings/ledger.jsonl` — one JSON object per line, the machine source of truth. `DIGEST.md` is a regenerated human view; never hand-edit it. Field-by-field schema: `references/ledger-contract.md`.

**One-time setup per project.** The script is vendored *into the project* so the project stays self-contained and portable (the skill folder's location varies by platform). On first use, copy it from this skill's directory — the `use_skill` result lists absolute paths — to `.learnings/ledger.mjs`:

```bash
mkdir -p .learnings
cp "<skill-dir>/scripts/ledger.mjs" .learnings/ledger.mjs
```

The script derives each entry's ID from a hash of its normalized `pattern_key`, so the same problem always lands on the same ID and repeats bump a counter instead of creating twins. **Never hand-write an ID or append to the ledger by hand.**

```bash
# Capture: queue a finding, then ingest it (run from the project root)
mkdir -p .learnings/inbox
cat > .learnings/inbox/finding.json <<'EOF'
{
  "kind": "learning",
  "category": "correction",
  "area": "tests",
  "priority": "high",
  "summary": "Tests asserted top-level quota/used; the function reads usageData.usageBreakdownList[0]",
  "details": "Two tests failed on a contract mismatch, not a bug.",
  "action": "Assert against the real shape: usageData.usageBreakdownList[0].{usageLimit,currentUsage}",
  "pattern_key": "test-fixture-mismatches-real-contract",
  "task": "gateway-refactor",
  "files": ["src/components/features/Gateway/gatewayPageUtils.test.ts"]
}
EOF
node .learnings/ledger.mjs ingest
node .learnings/ledger.mjs digest
```

`kind`: `learning` | `error` | `feature`. `category`: `correction` | `knowledge_gap` | `best_practice`. `area`: `frontend` | `backend` | `infra` | `tests` | `docs` | `config` | `process`.

**`pattern_key` is the most important field.** A short, stable, symptom-level slug (`test-fixture-mismatches-real-contract`), never free prose. Two findings with the same cause must share a key; that is what makes recurrence counting and promotion work.

### What not to record

Secrets, tokens, keys, credentials, or environment values — redact or omit. Full command output or transcripts — a redacted excerpt is enough. One-off typos, environment quirks, or anything already fixed in the same breath. Anything already in `DIGEST.md`, project docs, or memory.

## Promote: evidence, not vibes

Promote an entry only when the ledger shows proof it is real:

- `recurrence >= 3`, **or** it is a `correction` the user made twice; **and**
- it is actionable (states a "do X / never Y" rule); **and**
- it is still `open` or `watching` (not `wont_fix`).

"Promote if in doubt" is how memory turns into noise. If the numbers are not there, wait.

```bash
node .learnings/ledger.mjs stats
node .learnings/ledger.mjs list --status open
```

**Distill, then place.** Turn the entry into one imperative rule and cut the incident story — verbose: *"Attempted npm install but the project uses pnpm workspaces; lock file is pnpm-lock.yaml."* → rule: *"Use `pnpm install`; this repo uses pnpm workspaces."* Place it in exactly one native-memory home (targets above), then record the promotion.

### The watch predicate — this is the point

A rule that is never checked is a wish. Every promotion carries a one-line, observable predicate describing what the *return* of the mistake looks like.

```bash
node .learnings/ledger.mjs promote lrn-ab12cd34 \
  --target "CLAUDE.md#build" \
  --watch "npm install or package-lock.json appears in a diff"
```

Good predicates name something **observable in the work**, not an intention:

| ❌ Wish | ✅ Watch predicate |
|---|---|
| "remember to use pnpm" | `npm install` or `package-lock.json` in a diff |
| "don't forget to regenerate the client" | API route file changed without `pnpm run generate:api` |
| "handle the /v1 suffix" | client config shows a base URL missing `/v1` |

If you cannot write an observable predicate, you cannot check the rule later — refine the rule until you can.

### Do not promote

One-off fixes and already-resolved incidents. Anything you would not want a new contributor told on day one. Restatements of language or framework defaults. Entries whose `pattern_key` is vague — fix the key first.

## Verify: does the rule actually work?

Every promoted rule carries a `watch` predicate. In later work, look for it.

```bash
# The rule held
node .learnings/ledger.mjs verify lrn-ab12cd34 --result held --note "used pnpm throughout"

# The rule failed — mark ineffective and count the recurrence
node .learnings/ledger.mjs verify lrn-ab12cd34 --result recurred --note "npm install ran in step 4"
```

A `recurred` verdict sets `status: ineffective` and puts the entry back in play. It is **not** a failure of the system — it is the system working. Silence would be the failure.

**When a rule proves ineffective**, diagnose before acting:

| Cause | Fix |
|---|---|
| Too vague to act on | Rewrite it as a concrete "do X / never Y" and re-promote. |
| Right, but nothing enforces it | Move enforcement into automation — a lint rule, a test, a script. |
| Does not actually generalize | Demote it: `wont_fix` with the reason. |

Do not simply re-promote the same wording. If the words were enough, it would have held.

### Ledger hygiene

```bash
node .learnings/ledger.mjs stats
node .learnings/ledger.mjs rollup --days 30
```

- **Budget:** keep active entries per area under ~25. `stats` reports `over_budget` areas. Over budget means promote or prune — not "add more".
- **Rollup:** archives resolved/`wont_fix` entries idle 30 days into `archive.jsonl`. Still searchable, out of the way.
- **Never delete.** Archiving preserves history; deletion loses the evidence that a rule mattered.

### System health

`stats` reports the metrics that say whether this loop is working:

- `promoted` — rules currently under watch.
- `recurrence_after_promotion_pct` — **the key number.** Low means rules stick. High means promotion is producing words, not change.
- `top_recurring` — entries that keep coming back; each deserves a promotion or a real fix.

If `recurrence_after_promotion_pct` stays high across reviews, the promotion bar is too low or rules are too vague. Fix the process, not the entries.

## What this is and isn't

This is **self-evaluation**: the loop measures whether its own rules changed behavior, and corrects itself. It is not self-modifying code — the agent does the thinking; this skill supplies the loop, the thresholds, and the ledger.

## Common mistakes

| Mistake | Correction |
|---|---|
| Logging every failed command | Apply the write gate first; most failures are noise. |
| Free-text `pattern_key` (`"fixed the thing"`) | Use a stable symptom slug, or dedupe and recurrence break. |
| Hand-writing `lrn-20250917-001` | Let the script hash it; hand IDs collide. |
| Promoting on first occurrence | Wait for `recurrence >= 3` (or a twice-made correction). |
| Copying the whole incident into memory | Distill to one imperative rule. |
| Skipping `--watch` | Without a predicate the rule can never be verified. |
| Writing the rule to two homes | One rule, one home. |
| Never checking promoted rules | Check `watching` entries every review — that is the point. |
| Re-promoting the same wording after a failure | Rewrite or automate it — words that failed will fail again. |
| Deleting stale entries | `rollup` archives; deletion destroys evidence. |
