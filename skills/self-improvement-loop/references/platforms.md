# Platform matrix

Every platform that supports the Agent Skills format, and where this skill goes.

The list is the official showcase (**46 products**) at
<https://agentskills.io/clients>. It is deliberately **not** derived from what happens to
be installed on one machine — a discovery-by-probing installer finds only what exists
locally and silently omits the rest, which is how a "23 platform" claim ends up wrong.

Those 46 products map to **55 install roots** in `install.mjs`: several vendors ship
separate regional builds with their own directories, and a compatibility root is shared
by many products at once. Counts of "products" and "roots" are different numbers and are
kept distinct throughout this file.

## How each platform loads skills

Most support a **native root**. A large group also reads `.claude/skills/` or
`.agents/skills/` as a compatibility path — that shared pair is why one install can cover
many products at once.

| Platform | Native root | Also reads | Notes |
|---|---|---|---|
| Claude Code | `~/.claude/skills/` | `.agents/skills/` | Rung 1 hooks; see `triggers.md` |
| Claude (app) | upload per-session | — | No filesystem root; add via the skills UI |
| ChatGPT & Codex | `~/.codex/skills/` | `.agents/skills/` | Hooks in `config.toml` |
| VS Code | `.github/skills/` (project) | `.claude/skills/` | Copilot-backed |
| GitHub Copilot | `~/.copilot/skills/` | `.claude/skills/`, `.agents/skills/` | |
| **Shared root** | `~/.agents/skills/` | — | read by the whole compatibility group |
| **Breezell** | `~/.breezell/skills/` | — | |
| **Cline** | `~/.cline/skills/` | `.claude/skills/` | |
| **Continue** | `~/.continue/skills/` | `.claude/skills/` | |
| Cursor | `~/.cursor/skills/` | `.claude/skills/`, `.agents/skills/` | Rules live in `.cursor/rules/*.mdc` |
| Gemini CLI | `~/.gemini/skills/` | — | Entry file `GEMINI.md` |
| Antigravity | `~/.gemini/antigravity/skills/` | `.agents/rules/` | Reads `AGENTS.md` |
| **Antigravity IDE** | `~/.antigravity-ide/skills/` | `.agents/skills/` | |
| OpenCode | `~/.config/opencode/skills/` | `.claude/skills/`, `.agents/skills/` | |
| Goose | `~/.config/goose/skills/` | `.agents/skills/` | Block's agent |
| **DeepSeek Harness (dsh)** | `~/.agents/skills/` | — | scans at startup; same SKILL.md contract |
| **OpenClaw** | `~/.agents/skills/` | workspace `/skills` | precedence order per docs.openclaw.ai/tools/skills |
| **Hermes Agent** | `~/.hermes/skills/` | — | Nous Research |
| **VT Code** | `~/.agents/skills/` | `.claude/skills/` | |
| Amp | `~/.amp/skills/` | `.claude/skills/` | |
| OpenHands | `~/.agents/skills/` | `.claude/skills/` | `.openhands/` is legacy |
| Roo Code | `~/.roo/skills/` | `.claude/skills/` | VS Code extension |
| Junie | `~/.junie/skills/` | `.claude/skills/` | JetBrains |
| Kiro | `~/.kiro/skills/` | `.claude/skills/` | |
| TRAE | `~/.trae/skills/` | `.claude/skills/` |
| **TRAE CN** | `~/.trae-cn/skills/` | `.claude/skills/` | trae.cn; a separate build from trae.ai | |
| **Windsurf** | `~/.codeium/windsurf/skills/` | `.claude/skills/` | |
| **Windsurf (alt root)** | `~/.windsurf/skills/` | `.claude/skills/` | |
| Factory / Piebald | `~/.factory/skills/` | `.agents/skills/` | |
| Letta | `~/.letta/skills/` | — | |
| Firebender | `~/.firebender/skills/` | `.claude/skills/` | |
| Mux | `~/.mux/skills/` | — | Coder |
| Ona | `~/.ona/skills/` | `.claude/skills/` | |
| Qodo | `~/.qodo/skills/` | — | |
| **Qoder** | `~/.qoder/skills/` | — | Qoder international |
| **iFlow CLI** | `~/.iflow/skills/` | — | 心流; project `.iflow/skills/` |
| Tabnine | `~/.tabnine/skills/` | — | |
| Mistral AI Vibe | `~/.vibe/skills/` | — | |
| Command Code | `~/.commandcode/skills/` | — | |
| Deep Code | `~/.deepcode/skills/` | — | |
| Autohand Code CLI | `~/.autohand/skills/` | — | |
| ZeroClaw | `~/.zeroclaw/skills/` | — | |
| Vita | `~/.vita/skills/` | — | |
| Emdash | `~/.emdash/skills/` | — | |
| bub | `~/.bub/skills/` | — | |
| pi | `~/.pi/skills/` | — | `pi-mono` |
| nanobot | `~/.nanobot/skills/` | — | |
| Superconductor | `~/.superconductor/skills/` | — | |
| OpenClaw (workspace) | `~/.openclaw/workspace/skills/` | — | |
| Workshop | `~/.workshop/skills/` | — | |
| **WorkBuddy** | `~/.workbuddy/skills/` | — | domestic build |
| **WorkBuddy (intl)** | `~/.workbuddy-ai/skills/` | — | workbuddy.ai; models differ from the domestic build |
| **QoderWork** | `~/.qoderwork/skills/` | — | |
| **Grok** | `~/.grok/skills/` | — | |
| **ZCode** | `~/.zcode/skills/` | — | |
| **Devin** | `~/.devin/skills/` | — | |
| **CodeBuddy** | `~/.codebuddy/skills/` | `.claude/skills/` | |
| Agentman | hosted | — | no local root |
| Databricks Genie Code | hosted | — | no local root |
| Snowflake Cortex Code | hosted | — | no local root |
| Google AI Edge Gallery | on-device | — | no local root |
| Laravel Boost | project (`packages/`) | — | Composer package |
| Pulumi Neo | hosted | — | no local root |
| Spring AI | JVM library | — | programmatic API |
| fast-agent | Python library | — | programmatic API |

