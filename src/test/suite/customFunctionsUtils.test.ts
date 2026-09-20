import * as assert from "assert";
import {
  buildFunctionCommandFlags,
  quote,
  serializeInputs,
  serializeOutputs,
} from "../../utils/customFunctionsUtils";

/**
 * The panel describes a whole custom function on a single CLI command line, so the flag builders
 * are the contract between the editor and hardis:project:function:create / update.
 */
suite("customFunctionsUtils", () => {
  suite("serializeInputs", () => {
    test("serializes name, type and required", () => {
      assert.strictEqual(
        serializeInputs([{ name: "channel", type: "string", required: true }]),
        "channel:string:required",
      );
    });

    test("serializes the options of a select and its default", () => {
      assert.strictEqual(
        serializeInputs([
          {
            name: "severity",
            type: "select",
            options: ["info", "warning", "critical"],
            default: "info",
          },
        ]),
        "severity:select|info,warning,critical=info",
      );
    });

    test("joins several inputs with a semicolon", () => {
      assert.strictEqual(
        serializeInputs([
          { name: "channel", type: "string", required: true },
          { name: "retries", type: "number", default: 3 },
        ]),
        "channel:string:required;retries:number=3",
      );
    });

    test("keeps a false default out, and a zero default in", () => {
      assert.strictEqual(
        serializeInputs([{ name: "dryRun", type: "boolean", default: false }]),
        "dryRun:boolean=false",
      );
      assert.strictEqual(
        serializeInputs([{ name: "retries", type: "number", default: 0 }]),
        "retries:number=0",
      );
    });

    test("drops an input without a name", () => {
      assert.strictEqual(
        serializeInputs([{ name: "", type: "string" }, { name: "ok" }]),
        "ok",
      );
    });

    test("returns an empty string for no input", () => {
      assert.strictEqual(serializeInputs([]), "");
    });
  });

  suite("serializeOutputs", () => {
    test("serializes names and optional types", () => {
      assert.strictEqual(
        serializeOutputs([{ name: "messageId" }, { name: "permalink", type: "string" }]),
        "messageId;permalink:string",
      );
    });

    test("returns an empty string for no output", () => {
      assert.strictEqual(serializeOutputs([]), "");
    });
  });

  suite("quote", () => {
    test("wraps a plain value", () => {
      assert.strictEqual(quote("Notify Slack"), '"Notify Slack"');
    });

    test("escapes embedded quotes and backslashes", () => {
      assert.strictEqual(quote('a "b" c'), '"a \\"b\\" c"');
      assert.strictEqual(quote("a\\b"), '"a\\\\b"');
    });

    test("tolerates an empty value", () => {
      assert.strictEqual(quote(""), '""');
    });
  });

  suite("buildFunctionCommandFlags", () => {
    const definition = {
      id: "notifySlack",
      label: "Notify Slack channel",
      runtime: "node",
      script: "scripts/functions/notify-slack.js",
      inputs: [{ name: "channel", type: "string", required: true }],
      outputs: [{ name: "messageId" }],
    };

    test("builds the create flags", () => {
      const flags = buildFunctionCommandFlags(definition, "create");
      assert.ok(flags.includes('--id "notifySlack"'));
      assert.ok(flags.includes('--label "Notify Slack channel"'));
      assert.ok(flags.includes("--runtime node"));
      assert.ok(flags.includes('--script "scripts/functions/notify-slack.js"'));
      assert.ok(flags.includes('--inputs "channel:string:required"'));
      assert.ok(flags.includes('--outputs "messageId"'));
      // No phase restriction declared, and creating never needs to clear one
      assert.ok(!flags.includes("--when"));
    });

    test("passes the phase restriction when one is declared", () => {
      const flags = buildFunctionCommandFlags(
        { ...definition, when: "post-deploy" as const },
        "update",
      );
      assert.ok(flags.includes("--when post-deploy"));
    });

    // "any" is how the CLI removes a restriction: an empty --when is indistinguishable from
    // the flag not being passed, so an update with no phase must send it explicitly.
    test("clears the phase restriction on update when none is declared", () => {
      const flags = buildFunctionCommandFlags(definition, "update");
      assert.ok(flags.includes("--when any"));
    });

    test("always sends the contracts, so emptying them removes them", () => {
      const flags = buildFunctionCommandFlags(
        { ...definition, inputs: [], outputs: [] },
        "update",
      );
      assert.ok(flags.includes('--inputs ""'));
      assert.ok(flags.includes('--outputs ""'));
    });

    test("sends the timeout and the allowed contexts when set", () => {
      const flags = buildFunctionCommandFlags(
        {
          ...definition,
          timeout: 1200,
          allowedContexts: ["process-deployment-only"],
        },
        "update",
      );
      assert.ok(flags.includes("--timeout 1200"));
      assert.ok(flags.includes('--allowed-contexts "process-deployment-only"'));
    });

    test("escapes a label that would break the command line", () => {
      const flags = buildFunctionCommandFlags(
        { ...definition, label: 'Say "hello"' },
        "create",
      );
      assert.ok(flags.includes('--label "Say \\"hello\\""'));
    });
  });
});
