import * as assert from "assert";
import {
  isOrgOpenCommand,
  openOrgFromCommand,
  OrgOpenRunners,
  withUrlOnly,
} from "../../utils/orgUtils";

// Runners of openOrgFromCommand whose CLI answer and link opening are decided by the test
function fakeRunners(
  cliAnswer: any | Error,
  openAnswer: boolean | Error = true,
): OrgOpenRunners & { commands: string[]; opened: string[] } {
  const commands: string[] = [];
  const opened: string[] = [];
  return {
    commands,
    opened,
    exec: async (command) => {
      commands.push(command);
      if (cliAnswer instanceof Error) {
        throw cliAnswer;
      }
      return cliAnswer;
    },
    open: async (url) => {
      opened.push(url);
      if (openAnswer instanceof Error) {
        throw openAnswer;
      }
      return openAnswer;
    },
  };
}

suite("orgUtils open org Test Suite", () => {
  test("recognizes a sf org open command, with or without flags", () => {
    assert.strictEqual(isOrgOpenCommand("sf org open"), true);
    assert.strictEqual(
      isOrgOpenCommand("sf org open --target-org acme@example.com"),
      true,
    );
    assert.strictEqual(
      isOrgOpenCommand(
        "  sf org open --path lightning/setup/SetupOneHome/home",
      ),
      true,
    );
    assert.strictEqual(isOrgOpenCommand("sf org display"), false);
    assert.strictEqual(isOrgOpenCommand("sf hardis:org:select"), false);
    assert.strictEqual(isOrgOpenCommand("sf org open-something"), false);
  });

  test("leaves a browser choice and a chained command to the regular path", () => {
    assert.strictEqual(isOrgOpenCommand("sf org open --private"), false);
    assert.strictEqual(
      isOrgOpenCommand("sf org open --browser firefox"),
      false,
    );
    assert.strictEqual(isOrgOpenCommand("sf org open -b chrome"), false);
    assert.strictEqual(isOrgOpenCommand("sf org open --browser=edge"), false);
    assert.strictEqual(
      isOrgOpenCommand("sf org open --target-org acme && echo done"),
      false,
    );
    assert.strictEqual(isOrgOpenCommand("sf org open || echo failed"), false);
    // The flags of a page path are not browser flags
    assert.strictEqual(
      isOrgOpenCommand("sf org open --path lightning/o/Account/list"),
      true,
    );
  });

  test("asks for the link instead of a browser, once", () => {
    assert.strictEqual(
      withUrlOnly("sf org open --target-org acme"),
      "sf org open --target-org acme --url-only",
    );
    assert.strictEqual(
      withUrlOnly("sf org open --url-only"),
      "sf org open --url-only",
    );
    assert.strictEqual(
      withUrlOnly("sf org open -r --target-org acme"),
      "sf org open -r --target-org acme",
    );
    assert.strictEqual(
      withUrlOnly("  sf org open  "),
      "sf org open --url-only",
    );
  });

  test("opens the link the CLI returned, with a fresh run every time", async () => {
    const runners = fakeRunners({
      status: 0,
      result: {
        url: "https://acme.my.salesforce.com/secur/frontdoor.jsp?otp=1",
      },
    });
    const outcome = await openOrgFromCommand(
      "sf org open --target-org acme",
      "Opening",
      { runners },
    );
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.reason, null);
    assert.deepStrictEqual(runners.commands, [
      "sf org open --target-org acme --url-only",
    ]);
    assert.deepStrictEqual(runners.opened, [
      "https://acme.my.salesforce.com/secur/frontdoor.jsp?otp=1",
    ]);
  });

  test("reports a CLI failure with its message and a failed result", async () => {
    const runners = fakeRunners({
      status: 1,
      message: "No authorization information found for acme.",
    });
    const outcome = await openOrgFromCommand("sf org open", "Opening", {
      runners,
    });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(
      outcome.reason,
      "No authorization information found for acme.",
    );
    assert.strictEqual(outcome.result.status, 1);
    assert.deepStrictEqual(runners.opened, []);
  });

  test("reports a CLI that threw, or failed without a message, with a reason", async () => {
    const thrown = await openOrgFromCommand("sf org open", "Opening", {
      runners: fakeRunners(new Error("spawn sf ENOENT")),
    });
    assert.strictEqual(thrown.ok, false);
    assert.strictEqual(thrown.reason, "spawn sf ENOENT");
    assert.strictEqual(thrown.result.status, 1);

    const silent = await openOrgFromCommand("sf org open", "Opening", {
      runners: fakeRunners({ status: 2 }),
    });
    assert.strictEqual(silent.ok, false);
    assert.ok(silent.reason, "a failure without a message still has a reason");
    assert.strictEqual(silent.result.status, 2);
  });

  test("reports a CLI answer without a link as a failed result", async () => {
    const runners = fakeRunners({ status: 0, result: {} });
    const outcome = await openOrgFromCommand("sf org open", "Opening", {
      runners,
    });
    assert.strictEqual(outcome.ok, false);
    assert.ok(outcome.reason);
    assert.strictEqual(outcome.result.status, 1);
    assert.strictEqual(outcome.result.message, outcome.reason);
    assert.deepStrictEqual(runners.opened, []);
  });

  test("reports a link VS Code refused or failed to open", async () => {
    const answer = { status: 0, result: { url: "https://acme.example.com" } };
    const refused = await openOrgFromCommand("sf org open", "Opening", {
      runners: fakeRunners(answer, false),
    });
    assert.strictEqual(refused.ok, false);
    assert.ok(refused.reason);
    assert.strictEqual(refused.result.status, 1);

    const failed = await openOrgFromCommand("sf org open", "Opening", {
      runners: fakeRunners(answer, new Error("no opener")),
    });
    assert.strictEqual(failed.ok, false);
    assert.ok(failed.reason?.endsWith(": no opener"), failed.reason || "");
  });
});
