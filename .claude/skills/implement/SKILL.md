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

### Formatting — never run Prettier on LWC `.html` or `CHANGELOG.md`
MegaLinter has HTML linting disabled, so Prettier is not the formatter of record for these files. Running it rewrites the whole file: a 20-line change becomes a 600-line diff that hides the real edit and blows up review. **Edit LWC templates and the changelog by hand.**

### Dependencies — check for a built-in before adding one
Runtime dependencies were deliberately reduced from 28 to 14. Before adding a package: HTTP goes through `src/utils/httpUtils.ts` (`getJson` / `getText` / `ping`, built on Node's `fetch`), binary lookup through `executableUtils.ts` (`findExecutable`), free ports through `portUtils.ts`, child processes through `processUtils.ts`. Keep `engines.vscode` at `^1.95` — it guarantees a Node runtime with proxy-aware `fetch`.

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
   - **Surfaces**: `.panel-surface`, `.docs-section`, `.config-section`, `.setup-summary-card`, `.status-card` (+ `.summary`, `.installed`, `.not-installed`, `.cicd`), `.pipeline-container`.
   - **Section & card kit** (the v8 design system — see the dedicated section below): `.hardis-group-label`, `.hardis-group-desc`, `.hardis-card-grid` (+ `.single-column`), `.hardis-card` (+ `.clickable`, `.featured`, `.disabled`), `.hardis-card-head` / `-title` / `-desc` / `-actions` / `-arrow`, `.hardis-tile` (+ `.featured` / `.small` sizes and color hues).
   - **Icon containers** (page headers and status cards only) with `.green`, `.teal`, `.gray`, `.blue`, `.purple`, `.orange`, `.yellow`, `.small` color variants: `.header-icon-container`, `.icon-container`. Status variants: `.status-icon-container` + `.info`, `.success`, `.warning`.
   - **DEPRECATED — never use in panels**: `.command-card`, `.commands-grid`, `.command-icon-container.*`, `.feature-icon-container.*`. They are kept in global-theme.css only for user-provided `welcomeIconClass` values in `.sfdx-hardis.yml` (and setup.html's own status grid). New or modified panels must use the hardis-* section & card kit instead.
   - **Typography helpers**: `.section-title`, `.section-subtitle`, `.info-title`, `.info-label`, `.info-value`, `.type-name`, `.member-name`, `.empty-title`, `.empty-description`, `.error-description`, `.loading-text`, `.muted`.
   - **Logs / answer / downloads / modals**: `.log-sections`, `.section-logs`, `.log-lines`, `.log-message`, `.log-timestamp`, `.log-icon`, `.log-container`, `.answer-formatted`, `.download-panel`, `.select-option-desc`, `.submission-modal-backdrop`, `.submission-modal`, `.modal-accent-strip`, `.modal-title-parts`, `.modal-count-badge`, `.tabbed-modal-container`, `.tabbed-modal-content`.
   - **Shared SLDS UI kit** (added by the DevOps Pipeline restyle — use these for ANY status/identity/branch rendering, see next section): `.hardis-pill` + `.hardis-pill-dot`, `.hardis-status-{success,running,pending,failed,unknown}`, `.hardis-avatar` + `.hardis-avatar-c0`…`-c5` + `.hardis-avatar-name`, `.hardis-branch-chip`, `.hardis-date-cell`, `.hardis-cell-flex`, `.hardis-btn-tinted-green`, `.rf-type-action` / `.rf-type-report` / `.rf-type-doc`, `.slds-no-row-hover`.
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
- Redefining a class name that already exists globally (e.g. `.header-icon-container.teal`, `.hardis-card`, `.hardis-tile.violet`) — your rule wins on specificity tie-breaking and silently disables the theme-aware version.
- "Just for now" hex colors with a TODO. There's no theme switch event — the bad render ships.
- **Copying an existing component's CSS.** Some component stylesheets still contain hardcoded colors — `dataWorkbench.css` (~70), `filesWorkbench.css` (~65), `packageXml.css` (~39), `setup.css` (~29), `orgMonitoring.css` (~18). These are **legacy bugs awaiting migration, not patterns**. Never use them as a reference; when you touch one of these files, prefer migrating the rules you touch to global/SLDS classes. (`welcome.css`, `pipeline.css`, `monitoringConfig.css` and the documentation panels were already migrated — use those as references instead.)

Quick check on any CSS you wrote:

```bash
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family|font-weight: *[0-9]" src/webviews/lwc-ui/modules/s/<component>/<component>.css
```

#### Sections, cards and icon tiles (the hardis-* design kit)

Any panel that presents a catalog of features, commands or actions uses the generic kit from `global-theme.css` (introduced by the v8 Welcome redesign, already applied to Welcome, Org Monitoring, the Pipeline workflow tab, both Documentation panels and Monitoring Config). Never rebuild sections/cards per panel.

**Section**: an uppercase label with a rule line, plus an optional one-line description:

```html
<div class="hardis-group-label">{i18n.sectionTitle}</div>
<p class="hardis-group-desc">{i18n.sectionDescription}</p>
<div class="hardis-card-grid"> ... cards ... </div>
```

No emoji in section labels. `.hardis-card-grid` is a responsive `auto-fill minmax(280px, 1fr)` grid; add `.single-column` for a stacked list.

**Card anatomy** (head = tile + title, then description, then optional actions):

```html
<div class="hardis-card clickable" role="button" tabindex="0"
     data-command={row.command} onclick={handleRunCommand} onkeydown={handleCardKeydown}>
  <div class="hardis-card-head">
    <div class="hardis-tile small violet">
      <lightning-icon icon-name="utility:shield" size="x-small"></lightning-icon>
    </div>
    <h3 class="hardis-card-title">{row.title}</h3>
  </div>
  <p class="hardis-card-desc">{row.description}</p>
  <div class="hardis-card-arrow">→</div>
</div>
```

- **Prefer the whole card being clickable over a per-card "Run"/"Open" button** — one obvious action per card = clickable card (`.clickable` + `role="button"` + `tabindex="0"` + `onkeydown` handler that clicks on Enter/Space + the `.hardis-card-arrow`). Keep a `.hardis-card-actions` row of buttons only when a card genuinely has several distinct actions (e.g. Documentation Workbench generate vs. deploy).
- `.featured` makes the card bigger with a brand-gradient top edge (Welcome essentials row); `.disabled` greys it out and disables hover.
- **Icon tiles**: `.hardis-tile` (+ size `.featured`/`.small`) with a hue class — real hues `cyan teal violet amber slate indigo pink green red` and semantic aliases matching catalog `colorClass` values (`backup`→cyan, `audit`→violet, `security`/`alerts`→red, `tests`→green, `apex`/`limits`→amber, `cloudflare`→teal, `confluence`→indigo, `prompts`→violet, …). Unknown hues fall back to slate. In JS, compose the class as `"hardis-tile small " + colorClass`.
- **Never put `variant="inverse"` on a `lightning-icon` inside a `.hardis-tile`** — the tile is a soft tint, an inverse (white) icon becomes invisible in light mode. The tile colors the icon via `color: inherit`.
- Because LWC templates allow no expressions, computed card/tile classes (`cardClass`, `tileClass`, disabled state) must be **fully computed in JS getters**.
- Layout gotcha: a container with `overflow: hidden` (e.g. a hero band clipping a decorative background) will clip dropdowns/popovers opened inside it. Put the clipping on a dedicated `position:absolute; inset:0; overflow:hidden` background layer instead of the container itself.

#### Semantic status colors (always use the kit, never invent a mapping)

The status palette is fixed project-wide: **green = success, blue = running (dot pulses), orange = pending, red = failed, neutral = unknown**.

Render a status as a pill:

```html
<span class="hardis-pill hardis-status-success">
  <span class="hardis-pill-dot"></span>Success
</span>
```

- `.hardis-pill-dot` alone (with a `.hardis-status-*` class) is the standalone dot used in legends and mermaid nodes.
- The running dot animation already honors `prefers-reduced-motion`. Don't re-add animations.
- Never build a status color with `variant="success"` badges, custom hexes, or an ad-hoc red/green mapping.

#### Tables: use `s-hardis-datatable`

`src/webviews/lwc-ui/modules/s/hardisDatatable/` extends `lightning-datatable` with three shared cell types, already themed by `global-theme.css` (zebra striping, quiet uppercase headers, hover). Adopted by `pipeline`, `orgManager`, `metadataRetriever`, `dataWorkbench`, `installedPackages` — use it for any new table rather than a raw `lightning-datatable` or a hand-rolled `<table>`.

| Cell type | Renders | `typeAttributes` |
|-----------|---------|------------------|
| `statusPill` | Status pill (dot + label), optionally linking to the CI job | `label`, `pillClass` (fully computed, e.g. `"hardis-pill hardis-status-success"`), `url` |
| `avatarText` | Initials avatar circle + text | `initials`, `avatarClass` (computed color variant) |
| `branchChip`  | Monospace chip for technical ids (git branches); full value on hover | none |

Because LWC templates allow no expressions, `pillClass` / `avatarClass` must be **fully computed in JS** before reaching the template. Use `s/avatarUtils` (`getAvatarClass()`, `getInitials()`, `getUsernameInitials()`, `hashString()`) so the same person keeps the same initials and avatar color across every panel. Add `.slds-no-row-hover` on the table when rows aren't clickable.

#### Buttons

Only the **neutral** SLDS button variant adapts to VS Code themes. Filled `variant="success"` / `variant="brand"` buttons keep their Salesforce colors and render badly in webviews. For a colored action button, wrap a neutral button in a tinted class that recolors it with palette tokens — `.hardis-btn-tinted-green`, or the `.rf-type-action` / `.rf-type-report` / `.rf-type-doc` family. Follow the same recipe (palette-token background/border/color + `fill: currentColor` on the icon) if a new tint is genuinely needed, and put it in `global-theme.css`, not in a component.

#### Stale stylesheets

The webview service worker can keep serving an outdated copy of the global stylesheets across extension updates and Extension Development Host rebuilds. `lwc-ui-panel.ts` appends `?v=<Date.now()>` at panel creation to force a fresh fetch. **If a CSS change doesn't appear, close and reopen the panel before suspecting the rule.**

#### SVG / mermaid (DevOps Pipeline diagram)

The pipeline diagram is generated by `src/utils/pipeline/branchStrategyMermaidBuilder.ts` and post-processed in `pipeline.js`:

- **Style injected SVG elements inline (`style` attribute), not via a stylesheet.** Mermaid compiles its `classDef`s into `#id .cls>*{stroke:...!important}` rules that hit any element you add to a node — without an explicit inline `stroke:none` your glyphs get outlined in the node border color. Inline styles are also immune to a stale cached stylesheet. `_drawNodeCountBubble()` is the reference implementation.
- **Set every paint property explicitly**, including an explicit `font-family` (otherwise mermaid's default Trebuchet MS leaks in) and rounded/integer coordinates.
- Node labels are HTML chips reusing `.hardis-pill` / `.hardis-status-*`, so status colors stay consistent with the tables.
- Edge coloring goes through `link.renderType` (base type + status suffix) mapped to a `linkStyle` declaration; **`linkStyle` indexes follow link declaration order** — reorder links and you silently recolor the wrong edge.
- Mermaid node names are sanitized (`sanitizeNodeName()`, e.g. `/` becomes `_`); never build a node id from a raw branch name.

## i18n checklist

When adding user-facing strings:
1. Add key to `src/i18n/en.json` (English, source of truth)
2. Add same key to all other locale files: `fr.json`, `es.json`, `de.json`, `it.json`, `nl.json`, `ja.json`, `pl.json`, `pt-BR.json`
3. Keep flat JSON structure and camelCase keys. Ordering is **case-sensitive ASCII sort** (JavaScript default `sort()`), not case-insensitive alphabetical — uppercase-first keys sort *before* lowercase ones. Locate the real neighboring keys in `en.json` first, then insert at the same position in all 9 files. Verify with:
   ```bash
   node -e "const k=Object.keys(require('./src/i18n/en.json'));console.log(JSON.stringify(k)===JSON.stringify([...k].sort()))"
   ```
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
5. **Never block the panel opening on data loading.** Create the panel immediately with `lwcManager.getOrCreatePanel("s-<name>", { loading: true })`, then feed it through a `loadAndPush()` function, and handle the LWC's `retryInit` message so the user can retry after a failure. The component itself handles three states (loading / loaded / error). Reference implementations: `src/commands/showDataWorkbench.ts`, `src/commands/showDocumentationWorkbench.ts`.
6. For tabular data, use `s-hardis-datatable` with the shared cell types rather than a raw table.

### Command panels and performance invariants
- Command panels are created **before** the CLI answers. `command-runner.ts` generates a provisional context id, passes it to the CLI as the `SFDX_HARDIS_COMMAND_CONTEXT_ID` env var and calls `registerPendingCommandPanel()`; `hardis-websocket-server.ts` then adopts that panel via `takePendingCommandPanel()`. If you add a new way to launch a command, keep this handshake or the user gets a duplicate empty tab.
- Track panel lifecycle with the **`panel.commandStatus`** flag (`pending` / `running` / `completed` / `error`). Never infer state by parsing panel titles.
- File watchers: use `.some()` rather than `.filter()` when you only need existence.
- **Load heavy providers with `await import(...)`, not a top-level import.** The extension bundle is built with `module: "es2020"` in `webpack.common.js` specifically so dynamic imports survive into real webpack chunks instead of being bundled into the eagerly-parsed main file. A static import of a heavy module silently undoes that and slows activation.

### Adding a new config field
1. Add to `CONFIGURABLE_FIELDS` in `src/utils/pipeline/sfdxHardisConfigHelper.ts`
2. Add to the appropriate `SECTIONS` group
3. Update schema if needed - LWC config editors auto-reflect changes

## Verification

After implementing:
1. `yarn lint` - Check for ESLint issues
2. `yarn dev` or `yarn build` - Verify webpack compilation succeeds
3. Test in VS Code Extension Development Host (F5)
4. For webview changes, check the panel in **both** dark and light VS Code themes
5. For changes touching command launching, tree views or panels: `yarn dev && yarn compile && yarn test:ui` (build order matters)
6. Confirm `CHANGELOG.md` has a user-friendly entry under `## Unreleased` (or that the change is internal-only and was intentionally skipped)
