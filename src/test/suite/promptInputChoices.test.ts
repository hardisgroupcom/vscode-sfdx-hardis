import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  REPO_ROOT,
  assertKeysTranslated,
  extractMember,
  readModuleFile,
} from "./lwcSourceUtils";

/**
 * Contract tests for the choice rows of s/promptInput.
 *
 * The CLI may list the same choice twice (it did on hardis:project:promotion:create, where a
 * repository merging its branches both ways produced 85 repeated commits out of 452 rows). The
 * component used to identify a row by its value, so both rows collapsed onto one identifier and
 * the template iterations ended up with a duplicated key. The first render survived; the first
 * re-render - typing in the search bar - aborted, LWC unmounted the subtree and the panel went
 * blank while the CLI kept waiting for an answer.
 *
 * The LWC webview bundle cannot be executed in this test host, so the contract is verified by
 * lifting the members out of the component source and running them on a fake component.
 */

const source = readModuleFile("promptInput", "promptInput.js");

/** A fake component exposing the lifted members, with the state they rely on. */
function buildComponent(choices: any[], type = "multiselect"): any {
  const component: any = {
    choiceValueMapping: {},
    valueToIdentifier: {},
    choiceIdentifiers: [],
    selectedValues: [],
    error: null,
    currentPrompt: { type, choices },
    decodeHtmlEntities: (text: string) => text,
  };
  for (const signature of [
    "dedupeChoices(choices)",
    "buildChoiceMappings()",
    "getChoiceDescription(stringIdentifier)",
    "handleSelectAll()",
  ]) {
    const body = extractMember(source, signature);
    const name = signature.slice(0, signature.indexOf("("));
    component[name] = new Function(
      `return function ${body}`,
    )() as unknown as () => void;
  }
  for (const signature of ["get selectOptions()", "get multiselectOptions()"]) {
    const body = extractMember(source, signature).trim().replace(/^get\s+/, "");
    const name = signature.slice(4, signature.indexOf("("));
    const getter = new Function(`return function ${body}`)();
    Object.defineProperty(component, name, { get: getter, configurable: true });
  }
  return component;
}

/** The reported shape: many rows, some of them strictly repeated. */
function reportedChoices(): any[] {
  const choices: any[] = [];
  for (let index = 0; index < 100; index++) {
    choices.push({
      title: `#${index} Story ${index} (dev) [commit${index}]`,
      value: `commit${index}`,
      description: `feature/story-${index}`,
    });
  }
  // 20 commits with no Pull Request, listed a second time exactly as they were
  for (let index = 0; index < 20; index++) {
    choices.push({ ...choices[index] });
  }
  return choices;
}

