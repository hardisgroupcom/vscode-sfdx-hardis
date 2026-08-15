import * as assert from "assert";
import { sortArray } from "../../utils/sortUtils";

suite("sortUtils Test Suite", () => {
  test("sorts by a single key ascending", () => {
    const items = [{ name: "b" }, { name: "a" }, { name: "c" }];
    const sorted = sortArray(items, { by: ["name"], order: ["asc"] });
    assert.deepStrictEqual(
      sorted.map((i) => i.name),
      ["a", "b", "c"],
    );
  });

  test("sorts by a single key descending", () => {
    const items = [{ name: "b" }, { name: "a" }, { name: "c" }];
    const sorted = sortArray(items, { by: ["name"], order: ["desc"] });
    assert.deepStrictEqual(
      sorted.map((i) => i.name),
      ["c", "b", "a"],
    );
  });

  test("sorts by multiple keys with mixed orders", () => {
    const items = [
      { level: 1, name: "b" },
      { level: 2, name: "a" },
      { level: 1, name: "a" },
      { level: 2, name: "b" },
    ];
    const sorted = sortArray(items, {
      by: ["level", "name"],
      order: ["desc", "asc"],
    });
    assert.deepStrictEqual(
      sorted.map((i) => `${i.level}-${i.name}`),
      ["2-a", "2-b", "1-a", "1-b"],
    );
  });

  test("sorts using a computed field when the property is undefined", () => {
    const items = [{ createdAt: undefined }, { createdAt: undefined }];
    (items[0] as any).id = 2;
    (items[1] as any).id = 1;
    const sorted = sortArray(items as any[], {
      by: ["id"],
      order: ["asc"],
      computed: {
        id: (item: any) => item.id,
      },
    });
    assert.deepStrictEqual(
      sorted.map((i: any) => i.id),
      [1, 2],
    );
  });

  test("sorts using a custom order array", () => {
    const items = [{ skill: "power" }, { skill: "accuracy" }, { skill: "speed" }];
    const sorted = sortArray(items, {
      by: ["skill"],
      order: ["skillOrder"],
      customOrders: {
        skillOrder: ["accuracy", "speed", "power"],
      },
    });
    assert.deepStrictEqual(
      sorted.map((i) => i.skill),
      ["accuracy", "speed", "power"],
    );
  });

  test("sorts null and undefined values after defined values by default", () => {
    const items: { value: number | null | undefined }[] = [
      { value: 1 },
      { value: null },
      { value: undefined },
      { value: 2 },
    ];
    const sorted = sortArray(items, { by: ["value"], order: ["asc"] });
    // Defined values come first (ascending); among the non-defined values,
    // undefined sorts before null (matches sort-array's own tie-break rule).
    assert.deepStrictEqual(
      sorted.map((i) => i.value),
      [1, 2, undefined, null],
    );
  });

  test("returns the same array reference (mutates in place)", () => {
    const items = [{ name: "b" }, { name: "a" }];
    const sorted = sortArray(items, { by: ["name"], order: ["asc"] });
    assert.strictEqual(sorted, items);
    assert.deepStrictEqual(
      items.map((i) => i.name),
      ["a", "b"],
    );
  });
});
