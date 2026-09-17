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
| **Enforce** | A rule can be expressed as a command | A guard that fails the build when the rule is broken |

## Start here

The whole loop depends on someone remembering to run it, so make it self-triggering:

```bash
node .learnings/ledger.mjs brief
```

It prints rules awaiting verification, ineffective rules to rewrite, and entries ready to promote — or **nothing** when there is nothing to say. Wire it to run automatically per platform: see `references/triggers.md` (a Claude Code `SessionStart` hook, or one line in `AGENTS.md` / `CLAUDE.md`). Until it is wired, run `brief` yourself at the start of a task.

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
cp "<skill-dir>/scripts/hook.mjs" .learnings/hook.mjs   # only if you wire a hook
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

"Promote if in doubt" is how memory turns into noise. If the numbers are not there, wait. **The script enforces this** — `promote` refuses an entry below the threshold. To promote early anyway, say why, and the override is recorded on the entry:

```bash
node .learnings/ledger.mjs promote lrn-ab12cd34 --force --reason "production incident; safe-guarding now" \
  --target "CLAUDE.md#build" --watch "npm install or package-lock.json appears in a diff"
```

```bash
node .learnings/ledger.mjs stats
node .learnings/ledger.mjs list --status open
```

**Distill, then place.** Turn the entry into one imperative rule and cut the incident story — verbose: *"Attempted npm install but the project uses pnpm workspaces; lock file is pnpm-lock.yaml."* → rule: *"Use `pnpm install`; this repo uses pnpm workspaces."*

`promote` **writes the rule into its home itself** — one line, under the named section, behind an invisible `<!-- ratchet:<id> -->` marker:

```bash
node .learnings/ledger.mjs promote lrn-ab12cd34 \
  --watch "package-lock.json appears in a diff" \
  --target "CLAUDE.md#Build" \
  --rule "Use pnpm install; this repo uses pnpm workspaces"
```

That is deliberate. A ledger that records *"the rule now lives in CLAUDE.md"* without ever looking is asserting something it cannot know — and a rule silently deleted from its home is precisely the failure this product exists to catch. Because the line is written behind a marker, the claim stays checkable: `check` confirms it is still there and still says what was recorded, and **fails the build when it is not**. Never hand-edit a promoted rule into a file; promote it.

Targets are `FILE#Section` (`CLAUDE.md#Build`, `AGENTS.md#Rules`). The section heading is created if absent, and unrelated content is left untouched.

### The watch predicate — this is the point

A rule that is never checked is a wish. Every promotion carries a one-line, observable predicate describing what the *return* of the mistake looks like — the script rejects a promotion without one, and without a `--target` (a rule placed nowhere is not promoted, just open).

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

### When a rule keeps proving right — extract it

A rule that has held across several verifications is no longer project trivia; it is a reusable technique. Turn it into a skill skeleton:

```bash
node .learnings/ledger.mjs extract lrn-ab12cd34
```

It writes `skills/<pattern_key>/SKILL.md` with the frontmatter, the rule, its rationale, and the evidence line, plus `TODO` sections to fill. The entry is marked `extracted_to` and closed. **The skeleton is a starting point, not a skill** — fill the sections and test the result before relying on it.

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
node .learnings/ledger.mjs doctor          # integrity check; exits 1 when dirty
node .learnings/ledger.mjs stats
node .learnings/ledger.mjs rollup --days 30
```

- **Doctor:** run before a review. It catches the defects that corrupt everything downstream — duplicate identities, a `pattern_key` too vague to be an identity (`fix`, `bug`, 问题), a promoted rule with no predicate, an invalid status, entries with no task recorded. Fix what it reports (see `merge` below), then re-run.
- **Budget:** keep entries still in play under ~25 per area; `stats` reports `over_budget` on the open entries only, so closing or resolving entries is what relieves pressure.
- **Rollup:** archives resolved/`wont_fix` entries idle 30 days into `archive.jsonl`. Still searchable, out of the way.
- **Never delete.** Archiving preserves history; deletion loses the evidence that a rule mattered.

### When two entries describe one problem

A renamed `pattern_key`, or a key that used to normalize to nothing, leaves two rows for one problem — which splits the recurrence count and hides the evidence. Fold them instead of deleting either:

```bash
node .learnings/ledger.mjs merge lrn-keepme lrn-dropme
```

The surviving entry absorbs the other's recurrence, tasks, and files; the dropped one becomes `wont_fix` with `merged_into` pointing at the survivor. Evidence is preserved, the double-count is gone.

### Let the failures find you

Detection is the other half of triggering: capture only happens if the agent notices something broke. `scripts/hook.mjs` surfaces rules awaiting attention at session start; `scripts/detect-error.mjs` fires on `PostToolUseFailure` and returns a reminder as JSON `hookSpecificOutput.additionalContext` — only for failures worth recording, staying silent for expected ones (a typo's `command not found`) and for a repeat of the same failure within ten minutes. Wiring for both: `references/triggers.md`.

## Enforce: make the rule fail on its own

Watching is still a judgement made from memory. The step past it is to give the rule a
**guard** — a command that exits non-zero exactly when the rule is violated — so
"did it hold?" becomes an exit code instead of an opinion.

```bash
node .learnings/ledger.mjs enforce lrn-ab12cd34 \
  --cmd "test ! -f package-lock.json"        # exit 1 == this rule is being broken

