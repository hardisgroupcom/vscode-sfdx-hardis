import path from "path";
import { runMochaSuite } from "../mochaRunner";

export async function run(): Promise<void> {
  // The ui/ folder is the separate UI integration suite, run by runUiTest.js
  // with its own workspace/setup
  return runMochaSuite({
    testsRoot: path.resolve(__dirname, ".."),
    pattern: "**/**.test.js",
    ignore: "ui/**",
    // Some unit tests do thousands of small file reads (line counter): the
    // mocha default of 2 s is regularly exceeded on a busy Windows disk
    timeout: 10000,
  });
}
