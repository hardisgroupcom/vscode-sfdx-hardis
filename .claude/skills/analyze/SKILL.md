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

## Steps

1. **Identify scope** - Determine if the analysis targets a specific file, a feature area, a cross-cutting pattern, or the whole extension.

2. **Read relevant sources** - Start from the appropriate entry points:
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

3. **Trace the flow** - Follow the data and control flow across components. Key architectural patterns to keep in mind:
   - Commands are defined in `hardis-commands-provider.ts`, registered in `commands.ts`, executed via `command-runner.ts`
   - LWC panels communicate via a message bridge (`postMessage` / `onDidReceiveMessage`)
   - WebSocket server enables real-time CLI-to-Extension communication on ports 2702-2784
   - i18n: backend uses `t()` from `src/i18n/i18n.ts`, LWC uses `SharedMixin` with `this.i18n` / `this.t()`
   - Three webpack bundles: extension (Node), worker (Node), LWC webview (Web)

4. **Report findings** - Structure the analysis with:
   - What the code does (behavior)
   - How it connects to other components (dependencies and data flow)
   - Any issues, inconsistencies, or improvement opportunities found
   - Code references with file paths and line numbers

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
