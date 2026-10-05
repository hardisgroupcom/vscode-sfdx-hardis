import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, extractMember, readModuleFile } from "./lwcSourceUtils";

/**
 * Contract tests for the secrets typed in s/promptInput.
 *
 * sfdx-hardis marks the question of a token or of a password as sensitive, and never echoes its
 * answer. The panel used to show what was typed in a plain text field all the same: a Personal
 * Access Token ended up readable on a shared screen and in screenshots.
 *
 * The LWC webview bundle cannot be executed in this test host, so the contract is verified by
 * lifting the getter out of the component source, and by reading the template.
 */

function textInputTypeOf(currentPrompt: any): string {
  const body = extractMember(
    readModuleFile("promptInput", "promptInput.js"),
    "get textInputType()",
  )
    .trim()
    .replace(/^get\s+/, "");
  const getter = new Function(`return function ${body}`)();
  return getter.call({ currentPrompt });
}

suite("Prompt input: sensitive questions", () => {
  test("a sensitive text question is typed in a masked field", () => {
    assert.strictEqual(
      textInputTypeOf({ type: "text", sensitive: true }),
      "password",
    );
  });

  test("any other text question stays readable while it is typed", () => {
    assert.strictEqual(textInputTypeOf({ type: "text" }), "text");
    assert.strictEqual(
      textInputTypeOf({ type: "text", sensitive: false }),
      "text",
    );
    assert.strictEqual(textInputTypeOf(null), "text");
  });

  test("the text field of the template takes its type from the question", () => {
    const template = readModuleFile("promptInput", "promptInput.html");
    assert.ok(
      template.includes("type={textInputType}"),
      "the text input must bind its type to textInputType",
    );
    assert.ok(
      !/<lightning-input\s+type="text"/.test(template),
      "no text input may be hardcoded as readable",
    );
  });

  // With vsCodeSfdxHardis.userInput set to "ui", a text question is asked in the input box of
  // VS Code instead of the panel
  test("the input box of VS Code masks a sensitive question too", () => {
    const server = fs.readFileSync(
      path.join(REPO_ROOT, "src", "hardis-websocket-server.ts"),
      "utf8",
    );
    assert.ok(
      server.includes("password: prompt.sensitive === true"),
      "the text input box must be a password box for a sensitive question",
    );
  });
});
