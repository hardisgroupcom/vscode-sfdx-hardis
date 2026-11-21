import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension, waitFor } from "./uiTestUtils";
import { CdpWindow, captureWindowTo, inWebview } from "./cdpWindow";

/**
 * The release versions of the DevOps Pipeline against a REAL git provider: the version chips of
 * the branches, the next version of each promotion, the Releases tab and the Release version tab
 * of a branch, read from the tags of a real repository with the real sf CLI.
 *
 * The release-versioning end to end scenario of sfdx-hardis runs it after each deployment step,
 * to check what the panel shows and to capture it: the captures, in order, show how the versions
 * (custom tag formats included) evolve in time. It only reads.
 *
 *   SFDX_HARDIS_REAL_RELEASE_VERSIONS=true
 *   SFDX_HARDIS_LAB_WORKSPACE                 a clone of the repository, opened as the workspace
 *   SFDX_HARDIS_REAL_RELEASE_VERSIONS_SHOTS   folder of the captures
 *   SFDX_HARDIS_REAL_RELEASE_VERSIONS_PREFIX  prefix of the capture names (ex: 03-preprod-rc1)
 *   SFDX_HARDIS_REAL_RELEASE_VERSIONS_EXPECT  optional JSON: { "<git branch>": "<tag>" } the
 *                                             chips that must be shown before the capture
 *   SFDX_HARDIS_REAL_RELEASE_VERSIONS_TABS    optional, comma separated: "releases" captures the
 *                                             Releases tab, "branch:<git branch>" the Release
 *                                             version tab of that branch
 *   plus the token of the provider in the environment (GITHUB_TOKEN...), and an sf CLI whose
 *   sfdx-hardis has hardis:project:version:list (sf plugins link of the branch under test)
 *
 *   yarn dev && yarn compile && node ./out/test/runUiTest.js
 */

const REAL_MODE = process.env.SFDX_HARDIS_REAL_RELEASE_VERSIONS === "true";
const LWC_ID = "s-pipeline";
// version:list runs after the first paint and fetches the tags of the remote
const WAIT_FOR_VERSIONS_MS = 300000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The mermaid node id of a branch, as BranchStrategyMermaidBuilder.sanitizeNodeName writes it:
// release/uat is drawn as release_uatBranch, pre-prod keeps its hyphen
const nodeIdOf = (branch: string) =>
  `${branch
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/-+/g, "-")}Branch`;

