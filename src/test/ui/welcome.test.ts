import * as assert from "assert";
import * as vscode from "vscode";

/**
 * UI integration tests for the Welcome page (v8 design).
 *
 * They run in a real Extension Development Host on the dummy SFDX project.
 * The webview DOM itself is not reachable from the extension host, so the
 * tests exercise the extension side of the page: panel creation, the
 * initialization data that drives the LWC (branding URLs, version), and the
 * navigateTo message handling with its whitelist.
 */

const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";

async function waitFor<T>(
  producer: () => T | undefined | null | false,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = producer();
    if (value) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite("Welcome page UI tests", function () {
  let api: any;
  let panelManager: any;

  suiteSetup(async function () {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} not found`);
    api = await extension!.activate();
    assert.ok(api, "activate() must return the test API");
    panelManager = api.getLwcPanelManager();
  });

  test("welcome panel opens with the v8 branding data", async function () {
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
    const panel = await waitFor(
      () => panelManager.getPanel("s-welcome"),
      10000,
      "welcome panel to open",
    );

    const initData = panel.getInitializationData();
    assert.ok(initData, "Welcome panel must expose its initialization data");
    // Cloudity link behind the logo in the hero and the footer card
    assert.ok(
      (initData.websiteUrl || "").includes("cloudity.com"),
      `websiteUrl must point to cloudity.com (got: ${initData.websiteUrl})`,
    );
    assert.ok(
      (initData.contactFormUrl || "").includes("cloudity.com"),
      "contactFormUrl must point to cloudity.com",
    );
    // Star on GitHub + See what's new links
    assert.ok(
      (initData.repositoryUrl || "").includes(
        "github.com/hardisgroupcom/vscode-sfdx-hardis",
      ),
      `repositoryUrl must point to the extension repository (got: ${initData.repositoryUrl})`,
    );
    assert.ok(
      (initData.whatsNewUrl || "").includes("CHANGELOG"),
      "whatsNewUrl must point to the changelog",
    );
    // Version pill in the hero
    assert.match(
      initData.extensionVersion || "",
      /^\d+\.\d+\.\d+/,
      `extensionVersion must be a semver (got: ${initData.extensionVersion})`,
    );
    // Quick start / docs links
    assert.ok(
      (initData.docsiteUrl || "").includes("sfdx-hardis"),
      "docsiteUrl must point to the documentation site",
    );
  });

  test("navigateTo message opens the requested panel (whitelisted target)", async function () {
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
    const welcomePanel = await waitFor(
      () => panelManager.getPanel("s-welcome"),
      10000,
      "welcome panel to open",
    );

    welcomePanel.simulateWebviewMessage({
      type: "navigateTo",
      data: { target: "extensionConfig" },
    });
    await waitFor(
      () => panelManager.getPanel("s-extension-config"),
      10000,
      "extension config panel to open through navigateTo",
    );
    panelManager.disposePanel("s-extension-config");
  });

  test("navigateTo message ignores targets not in the whitelist", async function () {
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showWelcome");
    const welcomePanel = await waitFor(
      () => panelManager.getPanel("s-welcome"),
      10000,
      "welcome panel to open",
    );

    const panelsBefore = [...panelManager.getActivePanelIds()].sort();
    welcomePanel.simulateWebviewMessage({
      type: "navigateTo",
      data: { target: "workbench.action.terminal.new" },
    });
    welcomePanel.simulateWebviewMessage({
      type: "navigateTo",
      data: { target: "notAWhitelistedTarget" },
    });
    // Give any (unexpected) navigation time to happen
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const panelsAfter = [...panelManager.getActivePanelIds()].sort();
    assert.deepStrictEqual(
      panelsAfter,
      panelsBefore,
      "A non-whitelisted navigateTo target must not open anything",
    );
  });
});
