---
name: fix-security
description: Fix security vulnerabilities reported by Trivy and OSV-Scanner in the vscode-sfdx-hardis extension. Use when the user asks to fix, triage, or address Trivy / OSV-Scanner / MegaLinter REPOSITORY_TRIVY / REPOSITORY_OSV_SCANNER findings. Tries upgrading the affected dependency first, then a yarn resolution override, and only ignores the finding if the vulnerability is genuinely non-exploitable in this extension's context.
compatibility: Designed for Claude Code (or similar products)
---

# Fix Security (Trivy + OSV-Scanner)

Resolve CVEs and advisories raised by **Trivy** and **OSV-Scanner** (both run via MegaLinter — linter keys `REPOSITORY_TRIVY` and `REPOSITORY_OSV_SCANNER`). For each finding, apply this priority ladder:

1. **Upgrade** the direct dependency to a patched version (best).
2. **Pin** a sub-dependency via a yarn `resolutions` override (good, when the direct dep has no fixed release yet).
3. **Ignore** the finding via `.trivyignore` / `osv-scanner.toml` (last resort — only when the vulnerable code path is not reachable from this extension AND not exploitable in a VS Code extension context).

Never silence a finding without verifying step 1 and step 2 are not viable.

## Background — how the scanners run in this repo

- **Trivy** scans dependency manifests and the filesystem. Configured via `.mega-linter.yml` (`REPOSITORY_TRIVY` linter). Findings come with a CVE id, the package, the introduced/fixed versions, and a severity.
- **OSV-Scanner** scans `yarn.lock` against the OSV database. Configured via `.mega-linter.yml` (`REPOSITORY_OSV_SCANNER` linter). Findings come with an OSV id (e.g. `GHSA-xxxx-yyyy-zzzz` or `CVE-xxxx-yyyy`), the package, the affected version range, and a fix range.
- **Package manager**: this repo uses **yarn** (not npm). `package.json` already has a `resolutions:` block — see existing entries (`@vscode/vsce/glob/minimatch/brace-expansion`, `uuid`, …) for the override syntax used here.
- **Ignore files**: at the time of writing, `.trivyignore` and `osv-scanner.toml` do not exist at the repo root. If a finding genuinely needs to be ignored, create them — see Step 4 below for canonical templates.

## Decision: upgrade → resolution → ignore

Walk through every finding in this order. Do not skip a rung.

### 1. Upgrade the direct dependency

Applies when the vulnerable package is in `dependencies` or `devDependencies` directly:

- Check the package's release history (`yarn info <pkg> versions` or its npm/GitHub page) for a version that is `>=` the fix version.
- Bump the version in `package.json`, run `yarn install`, and verify the lockfile resolves to the patched version.
- Run `yarn lint && yarn dev` (and `yarn test` if reasonable) to confirm no regression. Pay attention to **breaking changes** in major bumps — check the package CHANGELOG / release notes.

If upgrading would force a major bump that breaks the build or pulls in new peer-dep churn, weigh whether a resolution (step 2) is safer.

### 2. Add a yarn resolution

Applies when the vulnerable package is a **transitive** dependency (sub-dependency of something you depend on), and the direct dep has no patched release yet.

- Add an entry under `"resolutions"` in `package.json` using the **path-scoped** form, matching the existing style in this repo:
  ```jsonc
  "resolutions": {
    "<topLevelDep>/<subDep>/<deeperSubDep>": "<patchedVersion>",
    // or, when a global override is genuinely safe:
    "<vulnerablePkg>": "<patchedVersion>"
  }
  ```
- Prefer the **path-scoped** form over a global override. Global overrides can silently force-upgrade unrelated callers and trigger ABI / API mismatches.
- After editing, run `yarn install` and grep `yarn.lock` to confirm the resolved version is the patched one. A resolution that doesn't actually take effect (wrong path, version conflict) is worse than no resolution — the scanner stays green but the vulnerable code is still installed. Verify.
- Re-run the relevant scanner (or wait for CI) to confirm the finding clears.

### 3. Ignore the finding (last resort)

Only after steps 1 and 2 are confirmed not viable. Before ignoring, you must be able to answer YES to all of:

- **Not reachable**: the vulnerable code path is not called from this extension's runtime — neither extension host code (`src/extension.ts` and its imports) nor webview code (`src/webviews/lwc-ui/**`) nor the worker (`src/worker.ts`).
- **Not exploitable in context**: even if reachable, the attack vector (e.g. "untrusted HTTP input", "untrusted file path", "regex DoS on user-controlled string") cannot be supplied in a VS Code extension running on a developer's machine against their own Salesforce orgs. Network-borne RCE in a server library used only in `devDependencies` (e.g. a build tool) is usually a safe ignore. ReDoS in a runtime-imported library that processes user-supplied strings is NOT.
- **No patched version exists**: confirm by checking the package's repository — not just the npm registry — and the OSV / Trivy advisory itself. New patches land regularly; re-check before adding the ignore.
- **`devDependencies` only**: a vuln in a build-time-only dep (webpack loader, eslint plugin, test runner) almost always qualifies. A vuln in a runtime dep almost never does.

If you cannot say YES to all four, do not ignore — escalate to the user with the specific blocker.

## Steps

1. **Collect findings — primary source is the GitHub PR MegaLinter workflow log.**

   The authoritative Trivy + OSV-Scanner output lives in the MegaLinter run for the PR associated with the current branch. Pull it with `gh`:

   ```bash
   # 1. Find the PR for the current branch
   gh pr view --json number,url,headRefName,state

   # 2. Get the most recent MegaLinter run on this branch
   gh run list --branch "$(git rev-parse --abbrev-ref HEAD)" --workflow mega-linter.yml \
     --limit 5 --json databaseId,status,conclusion,createdAt,event,headSha

   # 3. List jobs in the chosen run (usually a single "Mega-Linter" job)
   gh run view <runId> --json jobs --jq '.jobs[] | {name, databaseId, conclusion}'

   # 4. Download the job log
   gh run view --job <jobId> --log > megalinter.log
   ```

   The log is ~1k+ lines. Find each scanner's section:
   - **OSV-Scanner**: grep `OSV_SCANNER` / `osv-scanner`. Block starts at `Linted [REPOSITORY] files with [osv-scanner]` and prints a table with columns `OSV URL | CVSS | ECOSYSTEM | PACKAGE | VERSION | FIXED VERSION | SOURCE`.
   - **Trivy**: grep `TRIVY` / `trivy`. Block starts at `Linted [REPOSITORY] files with [trivy]` (vulns + misconfigs) and `Linted [REPOSITORY] files with [trivy-sbom]` (SBOM only, informational).

   For each finding, capture: CVE/OSV id, package, installed version, fix version (if any), severity / CVSS, ecosystem, and source file (`yarn.lock`, `package.json`, …). Then use `yarn why <pkg>` locally to trace the dependency path before deciding the triage rung.

   **Clean up after**: delete the temporary `megalinter.log` (do not commit it).

   **Fallbacks** if the PR / workflow log is unavailable:
   - Read a local MegaLinter report under `megalinter-reports/` (only present if MegaLinter was run locally).
   - Run scanners locally:
     - `osv-scanner scan source --recursive .` (this is the command MegaLinter runs)
     - `trivy fs --scanners vuln,misconfig --exit-code 1 .` (this is the command MegaLinter runs)

2. **For each finding, classify** as `upgrade`, `resolution`, or `ignore` using the decision ladder above. Write the choice down before editing.

3. **Apply upgrades** for everything classified as `upgrade`:
   - Edit `package.json`, bump the version range.
   - `yarn install`.
   - Verify in `yarn.lock` that the resolved version is `>=` fix version.
   - `yarn lint && yarn dev` to confirm no regression.

4. **Apply resolutions** for everything classified as `resolution`:
   - Edit the `"resolutions"` block in `package.json`. Match the existing path-scoped style.
   - `yarn install`.
   - `yarn why <vulnerable-pkg>` — confirm every installed copy resolves to the patched version. If two paths still resolve to vulnerable versions, add another scoped entry.
   - `yarn lint && yarn dev`.