**Hosted and library products have no installable root.** They consume skills through
their own API or package manager, so `install.mjs` cannot place anything there — it lists
them and skips. That is a real limit of file-based distribution, not an oversight.

## Regional editions are separate products

Several vendors ship the same brand twice — a domestic build and an international one —
with **separate data directories**. Treating one directory per brand silently misses half
the installs, so each edition gets its own entry.

| Product | Domestic | International |
|---|---|---|
| WorkBuddy (Tencent) | `~/.workbuddy` | `~/.workbuddy-ai` (workbuddy.ai) |
| TRAE (ByteDance) | `~/.trae-cn` (trae.cn) | `~/.trae` (trae.ai) |
| Qoder (Alibaba) | Qoder CN product line | `~/.qoder` |
| CodeBuddy (Tencent) | Chinese Site login | International Site login |

These are not renamed folders: the model sets differ (WorkBuddy domestic runs
DeepSeek/GLM/Hunyuan, international adds Claude/GPT/Gemini), and they authenticate
against different sites. A skill installed into one is invisible to the other.

## Corrections

Where an earlier revision of this file was wrong, so the mistake is not repeated:

| Claimed | Reality |
|---|---|
| OpenClaw uses `~/.openclaw/skills/` | It loads workspace `/skills`, project `.agents/skills`, and personal `~/.agents/skills`. There is no `~/.openclaw/skills` root. |
| OpenHands uses `~/.openhands/skills/` | `.agents/skills/` is the standard path; `.openhands/` and `.openhands/microagents/` are legacy. |
| A count derived from this machine | The roster is the official showcase; a local probe only finds what is already installed. |
| `.cursorrules` for Cursor | Deprecated and ignored by Agent mode; use `.cursor/rules/*.mdc`. |
| Codex configures hooks in `settings.json` | Hooks live in `config.toml` (`[[hooks.<Event>]]`). |

## How the installer picks a root

`install.mjs` probes platform directories and installs only where the platform exists, so
nothing is created for agents you do not have. The shared **`.agents/skills/`** and
**`.claude/skills/`** roots are installed too, because for the compatibility group they
are the path that actually gets read even when the native root is absent.

Because those two roots are shared, installing to them can cover products whose own
directory does not exist on this machine — that is intended, and is why a run reports
more platforms than the number of directories it created.
