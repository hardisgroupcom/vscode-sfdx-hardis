import * as assert from "assert";
import { bold, grey, red, yellow } from "../../utils/ansiColors";

const ESC = String.fromCharCode(27);

suite("ansiColors Test Suite", () => {
  test("wraps text with the red ANSI escape codes", () => {
    assert.strictEqual(red("hello"), `${ESC}[31mhello${ESC}[39m`);
  });

  test("wraps text with the yellow ANSI escape codes", () => {
    assert.strictEqual(yellow("hello"), `${ESC}[33mhello${ESC}[39m`);
  });

  test("wraps text with the grey ANSI escape codes", () => {
    assert.strictEqual(grey("hello"), `${ESC}[90mhello${ESC}[39m`);
  });

  test("wraps text with the bold ANSI escape codes", () => {
    assert.strictEqual(bold("hello"), `${ESC}[1mhello${ESC}[22m`);
  });
});
