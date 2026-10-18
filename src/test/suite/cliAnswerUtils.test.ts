import * as assert from "assert";
import {
  asAnswerCount,
  asAnswerObjects,
  cleanAnswerText,
  failedCommandMessage,
} from "../../utils/cliAnswerUtils";

suite("cliAnswerUtils Test Suite", () => {
  test("the message of a failed command comes first, then the other messages, then stderr", () => {
    assert.strictEqual(
      failedCommandMessage({ message: " Boom ", stderr: "ignored" }, 100),
      "Boom",
    );
    assert.strictEqual(
      failedCommandMessage(
        { message: " ", result: { message: "Inner" } },
        100,
        ["Inner"],
      ),
      "Inner",
    );
    assert.strictEqual(
      failedCommandMessage({ message: "", stderr: "Plain error" }, 100),
      "Plain error",
    );
  });

  test("a JSON stderr or no message at all gives an empty message", () => {
    assert.strictEqual(
      failedCommandMessage({ stderr: '{"status":1}' }, 100),
      "",
    );
    assert.strictEqual(failedCommandMessage(undefined, 100), "");
  });

  test("a message is cut at its maximum length and loses its ANSI codes", () => {
    assert.strictEqual(
      failedCommandMessage({ message: "\u001b[31mFailed run\u001b[39m" }, 6),
      "Failed",
    );
  });

  test("only the objects of a list are kept, at most maxRows", () => {
    assert.deepStrictEqual(
      asAnswerObjects([{ a: 1 }, null, "x", { b: 2 }], 1),
      [{ a: 1 }],
    );
    assert.deepStrictEqual(asAnswerObjects("not a list", 10), []);
  });

  test("a count is a finite number or 0", () => {
    assert.strictEqual(asAnswerCount(4), 4);
    assert.strictEqual(asAnswerCount(Number.NaN), 0);
    assert.strictEqual(asAnswerCount("4"), 0);
  });

  test("a text that is not a string becomes empty", () => {
    assert.strictEqual(cleanAnswerText(12, 10), "");
    assert.strictEqual(cleanAnswerText("  hello  ", 10), "hello");
  });
});
