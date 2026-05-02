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

## Steps

### Running tests
```bash
yarn pretest          # Compile TypeScript + lint (required before running tests)
yarn test             # Run the VS Code extension test suite
yarn lint             # Run ESLint only
yarn compile          # Compile TypeScript only (tsc)
```

Tests require a VS Code instance (uses `@vscode/test-electron`). On Linux CI, tests run under Xvfb for display support.

### Quick build verification
Even without running the full test suite, verify changes compile and lint cleanly:
```bash
yarn lint && yarn dev
```

## Test structure

- **Test runner**: `src/test/runTest.ts` - Downloads and launches VS Code test instance
- **Test suite**: `src/test/suite/index.ts` - Mocha test runner configuration
- **Test files**: `src/test/suite/*.test.ts` - Test cases using Mocha

## Writing tests

- Use Mocha (`describe`, `it`, `before`, `after`, `beforeEach`, `afterEach`)
- Tests run inside a VS Code Extension Development Host, so the full `vscode` API is available
- Place new test files in `src/test/suite/` with `.test.ts` extension
- Follow the existing test patterns in `src/test/suite/extension.test.ts`
- For new LWC features, add integration tests that simulate user interaction with the webview and verify correct extension-host communication

## Manual testing checklist

- Test webviews in both light and dark VS Code themes
- Test with different org color settings if applicable
- Verify with various Salesforce org types (scratch org, sandbox, production) when relevant
- Check behavior when no SFDX project is present in the workspace

## CI pipeline

GitHub Actions (`test.yml`) runs on every push and PR:
1. `yarn install --frozen-lockfile`
2. `yarn lint`
3. `yarn compile`
4. `yarn test` (with Xvfb on Ubuntu)

Matrix: Node 22 and 24, Ubuntu + Windows.
