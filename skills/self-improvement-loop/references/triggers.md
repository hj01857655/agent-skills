# Triggers

Everything else in this skill depends on the agent remembering to run it. That is the
weakest link — the same one the original self-improving-agent never closed. This file
is how you remove it, per platform.

The mechanism is the same everywhere: inject `brief` output into context at session
start. `brief` prints plain text, and prints **nothing** when there is nothing to say.

```bash
node .learnings/ledger.mjs brief
```

`scripts/hook.mjs` wraps it for platforms whose hooks receive a stdin payload; it
drains stdin, prints the brief, and always exits 0.

Both hook scripts are **optional** — nothing else in the skill depends on them. An agent
with no hook support runs `brief` (rung 2/3 below) and gets the same information.

## Which rung does my agent get?

`scripts/install.mjs` places the skill in every platform present on the machine; wiring
the reminder is a separate, per-platform step. Only some agents expose a session-start
hook, so most land on rung 2 or 3.

| Agent | Directory (installed by `install.mjs`) | Wiring |
|---|---|---|
| Claude Code | `~/.claude/skills/` | **Rung 1** — `SessionStart` + `PostToolUseFailure` hooks |
| Codex CLI | `~/.codex/skills/`, `~/.agents/skills/` | **Rung 2** — `AGENTS.md`; hooks live in `config.toml`, not `settings.json` |
| Breezell | `~/.breezell/skills/` | **Rung 2/3** — project `AGENTS.md`, else the skill description |
| Cursor | `~/.cursor/skills/` | **Rung 2** — `.cursor/rules/*.mdc` (`.cursorrules` is deprecated and ignored by Agent mode) |
| Windsurf | `~/.codeium/windsurf/skills/` or `~/.windsurf/skills/` | **Rung 2** — project rules file |
| GitHub Copilot | `~/.copilot/skills/` | **Rung 2** — `.github/copilot-instructions.md` |
| Gemini CLI | `~/.gemini/skills/` | **Rung 2** — `GEMINI.md` |
| Antigravity (CLI + IDE) | `~/.gemini/antigravity/skills/`, `~/.antigravity-ide/skills/` | **Rung 2** — `AGENTS.md` at the workspace root, or `.agents/rules/` (global rules: `~/.gemini/GEMINI.md`) |
| Cline / Continue / Kiro / Amp / Grok / Trae / ZCode / Factory / Devin / CodeBuddy | `~/.<agent>/skills/` | **Rung 2 or 3** — entry file if the agent reads one, otherwise the description |
| WorkBuddy / QoderWork | `~/.workbuddy/skills/`, `~/.qoderwork/skills/` | **Rung 3** — skill description |

Rung 2 is a one-line pointer in whatever file the agent reads at session start; the
snippet is below. Where an agent has no entry file and no hooks, the skill's `description`
is the only trigger — which works, just without the automatic reminder.

> If the reminder never fires, check whether another tool manages that root. `.agents`
> (`npx skills`) and `.breezell` (the skillhub store) keep manifests; a hand-copied skill
> is absent from them and can be pruned. `install.mjs --status` shows what is currently
> installed, and the `agent-plugin/` bundle is the durable install route.

## Capability ladder

Wire the highest rung the platform supports. Every rung works; the lower ones just
lean more on the agent remembering.

