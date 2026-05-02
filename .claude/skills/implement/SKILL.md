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

## Steps

1. **Read existing code** before modifying. Understand the context and patterns already in use.

2. **Write code** following the style rules and patterns below.

3. **Add i18n translations** for any new user-facing strings (all 9 locale files).

4. **Verify** by running `yarn lint` and `yarn dev` (or `yarn build`).

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
- Use SLDS classes for styling - no custom CSS unless SLDS cannot provide it
- **No ternaries or expression evaluations in LWC HTML templates**
- Send messages to extension: `window.sendMessageToVSCode({ type, data })`

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
