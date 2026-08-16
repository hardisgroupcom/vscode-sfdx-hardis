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

  // 1. Copy the dummy SFDX project fixture into a temp workspace
  const fixtureSource = path.join(
    extensionDevelopmentPath,
    "test",
    "fixtures",
    "dummy-sfdx-project",
  );
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vscode-sfdx-hardis-uitest-"),
  );
  const workspaceDir = path.join(workDir, "dummy-sfdx-project");
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

  // 3. Deterministic extension settings for the test workspace
  fs.mkdirSync(path.join(workspaceDir, ".vscode"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, ".vscode", "settings.json"),
    JSON.stringify(
      {
        "vsCodeSfdxHardis.showWelcomeAtStartup": false,
        "vsCodeSfdxHardis.disableGitBashCheck": true,
        "vsCodeSfdxHardis.disableVsCodeColors": true,
        "vsCodeSfdxHardis.userInput": "ui-lwc",
        "vsCodeSfdxHardis.userInputCommandLineIfLWC": "background",
        "telemetry.telemetryLevel": "off",
      },
      null,
      2,
    ),
  );

  // 4. Prepare the sf CLI shim (mock) and its invocation log
  const shimDir = path.join(
    extensionDevelopmentPath,
    "test",
    "fixtures",
    "sf-shim",
  );
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(shimDir, "sf"), 0o755);
  }
  const mockLogFile = path.join(workDir, "sf-mock-invocations.log");

  const userDataDir = path.join(workDir, "user-data");

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--disable-gpu",
        `--user-data-dir=${userDataDir}`,
      ],
      extensionTestsEnv: {
        PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
        Path: `${shimDir}${path.delimiter}${process.env.Path || process.env.PATH || ""}`,
        SF_MOCK_LOG: mockLogFile,
        SF_MOCK_NODE_MODULES: path.join(
          extensionDevelopmentPath,
          "node_modules",
        ),
        VSCODE_SFDX_HARDIS_UI_TEST: "true",
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
