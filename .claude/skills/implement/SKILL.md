---
name: implement
description: Implement features, bug fixes, or refactors in the vscode-sfdx-hardis VS Code extension. Use when the user asks to write code, fix a bug, add a feature, or make changes to the codebase.
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: cloudity
  version: "1.0"
---

# Implement

Implement features, fixes, or changes in the vscode-sfdx-hardis extension.

## Delegation

A matching **`implement`** sub-agent is defined in `.claude/agents/implement.md`. Prefer delegating this task to the `implement` sub-agent via your tool's sub-agent mechanism so it runs with the dedicated tooling and configuration defined there. Handle it inline only when delegation would lose important context.

## Steps

1. **Read existing code** before modifying. Understand the context and patterns already in use.

2. **Write code** following the style rules and patterns below.

3. **Add i18n translations** for any new user-facing strings (all 9 locale files).

4. **Update CHANGELOG.md** with a concise, user-friendly entry describing the change (see "Changelog entry" section below).

5. **Verify** by running `yarn lint` and `yarn dev` (or `yarn build`).

## Changelog entry

After any change to the repo (new feature, bug fix, UI change, command added, etc.), add a bullet under the `## Unreleased` section at the top of `CHANGELOG.md`. If `## Unreleased` does not exist, create it just under the `# Changelog` title.

### Merging with existing Unreleased entries
**Always read the existing `## Unreleased` section first and merge your update with what is already there — do not append blindly.**

- If an existing bullet already covers the same feature, bug fix, or area, **update or extend that bullet** instead of adding a new one. Reword for clarity if needed.
- If your work is part of a larger new feature already mentioned in `## Unreleased`, **do not add a bullet for every incremental change** (sub-fix, polish, follow-up tweak). Keep a single high-level summary bullet describing the feature as a whole, and refine its wording as the feature evolves.
- Only add a new bullet when the change is genuinely separate from anything already listed (different feature, unrelated bug fix, etc.).
- When merging, preserve any sub-bullets that still describe distinct user-visible aspects; drop sub-bullets that have become redundant with the parent summary.

### Style rules
- **Concise** — one short sentence per bullet.
- **Use sub-bullets for multi-aspect features** — when a single feature has multiple distinct user-visible aspects (e.g. new UI control + new behavior + bug fix), write a short parent bullet describing the feature and indent sub-bullets (two spaces) for each aspect. NEVER pack several aspects into one long run-on sentence under a single bullet.
- **Non-technical** — written for end users (Salesforce consultants and developers), not for contributors. Describe *what they can now do* or *what is fixed*, not *how it was implemented*. This applies even when you avoid file/function names: do NOT describe the internal mechanism of a fix (caches, events, background/terminal modes, command-line flags, gates, validation rules, dist-tags like `@latest`, etc.). The user does not care *why* it was broken or *how* the plumbing now works — only that the feature/fix now behaves correctly. Stop the sentence at the user-visible outcome; cut any "... by/because/so that <internal reason>" clause.
- **User-friendly** — start with an action verb when possible (Add, Fix, Improve, Update, Remove). No file paths, no function names, no internal identifiers, no commit hashes, no PR numbers, no shell commands.
- **Do not mention** refactors, dependency bumps unrelated to user impact, lint fixes, test changes, or pure code cleanup. Skip the changelog entry entirely for these.
- Match the tone and granularity of existing entries. Always prefer parent-with-sub-bullets over a single long sentence when a change has 3+ distinct facets.

### Examples
Good:
- `- Add new menu entry to configure the Generic AI Prompt template in your org`
- `- Fix authentication error message when connecting to a Git provider`
- `- Improve performance when loading the list of installed plugins`

Good (multi-aspect feature with sub-bullets):
```
- Metadata Retriever: support folder-based types
  - Folder selector appears in All Metadata mode for Report/Dashboard/EmailTemplate/Document
  - Folder list cached 24h per org
  - Parent folder metadata auto-included on retrieve when missing locally
```

Bad (too technical / internal):
- `- Update hardis-commands-provider.ts to register new tree item`
- `- Refactor SharedMixin to expose i18n getter`
- `- Bump simple-git from 3.35.0 to 3.36.0`

Bad (multiple aspects packed into one run-on sentence — split into sub-bullets instead):
- `- Metadata Retriever: in All Metadata mode, when you pick a folder-based type, a Folder selector now appears and is required before searching, the folder list is fetched from the org and cached for 24 hours per org, and when retrieving items of these types the parent folder metadata is also pulled in automatically when missing locally.`

