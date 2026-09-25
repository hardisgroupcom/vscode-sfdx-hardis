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

  // Promotion branches variant of the screenshot run: the Beta feature
  // is off in the base fixture, so the ordinary screenshots show a project that
  // does not use it. This variant turns it on, adds the promotion branch to the
  // workspace and serves a git provider fixture holding the User Stories
  // waiting in uat and the open promotion carrying two of them to preprod.
  const promotionVariant =
    docScreenshots &&
    process.env.SFDX_HARDIS_DOC_SCREENSHOTS_PROMOTION === "true";

  // Real-CLI performance gate: same Extension Development Host and dummy
  // project, but the REAL `sf` CLI stays on the PATH (no shim) and only the
  // realCliPerf suite runs. See src/test/ui/realCliPerf.test.ts.
  const realCliPerf =
    process.argv.includes("--real-cli-perf") ||
    process.env.SFDX_HARDIS_REAL_CLI_PERF === "true";

  // Lab driver run (yarn test:ui:labs): the real CLI, and the learner's own
  // clone as the workspace instead of a fixture project. It walks the labs of
  // the training course through the real panels, against real orgs. See
  // src/test/ui/labDriver.ts.
  const labDriver =
    process.argv.includes("--labs") ||
    process.env.SFDX_HARDIS_LAB_DRIVER === "true";

  // Alternate fixture universe for the screenshot run (SF_MOCK_UNIVERSE).
  //
  // Unset keeps the MyCompany-CRM universe exactly as it is, byte for byte.
  // Set to a name, the run reads test/fixtures/screenshot/<name>/universe.json
  // and takes its SFDX project fixture, workspace name, branch topology, git
  // remote and provider fixtures from that folder instead. Nothing existing is
  // edited or repointed: a new universe is new files in new folders.
  //
  // "helios" is the sfdx-hardis training universe. See the training repository.
  const universeName = docScreenshots ? process.env.SF_MOCK_UNIVERSE || "" : "";
  const universeDir = universeName
    ? path.join(
        extensionDevelopmentPath,
        "test",
        "fixtures",
        "screenshot",
        universeName,
      )
    : "";
  const universe = universeName
    ? JSON.parse(
        fs.readFileSync(path.join(universeDir, "universe.json"), "utf8"),
      )
    : null;

  // 1. Copy the SFDX project fixture into a temp workspace
  const fixtureName = universe
    ? universe.fixtureProject
    : docScreenshots
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
  const workspaceName = universe
    ? universe.workspaceName
    : docScreenshots
      ? "MyCompany-CRM"
      : "dummy-sfdx-project";
  // The lab driver opens the learner's own clone, in place: that repository,
  // with its real remote, its real branches and its real orgs, is the object
  // under test. Nothing is copied into it, initialized in it or written to it.
  const workspaceDir = labDriver
    ? path.resolve(process.env.SFDX_HARDIS_LAB_WORKSPACE || "")
    : path.join(workDir, workspaceName);
  if (labDriver) {
    if (!process.env.SFDX_HARDIS_LAB_WORKSPACE) {
      console.error(
        "SFDX_HARDIS_LAB_WORKSPACE must point at the learner's clone of the training repository",
      );
      process.exit(1);
    }
    if (!fs.existsSync(path.join(workspaceDir, ".git"))) {
      console.error(`Not a git repository: ${workspaceDir}`);
      process.exit(1);
    }
    // The fixture modes write into the workspace (branches, config files,
    // commits), which in lab mode is the learner's own repository. A leftover
    // variable from a screenshot session must not silently do that.
    if (docScreenshots || realCliPerf) {
      console.error(
        "The lab driver cannot be combined with the screenshot or perf modes: " +
          "unset SFDX_HARDIS_DOC_SCREENSHOTS / SFDX_HARDIS_REAL_CLI_PERF",
      );
      process.exit(1);
    }
  } else {
    fs.cpSync(fixtureSource, workspaceDir, { recursive: true });
  }

  // 2. Make it a git repository (several extension features probe git)
  const git = (cmd: string) =>
    execSync(`git ${cmd}`, { cwd: workspaceDir, stdio: "pipe" });
  if (!labDriver) {
    git("init");
    git("config user.email uitest@example.com");
    git("config user.name UiTest");
    git("checkout -b integration");
    git("add -A");
    git("commit -m init --no-gpg-sign");
  }

  // A pipeline nobody has worked in yet: no feature branches, no open Pull
  // Requests, no jobs. It is what a learner's own fork looks like at the end of
  // the training setup, and the picture Level 1 has to show them.
  const pipelineState = process.env.SF_MOCK_PIPELINE_STATE || "";
  const freshPipeline = pipelineState.startsWith("fresh");
  // ...and before the extension itself was signed in to the git provider
  const disconnectedProvider = pipelineState === "fresh-disconnected";

  if (universe) {
    for (const branch of universe.branches || []) {
      if (freshPipeline && /^(features|fixes|training)\//.test(branch)) {
        continue;
      }
      git(`branch ${branch}`);
    }
    git(`remote add origin ${universe.remote}`);
  } else if (docScreenshots) {
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

  // The pipeline as Level 3 of the training finishes it: four major branches,
  // each pointing at its org and merging into the next. Levels 1 and 2 stop at
  // uat, so the committed fixture does too, and the Level 3 captures need the
  // finished shape: a four column diagram, and a branch window that lists what
  // is waiting to be promoted rather than a go-live selector.
  // Never in lab mode: workspaceDir is then the learner's own repository, and
  // this block writes config/branches/*.yml into it and commits them.
  if (pipelineState === "level3" && !labDriver) {
    const branchDir = path.join(workspaceDir, "config", "branches");
    fs.mkdirSync(branchDir, { recursive: true });
    const writeBranch = (
      branch: string,
      org: string,
      loginUrl: string,
      mergeTargets: string[],
    ) =>
      fs.writeFileSync(
        path.join(branchDir, `.sfdx-hardis.${branch}.yml`),
        [
          `# Helios ${org} org`,
          `targetUsername: helios.deploy+helios-${org}@heliostraining.invalid`,
          `instanceUrl: ${loginUrl}`,
          `mergeTargets: [${mergeTargets.join(", ")}]`,
          "",
        ].join("\n"),
        "utf8",
      );
    // integration and uat are scratch orgs, preprod and main Developer Editions
    writeBranch("integration", "integration", "https://test.salesforce.com", [
      "uat",
    ]);
    writeBranch("uat", "uat", "https://test.salesforce.com", ["preprod"]);
    writeBranch("preprod", "preprod", "https://login.salesforce.com", ["main"]);
    writeBranch("main", "prod", "https://login.salesforce.com", []);
    execSync("git add -A && git commit -m level3 --no-gpg-sign", {
      cwd: workspaceDir,
      stdio: "pipe",
    });
  }

  // Git provider fixture of the run: the promotion variant merges its overlay
  // into the base one and writes the result next to the temp workspace, so the
  // committed fixtures stay independent from each other.
  let gitProviderFixtureFile = universe
    ? path.join(universeDir, "git-provider-mock.json")
    : path.join(
        extensionDevelopmentPath,
        "test",
        "fixtures",
        "screenshot",
        "git-provider-mock.json",
      );
  if (freshPipeline) {
    const fixture = JSON.parse(fs.readFileSync(gitProviderFixtureFile, "utf8"));
    fixture.openPullRequests = [];
    fixture.mergedPullRequestsByBranch = {};
    fixture.branchJobs = {};
    if (disconnectedProvider) {
      fixture.isActive = false;
    }
    gitProviderFixtureFile = path.join(workDir, "git-provider-mock.json");
    fs.writeFileSync(
      gitProviderFixtureFile,
      JSON.stringify(fixture, null, 2),
      "utf8",
    );
  }
  if (promotionVariant) {
    // The promotion branch exists on the repository, like any branch pushed by
    // hardis:project:promotion:create. An alternate universe names its own, so
    // its screenshots tell the story of its own project rather than this one.
    const promotionBranch =
      (universe && universe.promotionBranch) ||
      "promotion/uat/preprod/2026-08-20-0930";
    git(`branch ${promotionBranch}`);
    // enablePromotionBranches + allowedPromotionSteps, the two project settings
    // the feature needs (see the promotion-branches documentation page)
    const configFile = path.join(workspaceDir, ".sfdx-hardis.yml");
    fs.appendFileSync(
      configFile,
      [
        "enablePromotionBranches: true",
        "allowedPromotionSteps:",
        "  - source: uat",
        "    target: preprod",
        "",
      ].join("\n"),
    );
    // Same rule as the base fixture: a universe brings its own overlay when it
    // has one, and falls back to the MyCompany-CRM one when it has not.
    const universeOverlay = universeDir
      ? path.join(universeDir, "git-provider-mock-promotion.json")
      : "";
    const overlayFile =
      universeOverlay && fs.existsSync(universeOverlay)
        ? universeOverlay
        : path.join(
            extensionDevelopmentPath,
            "test",
            "fixtures",
            "screenshot",
            "git-provider-mock-promotion.json",
          );
    const fixture = JSON.parse(fs.readFileSync(gitProviderFixtureFile, "utf8"));
    const overlay = JSON.parse(fs.readFileSync(overlayFile, "utf8"));
    fixture.openPullRequests = [
      ...(overlay.addOpenPullRequests || []),
      ...(fixture.openPullRequests || []),
    ];
    Object.assign(
      fixture.mergedPullRequestsByBranch,
      overlay.mergedPullRequestsByBranch || {},
    );
    gitProviderFixtureFile = path.join(workDir, "git-provider-mock.json");
    fs.writeFileSync(
      gitProviderFixtureFile,
      JSON.stringify(fixture, null, 2),
      "utf8",
    );
  }

  // 3. Deterministic extension settings for the test workspace
  if (!labDriver) {
    fs.mkdirSync(path.join(workspaceDir, ".vscode"), { recursive: true });
  }
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
    workspaceSettings["window.title"] = workspaceName;
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
  if (labDriver) {
    // The learner's repository is not ours to write in, and a settings.json
    // appearing in it would show up in their next commit. The same settings go
    // to the user level instead, inside the throwaway --user-data-dir.
    const userSettingsDir = path.join(workDir, "user-data", "User");
    fs.mkdirSync(userSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSettingsDir, "settings.json"),
      JSON.stringify(workspaceSettings, null, 2),
    );
  } else {
    fs.writeFileSync(
      path.join(workspaceDir, ".vscode", "settings.json"),
      JSON.stringify(workspaceSettings, null, 2),
    );
  }

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
    // The mock reads the backpromote plan next to its own folder
    fs.cpSync(
      path.join(shimDir, "..", "backpromote"),
      path.join(workDir, "npm-global", "backpromote"),
      { recursive: true },
    );
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
        // The lab driver, like the perf gate, keeps the actual `sf` on the
        // PATH: it walks the course against real orgs, so a mock would prove
        // nothing. The CI markers go the same way, for the same reason.
        ...(labDriver
          ? {
              SFDX_HARDIS_LAB_DRIVER: "true",
              SFDX_HARDIS_LAB_SPECS: process.env.SFDX_HARDIS_LAB_SPECS || "",
              SFDX_HARDIS_LAB_ONLY: process.env.SFDX_HARDIS_LAB_ONLY || "",
              CI: undefined,
              GITHUB_ACTIONS: undefined,
            }
          : {}),
        // Real-CLI perf mode keeps the actual `sf` on the PATH; every other
        // mode but the lab driver answers with the instant mocked CLI
        // (test/fixtures/sf-shim)
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
          : labDriver
            ? {}
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
              SFDX_HARDIS_MOCK_GIT_PROVIDER_FILE: gitProviderFixtureFile,
              // Connected JIRA ticketing provider with the tickets referenced
              // by the mocked pull requests (see ticketProviderMock.ts)
              SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE: universe
                ? path.join(universeDir, "ticket-provider-mock.json")
                : path.join(
                    extensionDevelopmentPath,
                    "test",
                    "fixtures",
                    "screenshot",
                    "ticket-provider-mock.json",
                  ),
              // Selects the fixture set inside the mocked CLI. Empty means the
              // base universe, unchanged.
              SF_MOCK_UNIVERSE: universeName,
              SF_MOCK_UNIVERSE_DIR: universeDir,
              // Feature branch the contribution cards are captured from. A
              // capture can name its own, like the Level 1 story of a fresh
              // pipeline.
              SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH:
                process.env.SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH ||
                (universe ? universe.featureBranch || "" : ""),
              // What the capture script matches on to find the window
              SFDX_HARDIS_DOC_SCREENSHOTS_TITLE: workspaceName,
              SFDX_HARDIS_DOC_SCREENSHOTS_PROMOTION: promotionVariant
                ? "true"
                : "",
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
