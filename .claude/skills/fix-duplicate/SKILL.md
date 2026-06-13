---
name: fix-duplicate
description: Fix duplicate code issues reported by jscpd in the vscode-sfdx-hardis extension. Use when the user asks to fix, resolve, or address jscpd duplications, copy-paste detector findings, or MegaLinter COPYPASTE_JSCPD errors. Either factorizes the duplicates into shared helpers, or, when factorization would hurt clarity, adds jscpd ignore markers to silence them.
compatibility: Designed for Claude Code (or similar products)
---

# Fix Duplicate

Resolve duplicate-code findings raised by **jscpd** (run via MegaLinter as `COPYPASTE_JSCPD`). For each duplicate, the correct answer is one of two things — **factorize** (extract a shared helper) or **ignore** (mark the block with `jscpd:ignore` markers). This skill picks between them deliberately, not by reflex.

## Delegation

Resolving duplicates is an implementation task. Prefer delegating it to the **`implement`** sub-agent (`.claude/agents/implement.md`) via your tool's sub-agent mechanism, and have it follow the procedure in this skill. Handle it inline only when delegation would lose important context.

## Background — how jscpd runs in this repo

- **Config**: `.jscpd.json` at repo root, `threshold: 0` (any duplicate fails).
- **Runner**: MegaLinter (`.mega-linter.yml`), linter key `COPYPASTE_JSCPD`. Findings appear in the MegaLinter report and PR comments.
- **Existing ignored paths**: provider tree files (`*-provider.ts`), `webpack*.js`, `eslint.config.js`, `pipelineConfig.js`, `sfdxHardisConfig.ts`, `packageXml.ts`, `src/utils/gitProviders/**`, `scripts/**`, and most non-code asset types — see `.jscpd.json`. If a duplicate sits in a path already excluded, the report is wrong or the config drifted; investigate before editing code.
- **Existing inline ignores** in this repo show both syntaxes: `/* jscpd:ignore-start */` … `/* jscpd:ignore-end */` (TS block comment) and `// jscpd:ignore-start` … `// jscpd:ignore-end` (line comment). Either works — match the surrounding file style.

## Decision: factorize OR ignore

Walk through the duplicate before touching code. There is no third option — pick one consciously.

### Factorize when

- The duplicated block expresses **the same intent** (same domain operation, same control flow, same data shape). Two functions that "just happen" to look similar but solve different problems are NOT this case.
- The block is **non-trivial** (more than ~5 meaningful lines, or contains real logic — not just imports / boilerplate / parameter destructuring).
- A natural home for the helper exists: a sibling util module, an existing class on the same path, or a small new file in `src/utils/`.
- Factoring out does **not** force the call sites to pass a long bag of options purely to express their tiny differences. If the helper would need 6+ parameters or a discriminator flag (`isFoo: boolean`) to behave correctly for each caller, the abstraction is wrong.

### Ignore (add `jscpd:ignore`) when

- The blocks are **coincidentally similar** but conceptually independent — e.g. two LWC components that each set up their own state, two `register*` command files that follow the same shape, two providers wiring different APIs.
- The duplicate is **boilerplate dictated by an external contract** — VS Code command registration scaffolding, webview panel bootstrap, message-handler switch arms with identical `case` shells but different payload handling.
- The duplicate sits in **HTML/CSS/JSON-like content** where extracting "shared" markup creates worse coupling than the duplication.
- Factoring would require **threading state across module boundaries** (passing the panel instance, the WebSocket server, the context) just to share 8 lines.
- The shape will **diverge soon** based on known upcoming work (don't over-fit to today's shape).

When in doubt, factorize. The ignore comment is a confession that the tool is wrong — only sign it when you mean it.

## Steps

1. **Get the jscpd report — primary source is the GitHub PR MegaLinter workflow log.**

   The authoritative findings live in the MegaLinter run for the PR associated with the current branch. Pull them with `gh` (no need to open the browser):

   ```bash
   # 1. Find the PR for the current branch
   gh pr view --json number,url,headRefName,state

   # 2. Get the most recent MegaLinter run on this branch (filter by pull_request event)
   gh run list --branch "$(git rev-parse --abbrev-ref HEAD)" --workflow mega-linter.yml \
     --limit 5 --json databaseId,status,conclusion,createdAt,event,headSha

   # 3. List jobs in the chosen run (there is usually a single "Mega-Linter" job)
   gh run view <runId> --json jobs --jq '.jobs[] | {name, databaseId, conclusion}'

   # 4. Download the job log
   gh run view --job <jobId> --log > megalinter.log
   ```

   The log is long (~1k+ lines). Locate the jscpd section by grepping for `JSCPD` / `jscpd` — the relevant block starts at `❌ Linted [COPYPASTE] files with [jscpd]` and lists each clone as:
   ```
   Clone found (typescript):
    - <file> [<start>:<col> - <end>:<col>] (<n> lines, <n> tokens)
      <file> [<start>:<col> - <end>:<col>]
   ```
   Each block is a pair of (file, line range) → (file, line range) with the duplicated token count. Note that the two sides can be in the **same file** (intra-file duplication).

   **Clean up after**: delete the temporary `megalinter.log` (do not commit it).

   **Fallbacks** if the PR / workflow log is unavailable:
   - Read a local MegaLinter report under `megalinter-reports/` (only present if MegaLinter was run locally).
   - Run jscpd locally: `npx jscpd .` (uses `.jscpd.json`).

