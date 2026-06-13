---
name: analyze
description: Analyze code, architecture, data flow, or behavior in the vscode-sfdx-hardis VS Code extension. Use when the user asks to understand, trace, audit, or investigate how something works in this codebase.
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: cloudity
  version: "1.0"
---

# Analyze

Analyze code, architecture, or behavior in the vscode-sfdx-hardis extension.

## Delegation

A matching **`analyze`** sub-agent is defined in `.claude/agents/analyze.md`. Prefer delegating this task to the `analyze` sub-agent via your tool's sub-agent mechanism so it runs with the dedicated tooling and configuration defined there. Handle it inline only when delegation would lose important context.

## Steps

1. **Identify scope** - Determine if the analysis targets a specific file, a feature area, a cross-cutting pattern, or the whole extension.

2. **Ask the user when ambiguous** - Before diving in, if the request is open to multiple valid interpretations, or if you are uncertain about a key assumption, **stop and ask the user** using the `AskUserQuestion` tool. See "When to ask the user" below.

3. **Read relevant sources** - Start from the appropriate entry points:
   - Extension lifecycle: `src/extension.ts`
   - Command registration: `src/commands.ts`, `src/commands/*.ts`
   - Command execution: `src/command-runner.ts`
   - Tree views: `src/hardis-commands-provider.ts`, `src/hardis-status-provider.ts`, `src/hardis-plugins-provider.ts`
   - WebSocket: `src/hardis-websocket-server.ts`
   - LWC panels: `src/webviews/lwc-ui-panel.ts`, `src/webviews/lwc-ui/modules/s/*/`
   - Utilities: `src/utils.ts`, `src/utils/*.ts`
   - Config/pipeline: `src/utils/pipeline/*.ts`
   - Git/ticket providers: `src/utils/gitProviders/*.ts`, `src/utils/ticketProviders/*.ts`
   - i18n: `src/i18n/i18n.ts`, `src/i18n/*.json`
   - Constants: `src/constants.ts`

4. **Trace the flow** - Follow the data and control flow across components. Key architectural patterns to keep in mind:
   - Commands are defined in `hardis-commands-provider.ts`, registered in `commands.ts`, executed via `command-runner.ts`
   - LWC panels communicate via a message bridge (`postMessage` / `onDidReceiveMessage`)
   - WebSocket server enables real-time CLI-to-Extension communication on ports 2702-2784
   - i18n: backend uses `t()` from `src/i18n/i18n.ts`, LWC uses `SharedMixin` with `this.i18n` / `this.t()`
   - Three webpack bundles: extension (Node), worker (Node), LWC webview (Web)

5. **Report findings** - Structure the analysis with:
   - What the code does (behavior)
   - How it connects to other components (dependencies and data flow)
   - Any issues, inconsistencies, or improvement opportunities found
   - Code references with file paths and line numbers
   - **Flag any remaining uncertainties explicitly** - if part of the analysis relies on an assumption you could not verify, say so and ask the user to confirm before they act on the finding.

## When to ask the user

Analysis tasks often have several valid angles. Don't guess silently — ask. Use the `AskUserQuestion` tool whenever any of the following apply:

- **Multiple valid scopes** — the request could target a single file, a feature area, or the whole extension. Example: "Analyze the pipeline view" could mean the LWC component, the data flow, the config helper, or all of them.
- **Multiple plausible interpretations** — the wording is ambiguous (e.g., "check how auth works" — Salesforce auth? Git provider auth? Ticket provider auth?).
- **Depth vs. breadth trade-off** — a deep audit of one component vs. a high-level survey of several. Ask which the user wants.
- **Output format unclear** — short summary, structured report, or actionable findings list with suggested fixes.
- **You hit a key uncertainty mid-analysis** — a behavior depends on runtime state, external config, or a code path you cannot fully verify by reading. Ask rather than fabricate.
- **Conflicting signals** — code, comments, or docs disagree. Ask the user which is authoritative before reporting.

### How to ask well
- Offer 2–4 concrete options whenever possible (the `AskUserQuestion` tool supports this directly). Do not present open-ended questions when a multiple-choice form would be clearer.
- Phrase options in user-facing language, not internal jargon.
- If a recommendation exists, put it first and mark `(Recommended)`.
- Batch related questions into a single `AskUserQuestion` call (up to 4 questions) rather than asking one-by-one.

### When NOT to ask
- The scope is genuinely obvious from context (e.g., user pointed at a single function).
- The question would only delay trivial work the user could just as easily redirect afterwards.
- You are simply reading code to confirm a fact — no need to ask permission.

## Key data flows to be aware of

- **Config schema loading**: `sfdxHardisConfigHelper.ts` is a singleton per workspace. It loads config schema from a remote URL first, with local fallback. It merges global/branch config and exposes fields grouped by `CONFIGURABLE_FIELDS` / `SECTIONS` for LWC config editors.
- **WebSocket prompt handling**: The CLI sends prompts via WebSocket. Prompts have types: `select` (rendered as VS Code QuickPick) and `text` (rendered as VS Code InputBox).
- **Pipeline PR/MR button**: Extension detects git provider and remote URL, calculates PR/MR page URL via `getPullRequestButtonInfo` utility, passes to pipeline LWC as `prButtonInfo` in initialization data.
- **Command execution flow**: Extension opens command execution LWC panel -> streams log lines, subcommand events, completion status via messages -> LWC can send cancellation or user input back.
- **Security**: WebSocket commands are validated (must start with `sf hardis`, no `&&`). LWC-to-extension messages are sanitized; only whitelisted commands and URLs are allowed.

## Edge cases

- LWC files under `src/webviews/lwc-ui/modules/s/` are compiled by the LWC Babel plugin, not TypeScript. Do not apply TypeScript analysis to them.
- The worker bundle (`src/worker.ts`) runs in a Node.js Worker Thread, not in the VS Code extension host.
- Some utilities (`src/utils.ts`) use multithread dispatch when `isMultithreadActive()` returns true.
- Config schema may be loaded from remote or local fallback - analyze both paths when investigating config issues.