# add to the project's test/CI command, alongside the test runner
node .learnings/ledger.mjs check
```

`enforce` runs the guard once immediately and reports what it saw — `clean` (exits 0,
which is what a passing guard looks like), `FAILING NOW`, or `BROKEN` (the command could
not run at all; check the path and quoting). Only a clean guard moves the entry to
`enforced`.

`check` runs every guard **and every home binding**. When a guard fails, or a promoted
rule has vanished from the file it was written to, it marks that rule `ineffective`,
bumps its recurrence, and **exits 1** — so a build that runs `check` goes red the moment
a rule regresses, with no one needing to remember to look. Re-running does not inflate
recurrence: one ongoing violation is one regression. A guard that merely broke, or a rule
**edited** in its home, is reported separately and does **not** fail the build — a typo in
a guard must never be mistaken for a rule that stopped holding.

```bash
node .learnings/ledger.mjs check
# {"ran":2,"passed":2,"regressed":[],"broken_guards":[],"enforced_total":1,
#  "homes":{"checked":2,"deleted":[],"drifted":[]}}
```

Fix a vanished rule by re-running `promote` for that id — it rewrites the line rather
than duplicating it.

Prefer a guard over a note once you can express one. A rule with a guard needs no
review discipline at all.

### System health

`stats` reports the metrics that say whether this loop is working:

- `awaiting_verification` / `watchlist` — every `watching` rule and its predicate. **Start each review here**; this is the to-do list.
- `enforced_total` — rules with a live guard. These need no review: `check` catches them.
- `promoted` — rules under watch, counting archived ones too (pruning the ledger must not reset the history).
- `recurrence_after_promotion_pct` — **the key number.** Low means rules stick. High means promotion is producing words, not change.
- `top_recurring` — entries that keep coming back; each deserves a promotion or a real fix.

If `recurrence_after_promotion_pct` stays high across reviews, the promotion bar is too low or rules are too vague. Fix the process, not the entries.

## What this is and isn't

This is **self-evaluation**: the loop measures whether its own rules changed behavior, and corrects itself. It is not self-modifying code — the agent does the thinking; this skill supplies the loop, the thresholds, and the ledger.

## Audit: the loop retunes itself

Everything above improves the project. This improves *the loop*. The thresholds are not
constants — they live in `.learnings/config.json` and `audit` measures the funnel, says
what the numbers imply, and with `--apply` turns the knobs.

```bash
node .learnings/ledger.mjs audit            # report only
node .learnings/ledger.mjs audit --apply    # retune the policy, keeping a history
```

| Signal | What it means | What it changes |
|---|---|---|
| `hold_pct < 50` | Most rules we tested came back — the bar admits unproven ideas | raises `min_recurrence` |
| `promotion_pct < 5` | Captures keep arriving and nothing graduates | lowers `min_recurrence` |
| `enforcement_pct < 50` | Rules still depend on someone remembering | advisory — compile guards |
| `attention_load > budget` | More rules need review than anyone will review | raises `attention_budget` |
| `mostly_stated` | Verification is mostly by recall, the weakest form | advisory — enforce or probe |

This is the difference between a system that can be *defended* and one that *adapts*.
Every threshold here was previously a constant I had to argue for; now the system argues
from its own outcomes.

## Probe: verify the agent, not just the artifact

A guard proves the file is correct. It cannot prove the agent changed. **Verification
strength is a first-class property**, and the three levels are not equal:

| Level | Set by | Means |
|---|---|---|
| `artifact` | `enforce` | A command checks it on every run — strongest |
| `behavior` | `probe` | The situation was reconstructed and the mistake did not recur |
| `stated` | `verify` | Someone recalled it — weakest |

```bash
# due for a behavioral probe? `brief` says so; then:
node .learnings/ledger.mjs probe lrn-ab12cd34 --result held
node .learnings/ledger.mjs probe lrn-ab12cd34 --result recurred --note "hit it again in step 4"
```

A `recurred` probe marks the rule `ineffective` and bumps recurrence (idempotent, as
everywhere else). `brief` lists rules due for a probe — those promoted, not guarded, and
not probed within `probe_interval_days`. A rule with an artifact-level guard is never due:
the command outranks memory.

## Common mistakes

| Mistake | Correction |
|---|---|
| Logging every failed command | Apply the write gate first; most failures are noise. |
| Free-text `pattern_key` (`"fixed the thing"`) | Use a stable symptom slug, or dedupe and recurrence break. |
| Hand-writing `lrn-20250917-001` | Let the script hash it; hand IDs collide. |
| Promoting on first occurrence | Wait for `recurrence >= 3` (or a twice-made correction). |
| Copying the whole incident into memory | Distill to one imperative rule. |
| Skipping `--watch` | The script rejects the promotion — a rule with no predicate can never be verified. |
| Promoting without `--target` | Rejected too: a rule that lives nowhere is just an open entry, and `stats` would disagree with the status. |
| Writing the rule to two homes | One rule, one home. |
| Never checking promoted rules | Check `watching` entries every review — that is the point. |
| Re-promoting the same wording after a failure | Rewrite or automate it — words that failed will fail again. |
| Deleting stale entries | `rollup` archives; deletion destroys evidence. |
| Two rows for one problem | `merge` folds them — do not delete either, that discards recurrence evidence. |
| Never running `doctor` | It is what catches vague keys and duplicate identities before they corrupt the counts. |
| Leaving the reminder unwired | Run `brief` at task start, or wire it per `references/triggers.md` — an unwired loop only fires when someone remembers. |
| A rule that keeps holding but never becomes a skill | `extract` it; rules that generalize belong in a skill, not an ever-growing ledger. |
| Leaving a rule as prose when it could be a command | `enforce` it — a guard removes the need for anyone to remember to check. |
| Hand-editing a promoted rule into a file | `promote` writes it behind a marker; a hand-written rule is invisible to `check`. |
| Treating a broken guard as a regression | A guard that cannot run is reported separately; fix the command, not the rule. |
| Treating all verification as equal | `enforce` where a command can check it; only what remains is worth a probe. |
| Leaving thresholds as constants | Run `audit --apply` — the loop should retune itself from its own hit rate. |
