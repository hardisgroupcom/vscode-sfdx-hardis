import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";

import { runTests } from "@vscode/test-electron";

/**
 * Launches the UI integration tests: a real VS Code (Extension Development
 * Host) opening a dummy SFDX project, with a mocked `sf` CLI on the PATH that
 * answers instantly and speaks the sfdx-hardis WebSocket protocol.
 *
 * Prerequisites (see the ui-test job in .github/workflows/test.yml):
 *   yarn dev      (webpack: webview bundle + assets)
 *   yarn compile  (tsc: out/extension.js + out/test)
 */
async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  const extensionTestsPath = path.resolve(__dirname, "./ui/index");

  // Documentation screenshot mode: a richer fixture (SFDMU workspaces, major
  // branch configs, several git branches) so every panel has realistic content
  // to display, and only the docScreenshots suite runs.
  const docScreenshots = process.env.SFDX_HARDIS_DOC_SCREENSHOTS === "true";

  // Real-CLI performance gate: same Extension Development Host and dummy
  // project, but the REAL `sf` CLI stays on the PATH (no shim) and only the
  // realCliPerf suite runs. See src/test/ui/realCliPerf.test.ts.
  const realCliPerf =
    process.argv.includes("--real-cli-perf") ||
    process.env.SFDX_HARDIS_REAL_CLI_PERF === "true";

  // 1. Copy the SFDX project fixture into a temp workspace
  const fixtureName = docScreenshots
    ? "doc-screenshots-project"
    : "dummy-sfdx-project";
  const fixtureSource = path.join(
    extensionDevelopmentPath,
    "test",
    "fixtures",
    fixtureName,
  );
  // VS Code creates a unix domain socket (IPC handle) inside --user-data-dir.
  // Unix sockets are limited to ~103 chars: on macOS os.tmpdir() is the long
  // /var/folders/<xx>/<hash>/T/ path, which makes the main process fail with
  // "listen EINVAL". /tmp (a symlink to /private/tmp) is short and writable.
  // Windows and Linux keep os.tmpdir().
  const tmpBase = process.platform === "darwin" ? "/tmp" : os.tmpdir();
  const workDir = fs.mkdtempSync(path.join(tmpBase, "sfh-uitest-"));
  // The workspace folder name is the project name shown in the VS Code title
  // bar, so the screenshot fixture uses a realistic one.
  const workspaceDir = path.join(
    workDir,
    docScreenshots ? "MyCompany-CRM" : "dummy-sfdx-project",
  );
  fs.cpSync(fixtureSource, workspaceDir, { recursive: true });

  // 2. Make it a git repository (several extension features probe git)
  const git = (cmd: string) =>
    execSync(`git ${cmd}`, { cwd: workspaceDir, stdio: "pipe" });
  git("init");
  git("config user.email uitest@example.com");
  git("config user.name UiTest");
  git("checkout -b integration");
  git("add -A");
  git("commit -m init --no-gpg-sign");

  if (docScreenshots) {
    // Major branches + feature branches, so the pipeline diagram has something
    // to draw. A fake "origin" remote makes the branches look tracked.
    for (const branch of ["uat", "preprod", "main"]) {
      git(`branch ${branch}`);
    }
    for (const branch of [
      "feature/CRM-1042-account-hierarchy",
      "feature/CRM-1055-quote-approval-process",
      "fix/CRM-1061-opportunity-trigger",
      "fix/CRM-1101-invoice-rounding",
      // Monitoring branch: feeds the "Copy from branch" menu of the
      // Monitoring Config workbench
      "monitoring_mycompany",
    ]) {
      git(`branch ${branch}`);
    }
    git("remote add origin https://github.com/mycompany/salesforce-crm.git");
  }

  // 3. Deterministic extension settings for the test workspace
  fs.mkdirSync(path.join(workspaceDir, ".vscode"), { recursive: true });
  const workspaceSettings: Record<string, unknown> = {
    "vsCodeSfdxHardis.showWelcomeAtStartup": false,
    "vsCodeSfdxHardis.disableGitBashCheck": true,
    "vsCodeSfdxHardis.orgColorMode": "off",
    "vsCodeSfdxHardis.showOrgStatusBarItem": false,
    "vsCodeSfdxHardis.userInput": "ui-lwc",
    "vsCodeSfdxHardis.userInputCommandLineIfLWC": "background",
    "telemetry.telemetryLevel": "off",
  };
  // Visual QA runs (SFDX_HARDIS_VISUAL_SHOWCASE) can force a VS Code theme,
  // e.g. SFDX_HARDIS_VISUAL_THEME=light to screenshot webviews in light mode
  if (process.env.SFDX_HARDIS_VISUAL_THEME === "light") {
    workspaceSettings["workbench.colorTheme"] = "Default Light Modern";
    workspaceSettings["vsCodeSfdxHardis.theme.colorTheme"] = "light";
  } else if (process.env.SFDX_HARDIS_VISUAL_THEME === "dark") {
    workspaceSettings["workbench.colorTheme"] = "Default Dark Modern";
    workspaceSettings["vsCodeSfdxHardis.theme.colorTheme"] = "dark";
  }
  if (docScreenshots) {
    // Documentation screenshots are always taken in light mode, English, with
    // a clean chrome (no minimap, no breadcrumbs, no editor decorations).
    // SFDX_HARDIS_DOC_SCREENSHOTS_THEME=dark switches to dark for design QA:
    // every panel has to look right in both themes.
    const darkQa = process.env.SFDX_HARDIS_DOC_SCREENSHOTS_THEME === "dark";
    workspaceSettings["workbench.colorTheme"] = darkQa
      ? "Default Dark Modern"
      : "Default Light Modern";
    workspaceSettings["vsCodeSfdxHardis.theme.colorTheme"] = darkQa
      ? "dark"
      : "light";
    workspaceSettings["workbench.startupEditor"] = "none";
    workspaceSettings["workbench.editor.showTabs"] = "multiple";
    workspaceSettings["workbench.statusBar.visible"] = true;
    workspaceSettings["breadcrumbs.enabled"] = false;
    workspaceSettings["editor.minimap.enabled"] = false;
    workspaceSettings["window.commandCenter"] = false;
    workspaceSettings["workbench.layoutControl.enabled"] = false;
    workspaceSettings["window.zoomLevel"] = 0;
    workspaceSettings["update.showReleaseNotes"] = false;
    // Stable title: it is both what the screenshots show and what the capture
    // script matches on to find the window
    workspaceSettings["window.title"] = "MyCompany-CRM";
    workspaceSettings["workbench.secondarySideBar.defaultVisibility"] =
      "hidden";
    workspaceSettings["chat.commandCenter.enabled"] = false;
    workspaceSettings["workbench.activityBar.location"] = "default";
    workspaceSettings["workbench.tips.enabled"] = false;
    // The DevOps Pipeline documentation shows the full diagram: feature
    // branches (from the mocked open pull requests) included
    workspaceSettings["vsCodeSfdxHardis.pipelineDisplayFeatureBranches"] = true;
    workspaceSettings["git.openRepositoryInParentFolders"] = "never";
    workspaceSettings["git.autofetch"] = false;
    workspaceSettings["extensions.ignoreRecommendations"] = true;
  }
  fs.writeFileSync(
    path.join(workspaceDir, ".vscode", "settings.json"),
    JSON.stringify(workspaceSettings, null, 2),
  );

  // 4. Prepare the sf CLI shim (mock) and its invocation log
  let shimDir = path.join(
    extensionDevelopmentPath,
    "test",
    "fixtures",
    "sf-shim",
  );
  if (docScreenshots) {
    // The Setup panel warns when `sf` does not look like an npm global install
    // ("installed via the Salesforce native installer"). Serving the shim from
    // a path containing "npm" keeps that note out of the screenshots.
    const npmShimDir = path.join(workDir, "npm-global", "sf-shim");
    fs.cpSync(shimDir, npmShimDir, { recursive: true });
    shimDir = npmShimDir;
  }
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(shimDir, "sf"), 0o755);
  }
  const mockLogFile = path.join(workDir, "sf-mock-invocations.log");

  const userDataDir = path.join(workDir, "user-data");

  // Documentation screenshots run with their own extensions folder, seeded with
  // a stub of the Salesforce Extension Pack so the Setup panel reports it as
  // installed. It lives in the temp work dir because VS Code writes into it
  // (it downloads the real pack when it can reach the marketplace).
  const screenshotExtensionsDir = path.join(workDir, "extensions");
  if (docScreenshots) {
    fs.cpSync(
      path.join(
        extensionDevelopmentPath,
        "test",
        "fixtures",
        "screenshot",
        "extensions",
      ),
      screenshotExtensionsDir,
      { recursive: true },
    );
  }

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        // Documentation screenshots need the Salesforce Extension Pack to look
        // installed (Setup panel), so they load a dedicated extensions folder
        // holding a stub of it instead of disabling extensions altogether.
        ...(docScreenshots
          ? [
              `--extensions-dir=${screenshotExtensionsDir}`,
              // Built-in Copilot would open a chat side bar over the panels
              "--disable-extension=github.copilot",
              "--disable-extension=github.copilot-chat",
              "--disable-extension=GitHub.copilot",
              "--disable-extension=GitHub.copilot-chat",
            ]
          : ["--disable-extensions"]),
        "--disable-workspace-trust",
        "--disable-gpu",
        `--user-data-dir=${userDataDir}`,
      ],
      extensionTestsEnv: {
        // Real-CLI perf mode keeps the actual `sf` on the PATH; every other
        // mode answers with the instant mocked CLI (test/fixtures/sf-shim)
        ...(realCliPerf
          ? {
              SFDX_HARDIS_REAL_CLI_PERF: "true",
              // GitHub Actions marks the environment as CI, but sfdx-hardis
              // skips its WebSocket client (so panels, prompts and this test)
              // when CI is set: the gate needs the interactive behavior.
              // An undefined value removes the variable from the child env.
              CI: undefined,
              GITHUB_ACTIONS: undefined,
            }
          : {
              PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
              Path: `${shimDir}${path.delimiter}${process.env.Path || process.env.PATH || ""}`,
              SF_MOCK_LOG: mockLogFile,
              SF_MOCK_NODE_MODULES: path.join(
                extensionDevelopmentPath,
                "node_modules",
              ),
            }),
        VSCODE_SFDX_HARDIS_UI_TEST: "true",
        ...(docScreenshots
          ? {
              SFDX_HARDIS_DOC_SCREENSHOTS: "true",
              SFDX_HARDIS_DOC_SCREENSHOTS_DIR:
                process.env.SFDX_HARDIS_DOC_SCREENSHOTS_DIR ||
                path.join(extensionDevelopmentPath, "doc-screenshots"),
              SFDX_HARDIS_DOC_SCREENSHOTS_ONLY:
                process.env.SFDX_HARDIS_DOC_SCREENSHOTS_ONLY || "",
              SF_MOCK_PROFILE: "docs",
              // Git provider answers (open PRs with CI jobs, merged PRs,
              // go-lives) served from a fixture so the DevOps Pipeline shows
              // feature branches and running jobs (see gitProviderMock.ts)
              SFDX_HARDIS_MOCK_GIT_PROVIDER_FILE: path.join(
                extensionDevelopmentPath,
                "test",
                "fixtures",
                "screenshot",
                "git-provider-mock.json",
              ),
              // Connected JIRA ticketing provider with the tickets referenced
              // by the mocked pull requests (see ticketProviderMock.ts)
              SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE: path.join(
                extensionDevelopmentPath,
                "test",
                "fixtures",
                "screenshot",
                "ticket-provider-mock.json",
              ),
              SF_MOCK_DEPS_STATE: process.env.SF_MOCK_DEPS_STATE || "ok",
              SF_MOCK_VERSIONS_FILE: process.env.SF_MOCK_VERSIONS_FILE || "",
              // Screenshots must not depend on what npm answers today: the
              // "latest version" cache is seeded by the suite instead, and an
              // unroutable proxy makes every outbound HTTP call fail fast.
              HTTP_PROXY: "http://127.0.0.1:9",
              HTTPS_PROXY: "http://127.0.0.1:9",
              NO_PROXY: "localhost,127.0.0.1",
            }
          : {}),
      },
    });
  } catch (err) {
    console.error("Failed to run UI tests", err);
    process.exit(1);
  } finally {
    // Best-effort cleanup of the temp workspace
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Files may still be locked by the just-closed VS Code on Windows
    }
  }
}

main();
