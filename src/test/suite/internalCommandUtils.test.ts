import * as assert from "assert";
import { getInternalCommandFailureReason } from "../../utils/internalCommandUtils";

suite("internalCommandUtils Test Suite", () => {
  test("a successful command has no failure reason", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({ status: 0, stdout: "", stderr: "" }),
      null,
    );
  });

  test("warnings on stderr do not make a successful command a failure", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({
        status: 0,
        stdout: "Opening org",
        stderr: "Warning: a new version is available",
      }),
      null,
    );
  });

  test("a successful --json command has no failure reason", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({ status: 0, result: { url: "x" } }),
      null,
    );
  });

  test("a failed sf org open reports what the CLI wrote on stderr", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({
        status: 1,
        stdout: "",
        stderr: "Error (1): No authorization information found for acme.\n",
        unableToParseJson: true,
      }),
      "Error (1): No authorization information found for acme.",
    );
  });

  test("a failed --json command reports its message", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({
        status: 1,
        name: "NamedOrgNotFoundError",
        message: "No authorization information found for acme.",
        stderr: "",
      }),
      "No authorization information found for acme.",
    );
  });

  test("falls back to the spawn error, then to stdout", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({
        status: 1,
        stdout: "",
        stderr: "",
        error: { message: "spawn sf ENOENT" },
      }),
      "spawn sf ENOENT",
    );
    assert.strictEqual(
      getInternalCommandFailureReason({ status: 1, stdout: "it broke" }),
      "it broke",
    );
  });

  test("colors are removed and a long reason is cut", () => {
    assert.strictEqual(
      getInternalCommandFailureReason({
        status: 1,
        stderr: "\u001b[31mError\u001b[39m",
      }),
      "Error",
    );
    const reason = getInternalCommandFailureReason({
      status: 1,
      stderr: "x".repeat(2000),
    });
    assert.strictEqual(reason, "x".repeat(500) + "...");
  });

  test("a call that threw, or a failure that says nothing, is still a failure", () => {
    assert.strictEqual(getInternalCommandFailureReason(null), "");
    assert.strictEqual(getInternalCommandFailureReason({ status: 1 }), "");
  });
});
