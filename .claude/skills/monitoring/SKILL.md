---
name: monitoring
description: Add a new monitoring command to the vscode-sfdx-hardis VS Code extension. Use when the user asks to add, register, or wire up a monitoring command (sf hardis:org:monitor:* or sf hardis:org:diagnose:* shown in the Org Monitoring menu and Monitoring Config Workbench).
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: cloudity
  version: "1.0"
---

# Monitoring

Add a new monitoring command to the extension so it shows up in the **Org Monitoring** tree menu, the **Org Monitoring home LWC** (manual-run cards), and the **Monitoring Config Workbench** (frequency + per-channel notification thresholds).

## Background — how monitoring commands work in this repo

The canonical list of monitoring commands and notification types lives **in the sfdx-hardis CLI plugin** (external to this repo), exposed via `sf hardis:config:monitoring-defaults --json`. Both the **Monitoring Config Workbench** *and* the **Org Monitoring home LWC** fetch that catalog dynamically (`fetchMonitoringCatalog()` in `src/utils/monitoringConfigUtils.ts`) and render their content from `monitoringCommands[]`, `notificationConfig[]`, and `categories[]` — **no hardcoding of the command list in this repo**.

Catalog caching:
- The CLI response is cached for **7 days** (`cacheExpiration: 1000 * 60 * 60 * 24 * 7`).
- The **Refresh** button on the Org Monitoring home calls `clearMonitoringCatalogCache()` and re-fetches, so users can pull in new CLI commands without restarting VS Code.

What this repo still needs to do per new monitoring command:
- Register the command in the **Org Monitoring tree menu** (sidebar tree, separate from the LWC).
- Provide **i18n labels and tooltips** for the tree entry.
- Optionally, map a nice **icon** for the Org Monitoring home LWC cards, the Monitoring Config Workbench rows, and the tree view.

What this repo does **not** need to do per new monitoring command:
- No code change in `orgMonitoring.js` / `orgMonitoring.html` for the manual-run card — the card is generated automatically from the CLI catalog entry's `title`, `description`, `command`, and `category`.
- No new i18n keys for card title / description / button label — the CLI catalog provides the user-facing strings, and the run button uses the generic `runCommandLabel` key that already exists in all 9 locales.

If the command does not appear in the Org Monitoring home or the Config Workbench, the CLI catalog is the place to look — not this repo.

## Two top-level catalog lists

The CLI payload (`sf hardis:config:monitoring-defaults --json`) is split into two parallel arrays — they are surfaced differently and must not be mixed up:

```jsonc
{
  "monitoringCommands": [{ "key": "...", "command": "sf hardis:...", "frequency": "daily", "category": "orgActivity", "notificationTypes": ["APEX_ERROR", "FLOW_ERROR"] }, ...],
  "notificationConfig":  [
    { "key": "APEX_ERROR", "category": "orgActivity",
      "notifications": { "messaging": "warning", "email": "error", "api": "log" },
      "availableThresholds": ["error", "warning", "success", "off"] }  // severities this type can emit, last is always "off"
  ],
  "categories":          [{ "key": "orgActivity", "title": "Org Activity", "order": 1 }, ...],
  "options":             { "frequencies": [...], "frequencyDays": [...], "thresholds": [...], "channels": [...] }
}
```

`notificationConfig[].availableThresholds` is the per-type allow-list driving the threshold dropdowns in the Workbench. **Always use it as the option source for messaging / email / api selectors**, not the global `options.thresholds`. When a saved user override under `notificationConfig:` in `.sfdx-hardis.yml` falls outside this list, the row renders a warning icon — the override is preserved but it behaves as `off` at runtime. If `availableThresholds` is missing from a payload (older CLI), `monitoringConfig.js` falls back to `options.thresholds`.

| List                   | Carries                                                    | Org Monitoring home (Run cards)                              | Monitoring Config Workbench                                                                                                                             |
|------------------------|------------------------------------------------------------|--------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| `monitoringCommands[]` | `command`, `frequency`, `notificationTypes[]` (cross-refs) | Shown — user can launch it. Frequency is metadata only here. | Shown — frequency editable. **No threshold editors on the command row itself.** Each command expands into sub-rows for the notification types it emits. |
| `notificationConfig[]` | `notifications.{messaging,email,api}` thresholds           | **Hidden** — no `command`, not runnable.                     | Sub-rows beneath a command (when referenced via `notificationTypes`) OR a final **Standalone notifications** section (when referenced by no command).   |

