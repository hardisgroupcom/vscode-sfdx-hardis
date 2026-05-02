---
name: design
description: Design new features, architectural changes, or refactors for the vscode-sfdx-hardis VS Code extension. Use when the user asks to plan, architect, or propose how to build something new or restructure existing code.
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: cloudity
  version: "1.0"
---

# Design

Design new features or architectural changes for the vscode-sfdx-hardis extension.

## Steps

1. **Understand requirements** - Clarify what the feature should do and who it serves (beginner consultants vs expert developers vs both).

2. **Map to existing architecture** - Identify which components are involved:
   - **New command**: Entry in `hardis-commands-provider.ts`, registration in `src/commands/`, icon in `themeUtils.ts`, i18n keys in all 9 locale files
   - **New LWC panel**: Component in `src/webviews/lwc-ui/modules/s/`, panel command in `src/commands/`, message protocol design
   - **New config field**: `CONFIGURABLE_FIELDS` + `SECTIONS` in `src/utils/pipeline/sfdxHardisConfigHelper.ts`, schema update
   - **New provider integration**: Follow patterns in `src/utils/gitProviders/` or `src/utils/ticketProviders/` (interface + implementation)

3. **Address key design decisions**:
   - **Execution mode**: Background (via `command-runner.ts` spawn) vs terminal vs LWC webview panel
   - **User input**: VS Code QuickPick/InputBox vs LWC prompt panel (via WebSocket)
   - **Data flow**: Direct CLI call vs cached result (`CacheManager`) vs WebSocket real-time
   - **i18n**: All user-facing strings need keys in all 9 locale files (`en`, `fr`, `es`, `de`, `it`, `nl`, `ja`, `pl`, `pt-BR`)
   - **Styling**: SLDS classes only, no custom CSS unless SLDS cannot provide it

4. **Follow existing patterns**:
   - Commands use `sf hardis:category:action` format (modern CLI, never legacy `sfdx`)
   - `TreeDataProvider` pattern for tree views
   - Message-based protocol for all LWC-to-Extension communication
   - `SharedMixin` for all new LWC components (provides i18n + theme)
   - Error handling: try/catch with `Logger.log()` + `vscode.window.showErrorMessage()`
   - Caching via `CacheManager` for expensive operations

5. **Consider integration points**:
   - **CLI execution**: `execSfdxJson()` for JSON output, `execCommandWithProgress()` for progress UI
   - **Git**: `simpleGit()` from `simple-git` for git operations
   - **Required extensions**: Salesforce Extension Pack (`salesforce.salesforcedx-vscode`)
   - **External tools**: SFDMU (data operations), sfdx-git-delta (package.xml from diff), MkDocs (docs, requires Python)
   - **Custom commands**: Users can define custom commands in `.sfdx-hardis.yml` (local or remote URL)

6. **Output a design document** covering:
   - Files to create or modify (with full paths)
   - Data flow diagram (if the feature involves multiple components)
   - Message types (if LWC panels are involved)
   - i18n keys needed
   - Configuration changes (if any)
   - Security considerations (WebSocket command validation, message sanitization)
   - Impact on existing features

## Edge cases

- If the feature touches the WebSocket server, consider port conflict handling (range 2702-2784, configurable via `SFDX_HARDIS_WEBSOCKET_PORT` env var).
- If adding a new LWC panel, remember the LWC HTML constraint: no ternaries or expression evaluations in templates.
- If the feature needs to work offline, avoid assumptions about remote schema/config availability - there are local fallbacks.
- WebSocket prompts support two types: `select` (QuickPick) and `text` (InputBox). Design user input accordingly.
- Test webview features in both light and dark VS Code themes, and with different org color settings.
- WebSocket commands must be validated: only `sf hardis` commands are allowed, no `&&` chaining.
