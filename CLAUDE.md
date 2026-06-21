# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension for **SFDX Hardis** (by Cloudity) - provides an intuitive UI for Salesforce DX, simplifying development, deployment, and CI/CD. Target users range from beginner consultants to expert developers.

- Publisher: `NicolasVuillamy` | License: AGPL-3.0
- CLI dependency: `sfdx-hardis` plugin for Salesforce CLI (`sf`, never legacy `sfdx`)
- Documentation: <https://sfdx-hardis.cloudity.com/>

## Build & Development Commands

```bash
yarn install              # Install dependencies (always use yarn, not npm)
yarn build                # Production build (clean + webpack prod)
yarn dev                  # Development build (webpack dev, single run)
yarn watch                # Development build with file watching
yarn lint                 # ESLint check
yarn lint:fix             # ESLint auto-fix
yarn compile              # TypeScript compilation (tsc, used for tests)
yarn test                 # Run tests (requires prior compile: yarn pretest)
yarn vsix                 # Package as .vsix for distribution
```

### Prebuild steps (run automatically before `yarn build`)
- `yarn sync:schema` - Syncs JSON schema from remote
- `yarn sync:metadata-list` - Syncs metadata list

### Testing locally in VS Code
Press F5 in VS Code to launch the Extension Development Host with the extension loaded.

## Architecture

### Webpack Build System (3 bundles)
Defined in `webpack.common.js`, with `webpack.dev.js` and `webpack.prod.js` overlays:

1. **Extension bundle** (`src/extension.ts` -> `out/extension.js`) - Node target, TypeScript via ts-loader
2. **Worker bundle** (`src/worker.ts` -> `out/worker.js`) - Node target, for multithread CLI execution
3. **LWC Webview bundle** (`src/webviews/lwc-ui/index.js` -> `out/webviews/lwc-ui.js`) - Web target, Babel + LWC compiler

### Core Components

| Component         | File                              | Role                                                 |
|-------------------|-----------------------------------|------------------------------------------------------|
| Entry point       | `src/extension.ts`                | Activation, init telemetry/providers/WebSocket       |
| Command registry  | `src/commands.ts`                 | Registers all VS Code commands                       |
| Command runner    | `src/command-runner.ts`           | Terminal management, background/foreground execution |
| Commands tree     | `src/hardis-commands-provider.ts` | TreeDataProvider for command menu (200+ commands)    |
| Status tree       | `src/hardis-status-provider.ts`   | Org info, git status, expiration                     |
| Plugins tree      | `src/hardis-plugins-provider.ts`  | Dependency tracking and updates                      |
| WebSocket server  | `src/hardis-websocket-server.ts`  | Real-time CLI communication (ports 2702-2784)        |
| LWC Panel manager | `src/lwc-panel-manager.ts`        | Manages webview panel lifecycle                      |
| LWC Panel base    | `src/webviews/lwc-ui-panel.ts`    | Creates webview panels, message bridge               |
| Colors            | `src/hardis-colors.ts`            | Org-based VS Code theme coloring                     |
| Logger            | `src/logger.ts`                   | Output channel logging                               |
| Constants         | `src/constants.ts`                | Version requirements, URLs                           |

### Utility Modules (`src/utils/`)
- `cache-manager.ts` - Global state caching with expiration
- `themeUtils.ts` - Icon/emoji theming for tree views
- `orgUtils.ts`, `orgConfigUtils.ts` - Salesforce org helpers
- `projectUtils.ts` - SFDX project detection
- `pipeline/sfdxHardisConfigHelper.ts` - Singleton config helper, schema loading, LWC config editors
- `pipeline/branchStrategyMermaidBuilder.ts` - Pipeline diagram generation
- `sfdx-hardis-config-utils.ts` - Custom commands/plugins from `.sfdx-hardis.yml`
- `gitProviders/` - GitHub, GitLab, Bitbucket, Azure DevOps, Gitea integrations
- `ticketProviders/` - Jira, Azure Boards, generic ticket integrations
- `providerCredentials.ts` - Secure credential handling for git/ticket providers

### Command Registration Pattern
Each command in `src/commands/` exports a `register*` function called from `src/commands.ts`. Commands that open webview panels create an `LwcUiPanel` with initialization data.

### LWC Webview UI
All custom UI uses Lightning Web Components rendered in VS Code webviews.

- **Bootstrap**: `src/webviews/lwc-ui/index.js` - Reads `data-lwc-id` and `data-init-data` from the DOM, instantiates the correct LWC component
- **Components**: `src/webviews/lwc-ui/modules/s/` - Each component has `.js`, `.html`, `.css`
- **SharedMixin**: `src/webviews/lwc-ui/modules/s/sharedMixin/sharedMixin.js` - Provides i18n (`this.i18n`, `this.t()`) and theme helpers to all LWC components
- **Styling**: SLDS (Salesforce Lightning Design System) is the default. Avoid custom CSS unless SLDS cannot provide the style.
- **Message bridge**: `window.sendMessageToVSCode(message)` (LWC->Extension) and `panel.webview.postMessage(message)` (Extension->LWC)