Bad (leaks the internal mechanism even though no file/function names appear — describe only the user-visible outcome):
- `- Dependencies panel: upgrading the CLI no longer fails because these maintenance commands now run in the visible terminal, bypassing the background-mode "registered commands only" gate (they chain steps with &&)`
- `- Dependencies panel: the CLI upgrade now pins the exact recommended version (npm install @salesforce/cli@<version> -g) instead of @latest, so the installed version matches the version the check compares against`
- `- Dependencies panel: after upgrading, the new version is detected immediately because the upgrade now triggers the refreshPlugins event which clears the cached sf --version result`

Good (same three fixes, stated as user-visible outcomes — and merged into one bullet since they all concern upgrading the CLI):
```
- Dependencies panel
  - Upgrading the Salesforce CLI or installing/upgrading sf CLI plugins no longer fails with an error
  - After upgrading the Salesforce CLI, it is no longer wrongly shown as still outdated, and the new version appears right away
```

### When unsure
If the change has no visible impact for users (pure internal refactor, test-only change, doc-only change inside source files), skip the changelog entry and mention this in your final summary to the user.

## Code style rules

### Brace style (enforced)
Always use `{}` after `if`, `else`, `for`, `while` - even for single statements. Always newline after `{` and before `}`:
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

### General
- Use `yarn` (not `npm`) for all package operations
- Use `sf` CLI commands (never legacy `sfdx`)
- Use `Logger.log()` for diagnostic output, not bare `console.log`

## TypeScript patterns (extension host)

- Import `t` from `./i18n/i18n` for all user-facing strings
- Use `CacheManager` for expensive/repeated operations (org info, git status, plugin versions)
- Follow the `register*` pattern in `src/commands/` for new commands
- Error handling: try/catch with `Logger.log()` + `vscode.window.showErrorMessage()`
- Execute CLI commands via `execSfdxJson("sf hardis:command")` or `execCommandWithProgress(command, message, label)`
- Git operations via `simpleGit()` from `simple-git`
- Use `--skipauth` flag for performance when org authentication check is not needed
- Implement lazy loading for tree views; use `preLoadCache()` for startup optimization

### Command structure object
```typescript
{
  id: "unique-command-id",
  label: t("translationKey"),
  tooltip: t("tooltipKey"),
  command: "sf hardis:category:action",
  requiresProject: true,
  helpUrl: "https://sfdx-hardis.cloudity.com/hardis/category/action/"
}
```

### WebSocket security
- WebSocket commands must start with `sf hardis` and must not contain `&&`
- Only whitelisted commands and URLs are allowed from LWC to extension
- All messages between LWC and extension must be validated and sanitized
- Never log usernames, org URLs with tokens, or passwords

## LWC patterns (webview UI)

- Components live in `src/webviews/lwc-ui/modules/s/<componentName>/`
- Each component needs `.js`, `.html`, `.css` files
- Extend `SharedMixin`:
  ```javascript
  import { SharedMixin } from "s/sharedMixin";
  export default class MyComponent extends SharedMixin(LightningElement) { ... }
  ```
- Use `{i18n.keyName}` in templates for static labels
- Use `this.t("key", { var: value })` in JS getters for dynamic/interpolated strings
- **No ternaries or expression evaluations in LWC HTML templates**
- Send messages to extension: `window.sendMessageToVSCode({ type, data })`

### LWC styling — global stylesheet + SLDS, theme-aware (dark + light mode)

VS Code webviews render in BOTH dark and light themes. Hardcoded colors break one of them. Every webview already loads two project-wide stylesheets (see `src/webviews/lwc-ui-panel.ts` `getHtmlForWebview`, around line 894) plus the official SLDS stylesheet — use those before writing custom CSS.

**Loaded globally on every webview:**
- `resources/global-theme.css` — project-wide reusable classes, pre-themed via `.slds-scope[data-theme="light"|"dark"]`.
- `resources/global-theme-variables.css` — SLDS palette tokens such as `--slds-g-color-palette-purple-40` (auto light/dark via the CSS `light-dark()` function).
- `out/assets/styles/salesforce-lightning-design-system.min.css` — the official SLDS library.

#### Lookup order before writing any new CSS rule

1. **Check `resources/global-theme.css` first.** Reusable, already-themed classes include:
   - **Page chrome**: `.header-section`, `.header-content` (+ `.no-bg`), `.header-text`, `.header-title` (+ `.single-line`), `.header-subtitle`.
   - **Icon containers** with `.green`, `.teal`, `.gray`, `.blue`, `.purple`, `.orange`, `.yellow`, `.small` color variants: `.header-icon-container`, `.feature-icon-container`, `.icon-container`.
   - **Command icons** with category colors: `.command-icon-container` + one of `.backup`, `.audit`, `.tests`, `.limits`, `.updates`, `.security`, `.legacy`, `.users`, `.licenses`, `.apex`, `.connected-apps`, `.metadata-access`, `.unused-metadata`, `.new-story`, `.pull-action`, `.package-action`, `.save-action`.
   - **Logs / answer / downloads / modals**: `.log-sections`, `.section-logs`, `.log-lines`, `.log-message`, `.log-timestamp`, `.log-icon`, `.answer-formatted`, `.download-panel`, `.select-option-desc`, `.submission-modal-backdrop`, `.submission-modal`.
   - If a class name already exists globally, NEVER redefine it in component CSS — the local rule will shadow the global one on specificity tie-breaking and silently break theming.