5. **Apply ignores** for everything classified as `ignore` (only after steps 3 + 4 cleared what they could):

   **Trivy** — create or update `.trivyignore` at the repo root. Format: one CVE id per line. Add an expiration date and a justification comment on the line ABOVE the id. Trivy understands `# exp:YYYY-MM-DD` as an expiry annotation:
   ```text
   # devDependency only (webpack loader); RCE requires attacker-supplied build input we never accept.
   # Re-evaluate when <pkg> ships a patched release.
   # exp:2026-08-31
   CVE-2025-XXXXX

   # ReDoS in a code path not reached by this extension (string parser only used for <X>).
   # exp:2026-08-31
   CVE-2025-YYYYY
   ```
   Then register the file with the Trivy linter in `.mega-linter.yml`:
   ```yaml
   REPOSITORY_TRIVY_ARGUMENTS: "--ignorefile .trivyignore"
   ```

   **OSV-Scanner** — create or update `osv-scanner.toml` at the repo root. Each ignore needs the OSV id, an expiry, and a human-readable reason:
   ```toml
   [[IgnoredVulns]]
   id = "GHSA-xxxx-yyyy-zzzz"
   ignoreUntil = 2026-08-31
   reason = "devDependency only (webpack loader); attack vector requires build input we never accept. Watch for a patched release of <pkg>."

   [[IgnoredVulns]]
   id = "CVE-2025-YYYYY"
   ignoreUntil = 2026-08-31
   reason = "Vulnerable code path is not reached from extension.ts, worker.ts, or any LWC bundle. Confirmed via yarn why + grep <symbol>."
   ```
   Then point OSV-Scanner at the config in `.mega-linter.yml`:
   ```yaml
   REPOSITORY_OSV_SCANNER_ARGUMENTS: "--config=osv-scanner.toml"
   ```

   Always pick an `ignoreUntil` / `exp:` no more than ~3 months out. Permanent ignores rot; a forced re-evaluation is the point.

6. **Update `CHANGELOG.md`** if any user-facing dependency was upgraded with visible behavior change (rare — most security bumps are silent). Pure security maintenance does NOT need a changelog entry. See the `implement` skill for changelog merge rules.

## Anti-patterns — what NOT to do

- **Do not** disable `REPOSITORY_TRIVY` or `REPOSITORY_OSV_SCANNER` in `.mega-linter.yml`. Use `DISABLE_ERRORS_LINTERS` only if explicitly asked, and add a tracked issue link.
- **Do not** add a blanket `severity = "LOW"` / `severity = "MEDIUM"` filter to dodge findings. Triage every finding individually.
- **Do not** add ignores without an expiry. An ignore is a snooze, not a delete.
- **Do not** write a generic justification ("not exploitable", "false positive", "won't fix"). The reason field exists so the next maintainer (or future you) can verify the call in 30 seconds without reopening the advisory.
- **Do not** add a global yarn resolution (`"<pkg>": "..."`) when a scoped path (`"<a>/<b>/<pkg>": "..."`) would do — global overrides surprise everyone downstream.
- **Do not** edit `yarn.lock` by hand to bump a version. Let `yarn install` regenerate it from `package.json` + `resolutions`.
- **Do not** add a resolution and skip the `yarn why` check. Resolutions silently fail to apply often enough that "I added it and CI is green" is not proof — the lockfile is.

## Verification

After fixing:
1. Re-run the scanner(s): `osv-scanner --lockfile=yarn.lock` and/or `trivy fs --scanners vuln .` — every targeted finding should be gone OR explicitly listed in the ignore file.
2. `yarn install` — lockfile resolves cleanly, no peer-dep warnings introduced.
3. `yarn lint && yarn dev` — both succeed.
4. `yarn test` if a runtime dep was bumped to a different major.
5. If a runtime dep was bumped, smoke-test the affected feature in the Extension Development Host (F5).

## When the user asks something adjacent

- **"Just ignore everything below HIGH"** → push back; explain that severity is the scanner's heuristic, not a substitute for triage. Offer to triage each finding individually instead.
- **"Bump everything to latest"** → not this skill. Mass-bumping is a routine maintenance task with different trade-offs (breaking changes, peer-dep churn). Suggest a separate session.
- **"The MegaLinter check is blocking my PR — make it pass"** → same ladder, same rules. Do not lower the bar to land a PR; either fix or document the ignore properly so reviewers can audit it.
- **"What about npm audit?"** → not used here. This repo runs Trivy + OSV-Scanner via MegaLinter. `npm audit` against a yarn lockfile gives misleading results.