Rules:
- `orgMonitoring.js`'s `categorySections` iterates `catalog.monitoringCommands` directly and requires `entry.command` to be truthy — there's nothing else to filter.
- `monitoringConfig.js` (`rowsByCategory()`) iterates `catalog.monitoringCommands` per category and attaches child rows by looking up each key in `notificationConfig[]`. Any `notificationConfig` entry never referenced by `notificationTypes` becomes a standalone row.
- User overrides live in **two separate YAML keys** in `.sfdx-hardis.yml`:
  - `monitoringCommands:` — `frequency`, `frequencyDay`, `frequencyDayOfMonth`, custom commands, optional override `notificationTypes:`.
  - `notificationConfig:` — `notifications.{messaging,email,api}` thresholds and email recipients, keyed by notification-type key.
- Thresholds NEVER live under `monitoringCommands:` anymore. The save path enforces this; `cleanForSave()` in `monitoringConfig.js` outputs the two arrays separately.
- When adding a brand-new notification type to the CLI catalog, add it to `notificationConfig[]` with a `category` reference. Either reference it from a command via `notificationTypes` (it will appear as a sub-row under that command) or leave it unreferenced (it will appear in the **Standalone notifications** section).

## Steps (in order)

1. **Confirm the CLI side first.** Before editing anything here, verify the command is published in `sf hardis:config:monitoring-defaults --json` output (under `monitoringCommands[].key` / `monitoringCommands[].command`). For a new notification type, verify it lives under `notificationConfig[]`. If it's not there yet, the Workbench will not pick it up — flag this to the user and stop, unless they explicitly want only the tree-menu entry.

2. **Register the command in the Org Monitoring tree menu.** Edit `src/hardis-commands-provider.ts`, in the `org-monitoring` topic block (around lines 611-770 — look for `id: "org-monitoring"`). Add a new entry following the existing pattern:
   ```typescript
   {
     id: "hardis:org:monitor:<name>",            // or hardis:org:diagnose:<name>
     label: t("<labelKey>"),
     tooltip: t("<tooltipKey>"),
     command: "sf hardis:org:monitor:<name>",    // or sf hardis:org:diagnose:<name>
     helpUrl: DOCSITE_URL + "/hardis/org/monitor/<name>/",
   },
   ```
   Notes:
   - The `id` and `command` must match the CLI command exactly (use `sf`, never legacy `sfdx`).
   - `requiresProject: true` only if the command needs a local SFDX project (e.g. test, lint, deploy-related). Pure org-side diagnostics usually omit it.
   - `helpUrl` follows `https://sfdx-hardis.cloudity.com/hardis/<topic>/<verb>/<name>/`. Verify the doc page exists before committing.

3. **Add i18n keys to all 9 locale files** (`src/i18n/en.json`, `fr.json`, `es.json`, `de.json`, `it.json`, `nl.json`, `ja.json`, `pl.json`, `pt-BR.json`) for the tree entry only:
   - `<labelKey>` — short, action-oriented label shown in the tree (e.g. `"Detect Suspicious Audit Trail Activities"`)
   - `<tooltipKey>` — one-sentence explanation of what the command does

   Keep keys in alphabetical order, flat JSON, camelCase. Use existing audit-trail / health-check entries as a reference for tone in each language. Follow the language-specific style rules in `CLAUDE.md` (formal "vous" in French, formal "Sie" in German, informal "tu" in Italian, etc.). Reuse upstream sfdx-hardis terminology where it exists. **No card-specific keys are needed** — the Org Monitoring LWC reads its card title and description directly from the CLI catalog.

