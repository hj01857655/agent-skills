<p align="center">
  <img src="https://img.shields.io/badge/license-MIT--0-blue" alt="License: MIT-0">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node >= 18">
  <img src="https://img.shields.io/badge/platforms-46%20supported-2ea44f" alt="46 platforms supported">
</p>

# ratchet

> A ratchet only turns one way. So does this:
> **capture evidence → promote what repeats → prove the rule still holds.**
> A rule that regresses is caught by its own guard and sent back to be rewritten.
> Progress accumulates; it does not silently unwind.

An agent skill that turns hard-won lessons into rules that are actually checked.

Most "self-improving agent" skills stop at *recording*: write the lesson to a file and
hope someone reads it. This one runs the full loop, and treats a rule that was never
checked as a wish, not a rule.

## Why the loop, not just the log

A log has no opinion. It grows, nobody reads it, and the same mistake comes back. These
mechanisms are what make this different:

| Mechanism | What it prevents |
|---|---|
| **Write gate** (five questions) | The log filling with noise so the signal is unreadable |
| **Deterministic identity** — `sha1(normalized pattern_key)` | Duplicate rows for one problem, split recurrence counts, hand-written IDs that collide |
| **Promotion writes the rule, behind a marker** | A ledger claiming *"the rule lives in CLAUDE.md"* without ever looking — the rule is deleted and nothing notices |
| **Guards, not prose** | "Did the rule hold?" being a judgement made from memory instead of an exit code |

The third and fourth are the point. `promote` **writes** the rule into its home file behind an invisible marker, so the claim is checkable; `check` confirms every rule is still there and every guard still passes, and **fails the build** when one is not. A rule that regresses is caught by machinery, not by attention — that feedback path is the difference between self-documenting and self-improving.

## Install

Three ways. All plain files — no build step; Node 18+ only for the optional scripts.

### 1. Every agent on this machine, at once

The repo ships an installer that probes for known skill roots and installs only where the
platform is actually present. It never creates a directory for an agent you do not have.

```bash
node skills/self-improvement-loop/scripts/install.mjs --list      # roster + what exists here
node skills/self-improvement-loop/scripts/install.mjs --dry-run   # show the plan
node skills/self-improvement-loop/scripts/install.mjs             # install everywhere found
node skills/self-improvement-loop/scripts/install.mjs --only claude,codex,kiro
node skills/self-improvement-loop/scripts/install.mjs --status    # where is it installed?
node skills/self-improvement-loop/scripts/install.mjs --uninstall # remove every copy
```

`--only` takes short ids (`claude`, `codex`, `cursor`, `kiro`, `opencode`, ...) — see `--list`.
Uninstalling by hand across dozens of roots is how stale copies get left behind, so
`--uninstall` (with `--dry-run` first, if you like) is the other half of `install`.

The roster follows the **official Agent Skills showcase (46 products)** at
<https://agentskills.io/clients>, not just what happens to be on this machine — probing
locally finds only what you already have and silently understates the count. Full matrix,
including which products share the compatibility roots: [`references/platforms.md`](skills/self-improvement-loop/references/platforms.md).

Eleven of the 46 have **no installable filesystem root** (ChatGPT and Claude apps,
Databricks Genie Code, Snowflake Cortex Code, Pulumi Neo, Agentman, Spring AI,
fast-agent, Laravel Boost, Google AI Edge Gallery, on-device). They consume skills
through their own API or package manager; `--list` names them instead of quietly
omitting them. That is a real limit of file-based distribution.

Two roots (`.agents`, `.claude`) are **shared compatibility paths** read by many of these
products, so one install there covers the whole compatibility group — which is why a run
can cover more platforms than the number of directories it writes. Two others
(`.agents` via `npx skills`, `.breezell` via the skillhub store) keep their own manifests;
a hand-copied skill is absent from them and the manager may prune it. The installer says
so after writing there, and the `agent-plugin/` bundle below is the durable route.

### 2. One platform, by hand

```bash
cp -r skills/self-improvement-loop ~/.claude/skills/
```