2. **Then check SLDS classes**: `.slds-badge` (+ `_lightest`, `_inverse`), `.slds-text-color_*`, `.slds-text-heading_*`, `.slds-box`, `.slds-button`, `.slds-icon`, etc. Reference: <https://www.lightningdesignsystem.com/>.

3. **Only if neither covers it**, write a small custom rule using **theme-aware tokens only**:
   - SLDS palette variables from `global-theme-variables.css` (e.g. `var(--slds-g-color-palette-purple-40)`, `var(--slds-g-color-palette-green-50)`).
   - VS Code theme tokens (`var(--vscode-foreground)`, `var(--vscode-editor-background)`, `var(--vscode-descriptionForeground)`, `var(--vscode-textLink-foreground)`, `inherit`, `currentColor`).
   - **Never** literal `#hex`, `rgb()`, `color: white`, `background: linear-gradient(#aaa, #bbb)`, `font-family: "Inter"`, `font-weight: 700`. These do not adapt and produce unreadable text in the opposite mode.

#### What's safe in component CSS

- **Layout-only properties**: `display`, `flex`, `gap`, `padding`, `margin`, `width`, `border-radius`, `overflow`, `position`. These carry no color/typography.
- **Compositions of global/SLDS classes**: wrapper classes that arrange already-themed children.

#### What's NOT safe

- Inventing a new badge / pill / chip / button rule with hardcoded colors. SLDS or the global stylesheet already ships one.
- Redefining a class name that already exists globally (e.g. `.header-icon-container.teal`, `.command-icon-container.audit`) — your rule wins on specificity tie-breaking and silently disables the theme-aware version.
- "Just for now" hex colors with a TODO. There's no theme switch event — the bad render ships.
- Some existing components (e.g. parts of `monitoringConfig.css`) already redefine global classes with hardcoded hex colors. Treat these as legacy bugs, not patterns — do not copy them.

## i18n checklist

When adding user-facing strings:
1. Add key to `src/i18n/en.json` (English, source of truth)
2. Add same key to all other locale files: `fr.json`, `es.json`, `de.json`, `it.json`, `nl.json`, `ja.json`, `pl.json`, `pt-BR.json`
3. Keep flat JSON structure, camelCase keys, alphabetical order
4. Use `{{varName}}` for interpolation variables
5. Preserve `{{varName}}` placeholders and `<br/>` tags exactly as-is in all languages
6. Look at other translations in the same language file for terminology and style consistency

### What to translate
- Labels, tooltips, error messages, warning messages, section titles, user-visible descriptions
- User-targeted properties: `message`, `description`
- 3rd argument of calls to `execCommandWithProgress()`
- Arguments of `showErrorMessage`, `showInformationMessage`, `showWarning`, `updateTitle`

### What NOT to translate
Command IDs, file paths, CSS classes, brand names (Salesforce, GitHub, SFDMU, MegaLinter, Cloudity), technical terms (merge, commit, branch, scratch org, package.xml, Apex, SOQL, DevHub, CLI flags), `[markers]` in brackets

## Recipes

### Adding a new command
1. Define in `hardis-commands-provider.ts` with `id`, `label: t("key")`, `command`, `tooltip: t("tooltipKey")`, `requiresProject`, `helpUrl`
2. Add icon mapping in `themeUtils.ts` `getAllCommandIcons()`
3. Create `src/commands/myCommand.ts` with a `register*` function
4. Import and call the register function in `src/commands.ts`

### Adding a new LWC panel
1. Create `src/webviews/lwc-ui/modules/s/<name>/` with `.js`, `.html`, `.css`
2. Create `src/commands/show<Name>.ts` with register function using `LwcUiPanel.display()`
3. Register in `src/commands.ts`
4. Define message types for Extension-to-LWC communication

### Adding a new config field
1. Add to `CONFIGURABLE_FIELDS` in `src/utils/pipeline/sfdxHardisConfigHelper.ts`
2. Add to the appropriate `SECTIONS` group
3. Update schema if needed - LWC config editors auto-reflect changes

## Verification

After implementing:
1. `yarn lint` - Check for ESLint issues
2. `yarn dev` or `yarn build` - Verify webpack compilation succeeds
3. Test in VS Code Extension Development Host (F5)
4. Confirm `CHANGELOG.md` has a user-friendly entry under `## Unreleased` (or that the change is internal-only and was intentionally skipped)
