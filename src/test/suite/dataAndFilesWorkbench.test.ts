import * as assert from "assert";
import { readModuleFile } from "./lwcSourceUtils";

/**
 * Contract tests for the Data Import/Export Workbench and Files Import/Export
 * Workbench panels (hardis-* kit redesign).
 *
 * The LWC webview bundle cannot be executed in this test host, so these tests
 * verify the workspace-selection contract statically from the source files:
 *  - the workspace rail renders a keyboard-accessible, ARIA-marked selectable
 *    card (role="button", tabindex, aria-pressed, click + keydown handlers)
 *  - the selection state is fully computed in JS (no ternaries in the
 *    template) and reflected in the class returned for the selected card
 */

const PANELS = [
  { name: "dataWorkbench", tile: "violet" },
  { name: "filesWorkbench", tile: "amber" },
];

function readComponentFile(panel: string, ext: "html" | "js"): string {
  return readModuleFile(panel, `${panel}.${ext}`);
}

suite("Data / Files Workbench workspace-selection contract", () => {
  for (const panel of PANELS) {
    test(`${panel.name}: workspace card is a keyboard-accessible selectable card`, () => {
      const html = readComponentFile(panel.name, "html");
      // The rail item must be the shared clickable card, driven by a fully
      // computed class (no ternary/expression allowed in LWC templates).
      assert.match(
        html,
        /class=\{workspace\.cardClass\}/,
        `${panel.name}.html should bind the workspace card class from a JS-computed property`,
      );
      assert.match(
        html,
        /role="button"[\s\S]{0,400}data-path=\{workspace\.path\}/,
        `${panel.name}.html workspace card should be reachable as a button with its path in the dataset`,
      );
      assert.match(
        html,
        /aria-pressed=\{workspace\.isSelected\}/,
        `${panel.name}.html workspace card should expose its selection state via aria-pressed`,
      );
      assert.match(
        html,
        /onclick=\{handleWorkspaceSelect\}/,
        `${panel.name}.html workspace card should select the workspace on click`,
      );
      assert.match(
        html,
        /onkeydown=\{handleCardKeydown\}/,
        `${panel.name}.html workspace card should be operable from the keyboard (Enter/Space)`,
      );
    });

    test(`${panel.name}: selection state is computed in JS, not in the template`, () => {
      const js = readComponentFile(panel.name, "js");
      assert.match(
        js,
        /getWorkspaceCssClass\(isSelected\)\s*\{/,
        `${panel.name}.js should expose getWorkspaceCssClass(isSelected)`,
      );
      assert.match(
        js,
        /"hardis-card clickable"/,
        `${panel.name}.js should use the shared clickable card class`,
      );
      assert.match(
        js,
        /\$\{baseClasses\} selected/,
        `${panel.name}.js should append " selected" to the base card class when the workspace is selected`,
      );
      assert.match(
        js,
        /isSelected\s*\?\s*"true"\s*:\s*"false"/,
        `${panel.name}.js should expose the selection state as a string aria value ("true"/"false")`,
      );
      assert.match(
        js,
        /handleCardKeydown\(event\)\s*\{/,
        `${panel.name}.js should implement the keyboard handler for the workspace card`,
      );
    });

    test(`${panel.name}: panel header uses the shared hardis-* page head kit`, () => {
      const html = readComponentFile(panel.name, "html");
      assert.match(
        html,
        new RegExp(`hardis-tile featured ${panel.tile}`),
        `${panel.name}.html header tile should use the ${panel.tile} hue`,
      );
      assert.ok(
        !html.includes("<lightning-card"),
        `${panel.name}.html should not use <lightning-card> for panel chrome any more`,
      );
    });
  }
});