suite("Release versions on a real git provider", function () {
  this.timeout(WAIT_FOR_VERSIONS_MS * 3);

  const shotsDir = process.env.SFDX_HARDIS_REAL_RELEASE_VERSIONS_SHOTS || "";
  const prefix = process.env.SFDX_HARDIS_REAL_RELEASE_VERSIONS_PREFIX || "step";
  const expected: Record<string, string> = JSON.parse(
    process.env.SFDX_HARDIS_REAL_RELEASE_VERSIONS_EXPECT || "{}",
  );
  const tabs = (process.env.SFDX_HARDIS_REAL_RELEASE_VERSIONS_TABS || "")
    .split(",")
    .map((tab) => tab.trim())
    .filter(Boolean);

  // A notification of VS Code (extensions disabled, a sign in offer) can come at any time and covers
  // the bottom right corner of the diagram: cleared before every capture
  const capture = async (name: string) => {
    await vscode.commands.executeCommand("notifications.clearAll");
    await sleep(500);
    await captureWindowTo(shotsDir, name);
  };

  // Text of every version chip, with the mermaid node that holds it and the
  // contrast of its text on its own background: a chip whose text takes the
  // color of its node is in the DOM and invisible on the screen
  const versionChips = () =>
    inWebview(`
      const luminance = (color) => {
        const rgb = (color.match(/[\\d.]+/g) || []).slice(0, 3).map(Number).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      };
      const chips = deepAll(panelDocument, ".hardis-version-chip").map((chip) => {
        const node = chip.closest("g.node");
        const style = getComputedStyle(chip);
        const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
        return {
          text: (chip.textContent || "").trim(),
          classes: chip.className,
          node: node ? node.id || "" : "",
          color: style.color,
          background: style.backgroundColor,
          contrast: Math.round(((light + 0.05) / (dark + 0.05)) * 10) / 10,
        };
      });
      return chips.length > 0 ? chips : null;
    `);

  suiteSetup(async function () {
    if (!REAL_MODE) {
      this.skip();
    }
    const api = await activateExtension();
    const panelManager = api.getLwcPanelManager();
    // The diagram fits the width of the panel: without the side bar, the chat and the
    // notifications, its labels and version chips are big enough to read in a capture
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("notifications.clearAll");
    // The versions are off by default and listed on demand: this suite looks at them
    await vscode.workspace
      .getConfiguration("vsCodeSfdxHardis")
      .update(
        "pipelineShowReleaseVersions",
        true,
        vscode.ConfigurationTarget.Global,
      );
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline");
    await waitFor(
      () => panelManager.getPanel(LWC_ID),
      60000,
      "the pipeline panel to open",
    );
  });

  suiteTeardown(async () => {
    if (REAL_MODE) {
      await vscode.workspace
        .getConfiguration("vsCodeSfdxHardis")
        .update(
          "pipelineShowReleaseVersions",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
    }
  });

  test("each versioned branch shows the version deployed last", async function () {
    const chips: any[] = await waitFor<any>(
      async () => {
        const found = await versionChips();
        if (!Array.isArray(found)) {
          return null;
        }
        const texts = found.map((chip: any) => chip.text);
        return Object.values(expected).every((tag) => texts.includes(tag))
          ? found
          : null;
      },
      WAIT_FOR_VERSIONS_MS,
      `the version chips ${Object.values(expected).join(", ") || "(any)"}`,
    );
    for (const chip of chips) {
      console.log(
        `      chip "${chip.text}" ${chip.classes} on ${chip.node}: ${chip.color} on ${chip.background}, contrast ${chip.contrast}`,
      );
    }
    // WCAG AA for small text
    const unreadable = chips.filter((chip: any) => chip.contrast < 4.5);
    assert.deepStrictEqual(
      unreadable.map(
        (chip: any) => `${chip.text} on ${chip.node} (${chip.contrast})`,
      ),
      [],
      "every version chip is readable",
    );
    for (const [branch, tag] of Object.entries(expected)) {
      assert.ok(
        chips.some(
          (chip: any) =>
            chip.text === tag && chip.node.includes(`-${nodeIdOf(branch)}-`),
        ),
        `${branch} shows ${tag}`,
      );
    }
    // Give the diagram the time to settle before it is captured
    await sleep(2000);
    await capture(`${prefix}-pipeline`);
  });

  test("each view of the switch shows the versions", async function () {
    if (!tabs.includes("views") || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    const pickView = (index: number) =>
      inWebview(`
        const button = deepAll(panelDocument, ".pipeline-view-switch button")[${index}];
        if (!button) {
          return null;
        }
        button.click();
        return true;
      `);
    const names = ["major-branches", "feature-branches", "dev-orgs"];
    for (let index = 0; index < names.length; index++) {
      if (!(await pickView(index))) {
        // No Dev orgs view when the project turned the list off
        continue;
      }
      await sleep(3000);
      await capture(`${prefix}-view-${names[index]}`);
    }
    // Back to the view of the other captures
    await pickView(1);
    await sleep(2000);
  });

  test("the Versions toggle hides the versions of the diagram", async function () {
    if (!tabs.includes("versions-off") || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    const clickToggle = () =>
      inWebview(`
        const button = deepAll(panelDocument, ".pipeline-versions-switch button")[0];
        if (!button) {
          return null;
        }
        button.click();
        return true;
      `);
    const diagramChips = () =>
      inWebview(`
        return deepAll(panelDocument, ".mermaid .hardis-version-chip").length;
      `);
    assert.ok(await clickToggle(), "the Versions toggle exists");
    await waitFor(
      async () => ((await diagramChips()) === 0 ? true : null),
      30000,
      "the diagram without version chips",
    );
    await sleep(2000);
    await capture(`${prefix}-versions-hidden`);
    // Back as the run found it, for the captures that follow
    await clickToggle();
    await waitFor(
      async () => ((await diagramChips()) > 0 ? true : null),
      30000,
      "the version chips back on the diagram",
    );
  });

  test("the Releases tab lists the version tags", async function () {
    if (!tabs.includes("releases") || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    const opened = await inWebview(`
      const tab = deepAll(panelDocument, 'a[role="tab"][data-tab-value="releases"]')[0];
      if (!tab) {
        return null;
      }
      tab.click();
      return true;
    `);
    assert.ok(opened, "the Releases tab exists");
    // Scrolled once the table is there: before, the page ends under the tab header
    await sleep(2500);
    await inWebview(`
      const tab = deepAll(panelDocument, 'a[role="tab"][data-tab-value="releases"]')[0];
      if (!tab) {
        return null;
      }
      tab.scrollIntoView({ block: "start" });
      return true;
    `);
    await sleep(500);
    await capture(`${prefix}-releases`);
  });

  test("the version chip of a branch opens its Release version tab", async function () {
    const branches = tabs
      .filter((tab) => tab.startsWith("branch:"))
      .map((tab) => tab.substring("branch:".length));
    if (branches.length === 0 || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    for (const branch of branches) {
      const nodeId = nodeIdOf(branch);
      const clicked = await inWebview(`
        const node = deepAll(panelDocument, "g.node").find((element) =>
          (element.id || "").includes("-${nodeId}-"),
        );
        const chip = node ? node.querySelector(".hardis-version-chip") : null;
        if (!chip) {
          return null;
        }
        chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      `);
      assert.ok(clicked, `${branch} has a version chip`);
      await waitFor(
        () =>
          inWebview(`
            const tab = deepAll(panelDocument, 'a[role="tab"][data-tab-value="releaseVersion"]')[0];
            return tab && tab.getAttribute("aria-selected") === "true" ? true : null;
          `),
        30000,
        `the Release version tab of ${branch}`,
      );
      await sleep(1500);
      await capture(
        `${prefix}-${branch.replace(/[^A-Za-z0-9]/g, "-")}-release`,
      );
      // Closed before the next branch, so each capture shows one window
      await inWebview(`
        const close = deepAll(panelDocument, ".slds-modal__close")[0];
        if (close) {
          close.click();
        }
        return true;
      `);
      await sleep(1000);
    }
  });
});
