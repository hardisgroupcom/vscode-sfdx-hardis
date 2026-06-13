---
name: implement
description: Implement features, bug fixes, or refactors in the vscode-sfdx-hardis VS Code extension. Use when the user asks to write code, fix a bug, add a feature, or make changes to the codebase. Writes code, adds i18n, updates CHANGELOG, and verifies the build. Also executes the related task skills monitoring, fix-duplicate, and fix-security when dispatched to follow one of them.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
color: green
---

You implement features, fixes, and refactors in the **vscode-sfdx-hardis** VS Code extension.

## Authoritative procedure

The full procedure (code style, i18n, changelog rules, LWC styling, recipes) lives in `.claude/skills/implement/SKILL.md`. **Read it first**, then follow it. The essentials:

> **You also execute related task skills.** When the caller dispatches you to add a monitoring command, fix jscpd duplicates, or fix Trivy/OSV-Scanner findings, read the corresponding `.claude/skills/{monitoring,fix-duplicate,fix-security}/SKILL.md` and follow *that* procedure instead of the generic one below — the implement code-style, i18n, changelog, and verification rules still apply on top.


1. **Read existing code** before modifying — match the surrounding patterns.
2. **Write code** following the rules: braces `{}` after every `if`/`else`/`for`/`while` with newline after `{` and before `}`; `camelCase` vars, `UPPER_CASE` constants, `PascalCase` types; `yarn` not `npm`; `sf` CLI not legacy `sfdx`; `Logger.log()` not `console.log`.
3. **Add i18n** for any user-facing string — key in `src/i18n/en.json` first, then all 8 other locales (`fr`, `es`, `de`, `it`, `nl`, `ja`, `pl`, `pt-BR`); flat JSON, camelCase, alphabetical; preserve `{{varName}}` and `<br/>`.
4. **Update CHANGELOG.md** under `## Unreleased` — read existing bullets first and **merge, don't append blindly**; concise, non-technical, user-facing; use indented sub-bullets for multi-aspect features (never one run-on sentence); skip entirely for pure internal/refactor/dep-bump changes.
5. **Verify** — `yarn lint` then `yarn dev` (or `yarn build`); both must succeed.

## Key patterns

- TypeScript: `t()` from `./i18n/i18n`, `CacheManager` for expensive ops, `register*` pattern in `src/commands/`, `execSfdxJson()` / `execCommandWithProgress()`, `simpleGit()`.
- LWC: components in `src/webviews/lwc-ui/modules/s/<name>/` (`.js`/`.html`/`.css`), extend `SharedMixin`, `{i18n.key}` in templates, `this.t()` in JS getters, no ternaries in HTML, `window.sendMessageToVSCode()`.
- **LWC styling is theme-aware (dark + light)**: reuse `resources/global-theme.css` classes and SLDS first; never hardcode `#hex`, `rgb()`, `color: white`, `font-family`, or `font-weight: <number>`; use SLDS palette vars or `var(--vscode-*)` tokens. Layout-only CSS is fine. Never redefine a class that already exists globally.
- Security: WebSocket commands start with `sf hardis`, no `&&`; sanitize all LWC↔extension messages; never log usernames, org URLs with tokens, or passwords.

Report what you changed, the i18n/changelog status, and the verification result as your final message.
