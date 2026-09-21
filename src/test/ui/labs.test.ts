import * as assert from "assert";
import { execSync } from "child_process";
import * as vscode from "vscode";
import { activateExtension } from "./uiTestUtils";
import {
  LabSpec,
  labSpecFile,
  openPanel,
  readLabSpecs,
  runLabStep,
} from "./labDriver";

/**
 * Lab driver run (yarn test:ui:labs).
 *
 * Walks the labs of the sfdx-hardis training course through the real panels,
 * against the REAL Salesforce CLI and the learner's REAL clone and orgs. It is
 * the only suite here that uses none of the fixtures: the workspace is the
 * learner's own repository, given by SFDX_HARDIS_LAB_WORKSPACE, and the orgs
 * are the ones they connected.
 *
 * It is selected by runUiTest.js --labs, never by an ordinary `yarn test:ui`,
 * because it changes real orgs and a real repository and takes minutes per lab.
 *
 * The labs it can drive are the ones a learner does by clicking in the
 * extension. The rest of a lab (a Salesforce Setup page, a Pull Request, a
 * merge) is not a panel and stays with the training repository's own runbook.
 *
 * Environment:
 *   SFDX_HARDIS_LAB_WORKSPACE  the learner's clone, opened as the workspace
 *   SFDX_HARDIS_LAB_SPECS      the spec file (default: the sibling training repo)
 *   SFDX_HARDIS_LAB_ONLY       "1.3", or "1" for a whole level (default: all)
 */

const LAB_MODE = process.env.SFDX_HARDIS_LAB_DRIVER === "true";

/** Panels a lab can ask for by name, and the command that opens each. */
const PANEL_COMMANDS: Record<string, string> = {
  "s-welcome": "vscode-sfdx-hardis.showWelcome",
  "s-pipeline": "vscode-sfdx-hardis.showPipeline",
  "s-pipeline-config": "vscode-sfdx-hardis.showPipelineConfig",
  "s-org-manager": "vscode-sfdx-hardis.openOrgsManager",
  "s-org-monitoring": "vscode-sfdx-hardis.showOrgMonitoring",
};

function selected(lab: LabSpec): boolean {
  const only = process.env.SFDX_HARDIS_LAB_ONLY || "";
  if (!only) {
    return true;
  }
  return only
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => lab.id === entry || lab.id.startsWith(`${entry}.`));
}

(LAB_MODE ? suite : suite.skip)("Training course lab driver", function () {
  this.timeout(1800000);
  let panelManager: any;
  const specs = LAB_MODE ? readLabSpecs() : null;

  suiteSetup(async function () {
    // Fail loudly rather than silently green: this suite is worthless if the
    // real CLI, the plugin or the specs are not there.
    let version = "";
    try {
      version = execSync("sf --version", { encoding: "utf8" }).trim();
    } catch {
      assert.fail(
        "The real Salesforce CLI (sf) must be installed and on the PATH for the lab driver",
      );
    }
    const plugins = execSync("sf plugins", { encoding: "utf8" });
    assert.ok(
      plugins.includes("sfdx-hardis"),
      `The sfdx-hardis plugin must be installed (sf plugins returned:\n${plugins})`,
    );
    assert.ok(
      specs,
      `No lab specs at ${labSpecFile()}. Clone the training repository as a ` +
        "sibling, or set SFDX_HARDIS_LAB_SPECS.",
    );
    const folders = vscode.workspace.workspaceFolders || [];
    assert.ok(
      folders.length > 0,
      "The lab driver needs the learner's clone opened as the workspace",
    );
    console.log(`Lab driver: ${version}`);
    console.log(`Lab driver workspace: ${folders[0].uri.fsPath}`);
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  for (const lab of (specs?.labs || []).filter(selected)) {
    const title = `Lab ${lab.id} - ${lab.title}`;
    if (lab.skip) {
      test.skip(`${title} (${lab.skip})`, function () {
        // Declared so the report lists it as not covered rather than silently absent
      });
      continue;
    }

    test(title, async function () {
      for (const panelId of lab.openPanels || []) {
        const command = PANEL_COMMANDS[panelId];
        assert.ok(
          command,
          `Lab ${lab.id} opens "${panelId}", which the driver does not know how to open`,
        );
        await openPanel(panelManager, panelId, command);
      }
      for (const step of lab.steps) {
        console.log(`[lab ${lab.id}] ${step.label}: ${step.command}`);
        await runLabStep(panelManager, step);
      }
    });
  }
});
