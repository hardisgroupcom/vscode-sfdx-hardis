---
name: test
description: Run tests, write test cases, and verify builds for the vscode-sfdx-hardis VS Code extension. Use when the user asks to test, validate, check, or verify code changes.
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: cloudity
  version: "1.0"
---

# Test

Run and write tests for the vscode-sfdx-hardis extension.

## Delegation

A matching **`test`** sub-agent is defined in `.claude/agents/test.md`. Prefer delegating this task to the `test` sub-agent via your tool's sub-agent mechanism so it runs with the dedicated tooling and configuration defined there. Handle it inline only when delegation would lose important context.

## Steps

### Running tests
```bash
yarn pretest          # Compile TypeScript + lint (required before running tests)
yarn test             # Run the VS Code extension test suite
yarn lint             # Run ESLint only
yarn compile          # Compile TypeScript only (tsc)

yarn dev && yarn compile && yarn test:ui   # UI integration tests (build order matters)
```

Tests require a VS Code instance (uses `@vscode/test-electron`). On Linux CI, tests run under Xvfb for display support.

**`yarn test:ui` build order is not optional**: `yarn dev` produces the webview bundle and assets, `yarn compile` produces `out/extension.js` and `out/test`. Running `test:ui` after only one of them tests a stale build.

### Quick build verification
Even without running the full test suite, verify changes compile and lint cleanly:
```bash
yarn lint && yarn dev
```

## Test structure

- **Unit / extension tests**
  - **Runner**: `src/test/runTest.ts` - Downloads and launches VS Code test instance
  - **Suite config**: `src/test/suite/index.ts` (+ `src/test/mochaRunner.ts`) - Mocha configuration
  - **Test files**: `src/test/suite/*.test.ts` - covers the pure helpers (`ansiColors`, `executableUtils`, `gitUrlUtils`, `httpUtils`, `pluginsVersionUtils`, `portUtils`, `prePostCommandsUtils`, `projectUtils`, `sortUtils`)
- **UI integration tests** (real VS Code + mocked CLI)
  - **Runner**: `src/test/runUiTest.ts` - copies the `test/fixtures/dummy-sfdx-project` fixture to a temp workspace, puts a mock `sf` CLI on the PATH, launches the Extension Development Host
  - **Tests**: `src/test/ui/*.test.ts` (e.g. `perf.test.ts`), entry point `src/test/ui/index.ts`
  - **Mock CLI**: `test/fixtures/sf-shim/` — answers instantly and speaks the sfdx-hardis WebSocket protocol. The shim must keep **LF line endings and its exec bit** (enforced by `.gitattributes`); a CRLF shebang breaks it on Linux and Git Bash.
  - Writing settings from a UI test requires the **Workspace** configuration target, not Global.

## Writing tests

- Use Mocha (`describe`, `it`, `before`, `after`, `beforeEach`, `afterEach`)
- Tests run inside a VS Code Extension Development Host, so the full `vscode` API is available
- Place new test files in `src/test/suite/` with `.test.ts` extension
- Follow the existing test patterns in `src/test/suite/extension.test.ts`
- Prefer extracting logic into a pure helper under `src/utils/` and unit-testing it there, rather than testing through the VS Code API
- For new LWC features and anything touching command launching, panels or tree views, add a UI test under `src/test/ui/` that drives the real Extension Development Host against the mocked `sf` CLI

## Manual testing checklist

- Test webviews in both light and dark VS Code themes
- Test with different org color settings if applicable
- Verify with various Salesforce org types (scratch org, sandbox, production) when relevant
- Check behavior when no SFDX project is present in the workspace

## CI pipeline

GitHub Actions (`test.yml`) runs on every push and PR:

- **Test Extension** job: `yarn install --frozen-lockfile` -> `yarn lint` -> `yarn compile` -> `yarn test` (with Xvfb on Ubuntu). Matrix: Node 22 and 24, plus dedicated Windows and macOS jobs.
- **UI Tests** job: `yarn install --frozen-lockfile` -> `yarn dev` -> `yarn compile` -> `yarn test:ui` (`xvfb-run -a` on Linux), across Linux / Windows / macOS.
