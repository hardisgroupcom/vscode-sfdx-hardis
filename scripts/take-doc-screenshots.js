#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regenerates the documentation screenshots of the extension.
 *
 * Drives the UI integration harness (a real Extension Development Host with a
 * mocked `sf` CLI) in "documentation screenshot" mode: every LWC panel is
 * opened with realistic fixture data, in light theme and English, and the
 * VS Code window is saved as a PNG.
 *
 * Prerequisites (both, in this order):
 *   yarn dev       (webpack: webview bundle + assets)
 *   yarn compile   (tsc: out/extension.js + out/test)
 *
 * Usage:
 *   yarn screenshots                      all screenshots, dependencies OK
 *   yarn screenshots welcome,setup        only those two
 *   SF_MOCK_DEPS_STATE=missing yarn screenshots setup
 *
 * Output folder: <repo>/doc-screenshots (override with
 * SFDX_HARDIS_DOC_SCREENSHOTS_DIR).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const only = process.argv.slice(2).join(",");

// Dependencies the Setup panel checks. The mocked CLI reports these exact
// versions as installed, so nothing shows up as "upgrade available".
const NPM_PACKAGES = [
  "@salesforce/cli",
  "sfdx-hardis",
  "@salesforce/plugin-packaging",
  "sfdmu",
  "sfdx-git-delta",
  "sf-git-merge-driver",
];

// The extension requires this minimal sfdx-hardis version (see
// RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION in src/constants.ts). While v8 is not
// published, npm still returns a v7, which the Setup panel would flag in red.
const MIN_SFDX_HARDIS_VERSION = "8.0.0";

function isLowerVersion(version, reference) {
  const toParts = (value) =>
    String(value)
      .split(/[.-]/)
      .map((part) => parseInt(part, 10) || 0);
  const [a, b] = [toParts(version), toParts(reference)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) {
      return diff < 0;
    }
  }
  return false;
}

async function fetchLatestVersions() {
  const versions = { node: process.versions.node };
  await Promise.all(
    NPM_PACKAGES.map(async (packageName) => {
      try {
        const response = await fetch(
          `https://registry.npmjs.org/${packageName}/latest`,
          { signal: AbortSignal.timeout(8000) },
        );
        const body = await response.json();
        if (body && body.version) {
          versions[packageName] = body.version;
        }
      } catch {
        // Offline: the mock keeps its built-in default for this package
      }
    }),
  );
  if (
    !versions["sfdx-hardis"] ||
    isLowerVersion(versions["sfdx-hardis"], MIN_SFDX_HARDIS_VERSION)
  ) {
    versions["sfdx-hardis"] = MIN_SFDX_HARDIS_VERSION;
  }
  return versions;
}

/**
 * The repository is a pre-release build (`preview: true`), which makes the
 * extension require an alpha/beta sfdx-hardis plugin and show a red card plus
 * an upgrade toast. Documentation must show the released behaviour, so the
 * flag is turned off for the duration of the run and restored afterwards.
 */
function withReleaseFlavor(run) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const original = fs.readFileSync(packageJsonPath, "utf8");
  const patched = original.replace(
    /^(\s*)"preview": true,/m,
    '$1"preview": false,',
  );
  const restore = () => {
    if (patched !== original) {
      fs.writeFileSync(packageJsonPath, original);
    }
  };
  if (patched !== original) {
    fs.writeFileSync(packageJsonPath, patched);
    process.on("exit", restore);
    process.on("SIGINT", () => {
      restore();
      process.exit(130);
    });
  }
  try {
    return run();
  } finally {
    restore();
  }
}

async function main() {
  const versions = await fetchLatestVersions();
  const versionsFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sfh-shot-")),
    "versions.json",
  );
  fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2));

  const env = {
    ...process.env,
    SFDX_HARDIS_DOC_SCREENSHOTS: "true",
    SFDX_HARDIS_DOC_SCREENSHOTS_DIR:
      process.env.SFDX_HARDIS_DOC_SCREENSHOTS_DIR ||
      path.join(repoRoot, "doc-screenshots"),
    SF_MOCK_VERSIONS_FILE: versionsFile,
  };
  if (only) {
    env.SFDX_HARDIS_DOC_SCREENSHOTS_ONLY = only;
  }

  console.log(`Screenshots output: ${env.SFDX_HARDIS_DOC_SCREENSHOTS_DIR}`);
  if (only) {
    console.log(`Only: ${only}`);
  }
  console.log(`Dependencies state: ${env.SF_MOCK_DEPS_STATE || "ok"}`);
  console.log(`Mocked versions: ${JSON.stringify(versions)}`);

  const status = withReleaseFlavor(() => {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "out", "test", "runUiTest.js")],
      { cwd: repoRoot, env, stdio: "inherit" },
    );
    return result.status === null ? 1 : result.status;
  });
  process.exit(status);
}

main();
