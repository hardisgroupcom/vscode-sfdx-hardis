import path from "path";
import { runMochaSuite } from "../mochaRunner";

export async function run(): Promise<void> {
  // The ui/ folder is the separate UI integration suite, run by runUiTest.js
  // with its own workspace/setup
  return runMochaSuite({
    testsRoot: path.resolve(__dirname, ".."),
    pattern: "**/**.test.js",
    ignore: "ui/**",
  });
}