4. **(Recommended) Add icon mappings.** Both the Org Monitoring home LWC and the Monitoring Config Workbench have a `COMMAND_ICONS` map at the top of their JS file. Add an entry keyed by the CLI catalog `entries[].key` (UPPER_SNAKE_CASE) to both:
   - `src/webviews/lwc-ui/modules/s/orgMonitoring/orgMonitoring.js` (top of file)
   - `src/webviews/lwc-ui/modules/s/monitoringConfig/monitoringConfig.js` (top of file)
   ```javascript
   <CATALOG_KEY>: { icon: "utility:<sldsIconName>", colorClass: "<existing-class>" },
   ```
   Pick an SLDS utility icon (<https://www.lightningdesignsystem.com/icons/>) and reuse one of the existing `colorClass` values for category coherence. If you omit this, both surfaces fall back to `DEFAULT_ICON` (gear) — functional but visually generic. The two maps should stay in sync; if you're adding many commands at once, factor them into a shared module rather than copying entries.

5. **(Optional) Add a tree-view icon mapping.** Edit `src/utils/themeUtils.ts` in `getAllCommandIcons()` and add an entry keyed by the command id:
   ```typescript
   "hardis:org:monitor:<name>": { vscode: "<vscode-codicon>", hardis: "<file>.svg" },
   ```
   Skip if no matching SVG exists in the icon set — the tree falls back to a default.

6. **Update CHANGELOG.md** under `## Unreleased`, applying the merge rule:
   - If an `Unreleased` bullet already covers monitoring additions, **extend or refine that bullet** rather than adding a new one.
   - If this is a one-off new command unrelated to existing entries, add a single concise bullet (e.g. `- Add monitoring command **Health Check** to audit security policies of your org`).
   - Do **not** list internal wiring (tree registration, icon mapping) — write for end users: what they can now monitor.

7. **Verify** by running `yarn lint` and `yarn dev` (or `yarn build`). Then launch the Extension Development Host (F5) and:
   - Open the **Commands** view → **Org Monitoring** section → confirm the new tree entry shows with the correct label, tooltip, and icon.
   - Open the **Org Monitoring** home page (from the sidebar) → confirm the new card appears in the correct category section, with title/description coming from the catalog, the configured icon, and a working **Run** button that launches the command in the terminal. If the card doesn't appear, click **Refresh** on the home page header — this clears the 7-day catalog cache and refetches from the CLI.
   - Open the **Monitoring Config Workbench** → confirm the new command appears as a row with the configured icon, and that frequency / threshold dropdowns work. Same cache behavior as above: use **Refresh** on the Org Monitoring home page to bust the cache if needed.
   - If the command still doesn't appear, the issue is on the CLI side — run `sf hardis:config:monitoring-defaults --json` in a terminal to inspect what the CLI is publishing.

## Styling rule (LWC) — global stylesheet + SLDS, theme-aware

The Monitoring Config Workbench and Org Monitoring home pages render in **both dark and light VS Code themes**. Any custom CSS that hardcodes a color, font, or font-weight will break one of the two.

Lookup order before writing any CSS:

1. **`resources/global-theme.css`** — already loaded by every webview (see `src/webviews/lwc-ui-panel.ts:894`). It ships `.header-section`, `.header-content`, `.header-text`, `.header-title`, `.header-subtitle`, `.header-icon-container.{green,teal,gray,blue,purple,orange,yellow}`, and `.command-icon-container.{backup,audit,tests,limits,updates,security,legacy,users,licenses,apex,connected-apps,metadata-access,unused-metadata,...}` — all pre-themed via `.slds-scope[data-theme="light"|"dark"]`. Reuse, don't redefine.
2. **SLDS classes** — `slds-badge`, `slds-badge_lightest`, `slds-badge_inverse`, `slds-text-color_*`, `slds-text-heading_*`, `slds-box`, etc. Reference: <https://www.lightningdesignsystem.com/>.
3. **Theme-aware tokens** if neither covers it — SLDS palette vars (`var(--slds-g-color-palette-purple-40)`) from `resources/global-theme-variables.css`, or VS Code tokens (`var(--vscode-foreground)`, `var(--vscode-editor-background)`, `var(--vscode-descriptionForeground)`, `inherit`, `currentColor`).

Hard rules:
- Do NOT hardcode `#hex`, `rgb()`, `color: white`, `background: linear-gradient(<literal-color>, ...)`, `font-family`, `font-weight: <number>`. They do not theme.
- Do NOT redefine a class name that already exists in `global-theme.css` — your local rule wins on specificity tie-breaking and silently shadows the themed version.
- Layout-only properties (display, flex, gap, padding, margin, border-radius, overflow) are fine in custom CSS.
- Notification-type rows in the Workbench render a static "📡 Event" badge — use `<span class="slds-badge slds-badge_lightest">`, never a custom-coloured pill.

## What NOT to do

- **Do not** hardcode the new command into `orgMonitoring.js` / `orgMonitoring.html` or `monitoringConfig.js` beyond `COMMAND_ICONS`. The list of commands, their titles, descriptions, categories, default frequency, default thresholds, channels, and severity ordering all come from the CLI catalog. Adding a per-command `runXxx()` method or `<lightning-button>` will be ignored at best, or shadow the catalog entry at worst.
- **Do not** add the command to `CONFIGURABLE_FIELDS` / `SECTIONS` in `src/utils/pipeline/sfdxHardisConfigHelper.ts` — that file is for Pipeline Settings, not monitoring.
- **Do not** write into `.sfdx-hardis.yml` from this repo. The Workbench owns the `monitoringCommands:` array under the user's workspace config — it persists automatically when the user edits values.
- **Do not** invent a new `NotificationThreshold`, channel, or frequency in `monitoringConfigUtils.ts`. Those types mirror the CLI contract; changing them here without a matching CLI change will desync the Workbench.
- **Do not** shorten the catalog cache TTL to "force fresh data" — it is intentionally 7 days, and the **Refresh** button on the Org Monitoring home is the supported way to bust it (`clearMonitoringCatalogCache()` then re-fetch).
- **Do not** add console logs of org URLs, usernames, or tokens to any monitoring code path.

## When the user asks something adjacent

- **"Change the default frequency / threshold for a monitoring command"** → that lives in the CLI catalog, not this repo. Redirect them to the sfdx-hardis CLI plugin.
- **"Add a new notification channel"** (beyond messaging / email / api) → cross-cutting change touching the CLI, `monitoringConfigUtils.ts` types, and both LWCs. Treat as a feature design task, not a routine command addition — invoke the `design` skill first.
- **"Change severity ordering"** → edit `NOTIFICATION_THRESHOLD_ORDER` in `src/utils/monitoringConfigUtils.ts` (and mirror in the CLI if needed). This affects how the Workbench sorts threshold dropdowns.
- **"The new CLI command doesn't appear in the Workbench / Org Monitoring home"** → first, click **Refresh** on the Org Monitoring home page header — that calls `clearMonitoringCatalogCache()` and re-fetches from the CLI. If it still doesn't appear, ask the user to run `sf hardis:config:monitoring-defaults --json` and inspect the output. If the command is missing from `entries[]`, the CLI plugin needs updating.
- **"Change the catalog cache duration"** → edit `cacheExpiration` (both occurrences) in `fetchMonitoringCatalog()` in `src/utils/monitoringConfigUtils.ts`. Current value: 7 days.

## Quick reference — files to touch

| File                                                                                   | Required?             | Why                                                                                     |
|----------------------------------------------------------------------------------------|-----------------------|-----------------------------------------------------------------------------------------|
| `src/hardis-commands-provider.ts` (org-monitoring topic)                               | **Required**          | Tree menu entry                                                                         |
| `src/i18n/*.json` (all 9 locales)                                                      | **Required**          | Tree entry label + tooltip translations                                                 |
| `src/webviews/lwc-ui/modules/s/orgMonitoring/orgMonitoring.js` (`COMMAND_ICONS`)       | Recommended           | Per-command icon on the Org Monitoring home cards                                       |
| `src/webviews/lwc-ui/modules/s/monitoringConfig/monitoringConfig.js` (`COMMAND_ICONS`) | Recommended           | Per-command icon in the Config Workbench rows                                           |
| `src/utils/themeUtils.ts` (`getAllCommandIcons`)                                       | Optional              | Tree view icon                                                                          |
| `CHANGELOG.md` (`## Unreleased`, merged)                                               | Recommended           | User-visible release note                                                               |
| sfdx-hardis CLI plugin (external)                                                      | **Required for LWCs** | Catalog source of truth — provides `key`, `title`, `description`, `command`, `category` |
| `orgMonitoring.js` / `orgMonitoring.html` (card markup)                                | **DO NOT EDIT**       | Cards are generated from the CLI catalog — no per-command HTML or JS handler            |