suite("promptInput choice rows contract", () => {
  test("every iteration key is unique even on a list the CLI repeated itself", () => {
    // No dedupe here on purpose: the rows must be told apart by their own identity, so that an
    // extension paired with an older CLI still renders
    const choices = reportedChoices();
    const component = buildComponent(choices);
    component.buildChoiceMappings();
    const keys = component.multiselectOptions.map((option: any) => option.key);
    assert.strictEqual(keys.length, 120);
    assert.strictEqual(
      new Set(keys).size,
      keys.length,
      "a repeated key blanks the panel on the next render",
    );
    assert.ok(
      keys.every((key: string) => typeof key === "string" && key.length > 0),
      "every row must carry a key",
    );
  });

  test("the repeated rows of an older CLI are dropped before rendering", () => {
    const choices = reportedChoices();
    const component = buildComponent(choices);
    assert.strictEqual(choices.length, 120);
    assert.strictEqual(component.dedupeChoices(choices).length, 100);
  });

  test("a strictly repeated choice is dropped, a shared value under two labels is kept", () => {
    const component = buildComponent([]);
    const deduped = component.dedupeChoices([
      { title: "Story A", value: "aaa", description: "feature/a" },
      { title: "Story A", value: "aaa", description: "feature/a" },
      { title: "Story A, again", value: "aaa", description: "feature/a" },
      { title: "Story B", value: "bbb", description: "" },
    ]);
    assert.deepStrictEqual(
      deduped.map((choice: any) => choice.title),
      ["Story A", "Story A, again", "Story B"],
    );
  });

  test("keys stay unique even when dedupe let two rows share a value", () => {
    const choices = [
      { title: "Story A", value: "aaa", description: "one" },
      { title: "Story A, again", value: "aaa", description: "two" },
    ];
    const component = buildComponent(choices);
    component.buildChoiceMappings();
    const keys = component.multiselectOptions.map((option: any) => option.key);
    assert.strictEqual(new Set(keys).size, 2);
    // Both rows still answer with the same value
    assert.deepStrictEqual(
      keys.map((key: string) => component.choiceValueMapping[key]),
      ["aaa", "aaa"],
    );
    // And each row keeps its own description
    assert.strictEqual(component.getChoiceDescription(keys[0]), "one");
    assert.strictEqual(component.getChoiceDescription(keys[1]), "two");
  });

  test("a preselection given as a value resolves to the first row carrying it", () => {
    const component = buildComponent([
      { title: "Story A", value: "aaa", description: "one" },
      { title: "Story A, again", value: "aaa", description: "two" },
    ]);
    component.buildChoiceMappings();
    assert.strictEqual(
      component.valueToIdentifier[JSON.stringify("aaa")],
      component.choiceIdentifiers[0],
    );
  });

  test("select all ticks one identifier per row", () => {
    const choices = [
      { title: "Story A", value: "aaa", description: "one" },
      { title: "Story A, again", value: "aaa", description: "two" },
      { title: "Story B", value: "bbb", description: "" },
    ];
    const component = buildComponent(choices);
    component.buildChoiceMappings();
    component.handleSelectAll();
    assert.strictEqual(component.selectedValues.length, 3);
    assert.strictEqual(new Set(component.selectedValues).size, 3);
  });

  test("the single select rows carry a key too", () => {
    const component = buildComponent(
      [
        { title: "Story A", value: "aaa", description: "one" },
        { title: "Story A, again", value: "aaa", description: "two" },
      ],
      "select",
    );
    component.buildChoiceMappings();
    const keys = component.selectOptions.map((option: any) => option.key);
    assert.strictEqual(new Set(keys).size, 2);
  });

  test("the template iterations key on the row, never on the value", () => {
    const html = readModuleFile("promptInput", "promptInput.html");
    const iterationKeys = [...html.matchAll(/key=\{option\.(\w+)\}/g)].map(
      (match) => match[1],
    );
    assert.strictEqual(
      iterationKeys.length,
      3,
      "the radio-cards, the list select and the multiselect all iterate over options",
    );
    for (const key of iterationKeys) {
      assert.strictEqual(
        key,
        "key",
        "keying on option.value blanks the panel as soon as two choices share a value",
      );
    }
  });

  test("the command execution panel shows a question it could not display", () => {
    const js = readModuleFile("commandExecution", "commandExecution.js");
    assert.ok(
      /@track promptRenderError/.test(js),
      "the render error must be tracked, or setting it re-renders nothing",
    );
    assert.ok(
      /errorCallback\(error, stack\)/.test(js),
      "the panel must catch the render errors of its children",
    );
    assert.ok(
      /handlePromptRenderErrorCancel\(\)/.test(js),
      "the user must be able to answer a question that could not be displayed",
    );
    const html = readModuleFile("commandExecution", "commandExecution.html");
    assert.ok(
      html.includes("promptCouldNotBeDisplayed"),
      "the failure must be visible in the panel, not only in the console",
    );
  });

  test("the new messages are translated in the 9 locales", () => {
    assertKeysTranslated([
      "promptCouldNotBeDisplayed",
      "promptCouldNotBeDisplayedHint",
      "panelCouldNotBeDisplayed",
    ]);
  });
});

suite("userInput deprecation contract", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const setting =
    packageJson.contributes.configuration.properties[
      "vsCodeSfdxHardis.userInput"
    ];

  test("only the LWC User Interface is offered without a deprecation mark", () => {
    assert.deepStrictEqual(setting.enum, ["ui-lwc", "ui", "console"]);
    assert.strictEqual(setting.default, "ui-lwc");
    const notDeprecated = setting.enumDescriptions.filter(
      (description: string) => !description.startsWith("(Deprecated)"),
    );
    assert.deepStrictEqual(notDeprecated, [
      "Visual Studio Code LWC User Interface",
    ]);
  });

  test("the deprecated modes still work, so the warning only offers to switch", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src", "extension.ts"),
      "utf8",
    );
    assert.ok(
      /warnIfUserInputIsDeprecated/.test(source),
      "the warning must be raised when the extension sets the input mode up",
    );
    // The WebSocket server must still start for the "ui" mode: deprecated is not removed
    assert.ok(
      /userInput === "ui-lwc" \|\| userInput === "ui"/.test(source),
      "deprecating a mode must not stop it from working",
    );
  });

  test("the warning and its button are translated in the 9 locales", () => {
    assertKeysTranslated([
      "userInputDeprecatedWarning",
      "userInputSwitchToLwcUi",
    ]);
  });
});