| Agent | Skills directory |
|---|---|
| Breezell | `~/.breezell/skills/` |
| Claude Code | `~/.claude/skills/` |
| Codex CLI | `~/.codex/skills/` |
| Cursor / Cline / Continue / Kiro / Amp / Grok | `~/.<agent>/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| GitHub Copilot | `~/.copilot/skills/` |

### 3. Portable bundle (Agent Plugins 1.0)

[`agent-plugin/`](agent-plugin/) is a portable package following the Agent Plugins 1.0
spec — point any compatible client or packager at [`agent-plugin/plugin.json`](agent-plugin/plugin.json).

`skills/` is canonical; regenerate the bundle after editing a skill, or you publish a
copy that no longer matches the source:

```bash
node scripts/sync-plugin.mjs           # regenerate
node scripts/sync-plugin.mjs --check   # CI: fail if the bundle drifted
```

### Per project (any method)

Vendor the ledger so the project stays self-contained:

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

# 2. Promote — only once the evidence is there (recurrence >= 3).
#    Writes the rule into CLAUDE.md behind a marker, so it stays checkable.
node .learnings/ledger.mjs promote lrn-ab12cd34 \
  --target "CLAUDE.md#Build" \
  --watch "a test references a top-level quota field" \
  --rule "Assert against usageData.usageBreakdownList[0], not top-level quota"

# 3. Enforce — compile the rule into a guard that fails the build when broken
node .learnings/ledger.mjs enforce lrn-ab12cd34 --cmd "! grep -rq 'package-lock.json' ."

# 4. Check — run it in the test/CI command; exit 1 on regression
node .learnings/ledger.mjs check
```

The script refuses a promotion below the threshold, and refuses one with no `--watch` or
`--target` — those are the ways a rule becomes unverifiable or homeless.

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
| `promote <id> --watch W --target T [--rule R]` | Write the rule into its home (`FILE#Section`) behind a marker |
| `enforce <id> --cmd C` | Compile the rule into a guard; fails the build when broken |
| `check` | Run guards + verify every rule is still in its home; exits 1 on regression |
| `verify <id> --result held\|recurred [--note N]` | Record whether it held (idempotent) |
| `extract <id> [--dir D]` | Turn a settled rule into a new skill skeleton |
| `merge <keep-id> <drop-id>` | Fold a duplicate; evidence preserved, not deleted |
| `probe <id> --result held\|recurred [--note N]` | Behavioral verification: reconstruct the situation |
| `audit [--apply]` | Measure the loop's funnel and retune its thresholds |
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

Built as a direct response to [`pskoett/pskoett-ai-skills`](https://github.com/pskoett/pskoett-ai-skills)
(`self-improvement` + `self-healing`), which is a far broader suite — 19 skills covering
planning, verification, recovery, and CI — and this repo covers one loop depth-first
rather than many shallowly.

Having read its 424-line skill end to end, the honest differences are narrower than a
first pass suggests, and it deserves credit for several things it does well:

- It **does** define a promotion threshold (`Recurrence-Count >= 3`, within a 30-day
  window, across 2 distinct tasks) and reuses that one rule across its aggregator skills.
- Its `error-detector.sh` sends the reminder exactly the way Claude Code requires — as
  JSON `hookSpecificOutput.additionalContext` on stdin — which the 3.0.24 release on
  skillhub does **not** (that build reads the deprecated `CLAUDE_TOOL_OUTPUT` env var).
- Its `self-healing` skill owns a discipline this one lacks: **verify before persist**,
  with a mandatory re-run and an honest `pending-verify`/`abandoned` status.

What is genuinely different here:

- **A machine-readable ledger.** Their entries are markdown files read by grep; identity,
  recurrence, and promotion live in prose. Here they are columns.
- **Identity you cannot get wrong.** Their `LRN-YYYYMMDD-XXX` ID is hand-assigned and its
  recurrence depends on the writer noticing a similar entry; ours is a hash of the
  normalized `pattern_key`.
- **Promotion that writes and verifies.** They instruct the agent to add the rule to
  `CLAUDE.md` by hand and update the entry's status. Nothing afterwards confirms the rule
  is still in the file. Ours writes it behind a marker and `check` fails the build when it
  has been deleted.
- **Enforcement as an exit code.** Their loop ends at "promoted"; whether it held is a
  judgement made from memory.

What is borrowed deliberately is the packaging lesson: a portable manifest plus an
`install.mjs` that covers 21 platforms beats hand-copying into each agent's directory.