Key message types: `initialize`, `openExternal`, `runCommand`, `refreshPipeline`, `addLogLine`, `completeCommand`, `openFile`, `downloadFile`

**LWC constraint**: No ternaries or expression evaluations in HTML templates.

## Code Style

### Brace style
Always use `{}` after `if`, `else`, `for`, `while`, even for single statements. Always newline after `{` and before `}`:
```typescript
if (condition) {
  // ...
}
else {
  // ...
}
```

### Naming conventions (enforced by ESLint)
- Variables/parameters: `camelCase` (leading underscore allowed)
- Constants: `UPPER_CASE`
- Types/classes: `PascalCase`
- Object properties: any format allowed (for command IDs, config keys)

### CLI commands
Always use modern `sf` CLI format: `sf hardis:category:action [options]`. Never use legacy `sfdx`.

## Dependencies & Integration Points

### Required VS Code Extensions
- Salesforce Extension Pack (`salesforce.salesforcedx-vscode`)

### External Tools
- **SFDMU** (Salesforce Data Move Utility) - Data import/export operations
- **sfdx-git-delta** - Package.xml generation from git diff
- **MkDocs** - Documentation generation (requires Python)

### Key Integration Functions
- `execSfdxJson(command)` / `execCommandWithProgress(command, message, label)` - Execute CLI commands
- `simpleGit()` from `simple-git` - Git operations
- `CacheManager` - VS Code globalState-backed cache with expiration

### Security
- WebSocket commands are validated: must start with `sf hardis` and must not contain `&&`
- Only whitelisted commands and URLs are allowed from LWC to extension
- All messages between LWC and extension are validated and sanitized
- Never log usernames, org URLs with tokens, or passwords

## Internationalization (i18n)

All user-facing strings must be translated. Uses `i18next`.

### Supported locales
`en`, `fr`, `es`, `de`, `it`, `nl`, `ja`, `pl`, `pt-BR` - Translation files in `src/i18n/*.json`

### Backend (TypeScript)
```typescript
import { t } from "./i18n/i18n";
t("keyName")                          // Simple
t("keyName", { varName: value })      // With interpolation
```

### Frontend (LWC)
Components extend `SharedMixin`. In templates use `{i18n.keyName}` for static labels. In JS use `this.t("key", { var: value })` for interpolated strings via a getter.

### Adding new translatable strings
1. Add key to **all** locale files in `src/i18n/` (keep alphabetical order, flat JSON, camelCase keys)
2. Use `{{varName}}` for interpolation variables

### What to translate
- Labels, tooltips, error messages, warning messages, section titles, descriptions shown to users
- User-targeted properties: `message`, `description`
- 3rd argument of calls to `execCommandWithProgress()`
- Arguments of `showErrorMessage`, `showInformationMessage`, `showWarning`, `updateTitle`

### What NOT to translate
Technical identifiers, command IDs, file paths, CSS classes, brand names (Salesforce, GitHub, SFDMU, etc.), technical terms (merge, commit, branch, scratch org, package.xml, Apex, SOQL, DevHub)

### Translation consistency
When writing translations, look at other translations in the same language file to use the same terminology and style for consistency. Preserve `{{varName}}` placeholders and `<br/>` tags exactly as-is in all languages.

### Translation style by language
- **French**: Formal ("vous"), official Salesforce French terminology
- **Spanish**: Formal ("usted"), Latin American neutral
- **German**: Formal ("Sie"), standard IT terminology
- **Dutch**: Informal ("je/jij")
- **Italian**: Informal ("tu")
- **Japanese**: Natural UI wording, reuse upstream sfdx-hardis terminology

## CI/CD

- **GitHub Actions** in `.github/workflows/`:
  - `test.yml` - Lint + compile + test on Node 22/24 (Ubuntu + Windows)
  - `mega-linter.yml` - MegaLinter comprehensive code analysis
  - `deploy-preview.yml` / `deploy-RELEASE.yml` - Extension publishing
- **MegaLinter** config in `.mega-linter.yml` - CSS/HTML disabled, Prettier for JS/TS style

## Key Patterns

### Caching
Use `CacheManager` (backed by VS Code globalState) for expensive operations. `preLoadCache()` runs at startup.

### Error handling
```typescript
try {
  const result = await execSfdxJson("sf hardis:command");
} catch (error) {
  Logger.log(`Error: ${error.message}`);
  vscode.window.showErrorMessage("User-friendly message");
}
```

### Adding new commands to the tree
1. Add command definition in `hardis-commands-provider.ts` with `id`, `label` (using `t()`), `command`, `tooltip`, `requiresProject`, `helpUrl`
2. Add icon mapping in `themeUtils.ts`
3. Register VS Code command in `src/commands/` and import in `src/commands.ts`

### Adding new LWC panels
1. Create component folder in `src/webviews/lwc-ui/modules/s/` with `.js`, `.html`, `.css`
2. Register the panel command in `src/commands/`
3. Use the message protocol for Extension<->LWC communication

### Adding new config fields
1. Add to `CONFIGURABLE_FIELDS` in `src/utils/pipeline/sfdxHardisConfigHelper.ts`
2. Add to the appropriate `SECTIONS` group
3. Update schema if needed - LWC config editors auto-reflect changes
