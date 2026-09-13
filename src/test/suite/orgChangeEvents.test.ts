import * as assert from "assert";
import { emitOrgsChanged, onOrgsChanged } from "../../utils/orgChangeEvents";

suite("Org change events", () => {
  test("calls every listener until it is disposed, even when one of them fails", () => {
    const calls: string[] = [];
    const failing = onOrgsChanged(() => {
      calls.push("failing");
      throw new Error("listener error");
    });
    const panel = onOrgsChanged(() => calls.push("panel"));
    emitOrgsChanged();
    assert.deepStrictEqual(calls, ["failing", "panel"]);
    panel.dispose();
    failing.dispose();
    emitOrgsChanged();
    assert.deepStrictEqual(calls, ["failing", "panel"]);
  });
});
