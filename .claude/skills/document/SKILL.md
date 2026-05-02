---
name: document
description: Write or update documentation, tooltips, translations, and help text for the vscode-sfdx-hardis VS Code extension. Use when the user asks to document, describe, explain for users, or update README/translations.
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: cloudity
  version: "1.0"
---

# Document

Write or update documentation for the vscode-sfdx-hardis extension.

## Steps

1. Identify what needs documenting and where it belongs (see table below).
2. Follow the rules for that documentation type.
3. If i18n strings are involved, update all 9 locale files.

## What to document and where

| Type | Location |
|------|----------|
| Extension features, user-facing docs | `README.md` |
| Claude Code instructions | `CLAUDE.md` |
| Claude Code skills | `.claude/skills/*/SKILL.md` |
| i18n strings (user-visible text) | `src/i18n/*.json` (all 9 locales) |
| Command tooltips | `hardis-commands-provider.ts` via `t("tooltipKey")` |
| Command help links | `helpUrl` property pointing to `https://sfdx-hardis.cloudity.com/` |

## Rules

### User-facing strings are i18n, not docs
Every label, tooltip, error message, and description shown to users must go through the i18n system (`t()` in TypeScript, `{i18n.keyName}` in LWC templates). Never hardcode user-visible English strings.

### Command tooltips
Every command in `hardis-commands-provider.ts` must have a descriptive tooltip explaining what it does and any prerequisites. Use `t("descriptiveTooltipKey")`.

### README.md
Update when adding new user-facing features (command categories, panels, configuration options). Follow the existing section structure.

### Code comments
Only add where the logic is non-obvious. Do not add JSDoc to every function or comments restating what the code does.

### helpUrl
Commands should link to the relevant page on `https://sfdx-hardis.cloudity.com/` when applicable.

## i18n documentation workflow

1. Write English text in `src/i18n/en.json` first (source of truth)
2. Add the same key with translated text to all other locale files (`fr.json`, `es.json`, `de.json`, `it.json`, `nl.json`, `ja.json`, `pl.json`, `pt-BR.json`)
3. Keep keys in alphabetical order, flat JSON, camelCase
4. Look at other translations in the same language file to use the same terminology and style for consistency
5. Preserve `{{varName}}` interpolation placeholders and `<br/>` tags exactly as-is in all languages

### Language-specific style guidelines
- **French**: Formal ("vous"), official Salesforce French terminology (e.g., "Metadonnees", "Deploiement", "Org Salesforce")
- **Spanish**: Formal ("usted"), Latin American neutral, official Salesforce Spanish terminology
- **German**: Formal ("Sie"), standard German software/IT terminology (e.g. "Datensatz" for record, "Org" stays as "Org")
- **Dutch**: Informal ("je/jij"), standard Dutch IT terminology (e.g. "implementatie" for deployment, "configuratie" for configuration)
- **Italian**: Informal ("tu"), standard Italian IT terminology (e.g. "distribuzione" for deployment, "configurazione" for configuration)
- **Japanese**: Natural UI wording, reuse upstream sfdx-hardis terminology, prefer concise action-oriented wording
- **Polish/Portuguese (BR)**: Follow established patterns in existing translations

### What to translate
- Labels, tooltips, error messages, warning messages, section titles, user-visible descriptions
- User-targeted properties: `message`, `description`
- 3rd argument of calls to `execCommandWithProgress()`
- Arguments of `showErrorMessage`, `showInformationMessage`, `showWarning`, `updateTitle`
- Any variable that looks like it will be shown to the user, even if not a full sentence (button labels, status messages)

### What NOT to translate
- Technical identifiers: command IDs, icon IDs, file paths, CSS classes
- Technical terms kept as-is: merge request, commit, branch, sandbox, scratch org, package.xml, Apex, SOQL, LWC, DevHub, CLI flags, environment variable names
- `[markers]` in brackets
- Brand names: Salesforce, GitHub, GitLab, SFDMU, MegaLinter, SFDX-Hardis, Cloudity, etc.