| Rung | Mechanism | Reminder is… |
|---|---|---|
| 1 | Native hook on session start / prompt submit | automatic |
| 2 | Entry file (always read by the agent) pointing at `brief` | automatic if the pointer is followed |
| 3 | Skill `description` triggers (this skill's own frontmatter) | model-judged |
| 4 | Nothing — agent runs `brief` when it thinks of it | manual |

## Rung 1 — native hooks

### Claude Code

`SessionStart` fires when a session begins or resumes — the right moment to surface
outstanding rules. Merge into `.claude/settings.json` (project) or
`~/.claude/settings.json` (user); the `hooks` key is additive across levels.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.learnings/hook.mjs\"" } ] }
    ]
  }
}
```

Copy `hook.mjs` next to the vendored ledger (`cp "<skill-dir>/scripts/hook.mjs"
.learnings/hook.mjs`). `$CLAUDE_PROJECT_DIR` is exported by Claude Code; `hook.mjs`
also honours `PROJECT_DIR` and falls back to `cwd`.

To remind on every prompt instead of once per session, add a second entry under
`UserPromptSubmit`. Prefer `SessionStart` unless the sessions are short — a reminder on
every prompt costs tokens every turn, and a reminder that is always there stops being
read.

#### Also wire failure detection

Recording only happens if the agent notices something went wrong. `PostToolUseFailure`
is the event that knows: it carries `error_message` and `error_type`.

```json
{
  "hooks": {
    "PostToolUseFailure": [
      { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.learnings/detect-error.mjs\"" } ] }
    ]
  }
}
```

`detect-error.mjs` stays silent for failures nobody needs recorded (a typo's `command
not found`), stays silent when the same failure just fired again within ten minutes, and
otherwise returns the reminder. It never exits non-zero.

**The output format is not cosmetic.** For `PostToolUse`-type events Claude Code does
**not** add plain stdout to context — it writes it to the debug log. The reminder only
reaches the model as JSON:

```json
{"hookSpecificOutput":{"hookEventName":"PostToolUseFailure","additionalContext":"..."}}
```

`detect-error.mjs` emits exactly that. `hook.mjs` prints plain text, because
`SessionStart` is one of the four events that *does* accept plain stdout as context.
Getting this wrong is a silent no-op: the hook runs, matches, and nothing arrives.

**Do not** attach the detector to `PostToolUse`: that event fires only after a tool
**succeeded**, so it can never see a failure. Nor should it read a tool-output
environment variable — that channel is deprecated; hook payloads arrive as JSON on
**stdin**.

### Codex CLI

Codex does **not** use `.claude/settings.json`. Hooks live in `config.toml` as a `hooks`
table, using the same event schema:

```toml
[[hooks.PostToolUseFailure]]

[[hooks.PostToolUseFailure.hooks]]
type = "command"
command = "node .learnings/detect-error.mjs"
```

For the session-start reminder, prefer rung 2 (`AGENTS.md`, which Codex reads
automatically) unless you are already driving hooks from `config.toml`.

## Rung 2 — entry files

An entry file is read at the start of every session on most agents. One line there is
enough to make the loop self-triggering.

Add to whichever file the platform reads — `AGENTS.md` (Codex, Antigravity, and others),
`CLAUDE.md` (Claude Code without hooks), `.cursor/rules/*.mdc` (Cursor),
`.github/copilot-instructions.md` (Copilot), `GEMINI.md` (Gemini CLI), or
`.agent-memory.md` as the generic fallback:

```markdown
## Learnings

At the start of a task, run `node .learnings/ledger.mjs brief`. It prints any rules
awaiting verification, ineffective rules to rewrite, and entries ready to promote —
or nothing. Act on what it prints; if it prints nothing, move on.

When work goes wrong in a non-obvious way, or the user corrects you, run the
self-improvement-loop skill's Capture phase. Before promoting a rule, see the
Promote phase — a rule without an observable watch predicate cannot be verified.
```

Keep it to that. An entry file is paid for on every request — a long pointer costs
more than it saves.

## Rung 3 — skill description

This skill's own `description` carries the trigger conditions, so on platforms with
no hooks and no entry file the model still finds it. Nothing to configure; it is why
the description is written with symptoms rather than a workflow summary.

## Rung 4 — manual

No wiring. The loop still works — `ingest` ⟶ `promote` ⟶ `verify` are all there — but
only when the agent or the user remembers to run them. `brief` is the fastest check.

## Verifying the wiring

```bash
# Nothing to report -> no output, exit 0. This is the normal case.
node .learnings/ledger.mjs brief

# Simulate the hook's stdin payload
CLAUDE_PROJECT_DIR="$PWD" node .learnings/hook.mjs < /dev/null

# Simulate a real tool failure -> JSON with hookSpecificOutput.additionalContext
# (run twice: the second time is silent, because the failure was just reported)
echo '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","error_message":"Exit code 1\nAssertionError: expected 2 to equal 3"}' \
  | CLAUDE_PROJECT_DIR="$PWD" node .learnings/detect-error.mjs
```

If the hook prints nothing when rules *are* waiting, check the working directory:
`hook.mjs` resolves the project root from `CLAUDE_PROJECT_DIR`, then `PROJECT_DIR`,
then `cwd`, and does nothing if `.learnings/ledger.mjs` is absent.