2. **Read both sides of every reported pair** before deciding. Do not skim — the right call hinges on whether the two blocks express the same intent. Open both files at the cited line ranges.

3. **Classify each pair** as `factorize` or `ignore` using the rules above. Note the choice; you'll act on it in step 4.

4. **Apply the fix**:

   **If factorize**:
   - Find the best home for the helper. Prefer existing modules:
     - General utilities → `src/utils/<topic>.ts`
     - LWC-side helpers → `src/webviews/lwc-ui/modules/s/<existing-or-new>/`
     - Command-related shared logic → a sibling file under `src/commands/` or `src/utils/`
   - Extract the helper with a **descriptive, intent-revealing name** (not `doStuff`, `handleCommon`, `sharedFn`).
   - Update both (or all N) call sites to use the helper.
   - Preserve any `i18n` keys and `t()` calls — translations must continue to resolve.
   - If the duplicate is in an LWC component, the helper must either live in `sharedMixin` (if cross-cutting) or in a plain JS module imported by both components.
   - Run `yarn lint` and `yarn dev` to confirm nothing broke.

   **If ignore**:
   - Wrap the duplicated block with `jscpd:ignore-start` / `jscpd:ignore-end` markers in BOTH files of the pair. Marking only one side does not silence the report.
   - Use the comment style matching the surrounding code:
     - TypeScript / JavaScript with block comments nearby: `/* jscpd:ignore-start */` … `/* jscpd:ignore-end */`
     - TypeScript / JavaScript with line comments nearby: `// jscpd:ignore-start` … `// jscpd:ignore-end`
   - Place the markers as **tightly** as possible around the duplicated block. Do not wrap an entire file unless the entire file is the duplicate. Examples already in this repo:
     - Tight block inside a method: `src/command-runner.ts:372-396`
     - Around a `case` in a switch: `src/commands/showOrgsManager.ts:91-103`
     - Around a top-of-file imports/setup block: `src/commands/showDataWorkbench.ts:1-11`
   - **Do not** add a justification comment unless the choice is genuinely non-obvious. The marker itself is the signal; prose narrating "this is fine because…" is noise.

5. **Re-run jscpd or rebuild the report** to confirm the duplicate is gone (factored) or silenced (ignored). If new duplicates surfaced (e.g. the new helper triggered a different match), repeat from step 1.

6. **Update `CHANGELOG.md`** ONLY if the factoring has a visible user impact (rare for this skill — pure de-duplication usually does not). Internal-only de-duplication and `jscpd:ignore` additions are NOT changelog-worthy. See the `implement` skill for changelog merge rules.

## Anti-patterns — what NOT to do

- **Do not** lift `threshold: 0` in `.jscpd.json`, add path globs to silence findings wholesale, or disable the linter in `.mega-linter.yml`. The config is intentionally strict.
- **Do not** factorize two blocks into a helper that takes a `mode` / `kind` / `type` parameter and forks behavior inside — that is two functions sharing a body, not one function with two callers.
- **Do not** factorize into `sharedMixin` just to share two lines of LWC code. The mixin is for cross-cutting concerns (i18n, theming), not for hiding duplicates.
- **Do not** add `jscpd:ignore` over blocks that are clearly factorable just because factoring is more work. The cost of the ignore comment is paid every time someone reads the duplicated code afterwards.
- **Do not** edit `*-provider.ts`, `pipelineConfig.js`, `sfdxHardisConfig.ts`, `packageXml.ts`, `src/utils/gitProviders/**`, or `scripts/**` to "fix" duplicates flagged in those paths — they are excluded in `.jscpd.json`. If a finding appears anyway, the report or the config is stale.
- **Do not** broaden a helper's signature past what the current N call sites need, in anticipation of a future caller. Add parameters when the future caller actually appears.

## Verification

After fixing:
1. Re-run jscpd locally (`npx jscpd .`) or check the MegaLinter report — the targeted duplicates should be gone.
2. `yarn lint` — no new ESLint issues.
3. `yarn dev` or `yarn build` — webpack compiles cleanly (all three bundles).
4. If LWC code was touched, smoke-test the affected panel in the Extension Development Host (F5).
