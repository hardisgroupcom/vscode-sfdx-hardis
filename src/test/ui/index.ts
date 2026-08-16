import path from "path";
import Mocha from "mocha";
import { glob } from "glob";

/**
 * Mocha entry point for the UI integration suite (runs inside the Extension
 * Development Host, with the dummy SFDX project workspace opened).
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    // Real VS Code + real (mocked) CLI processes: needs way more than the
    // 2s mocha default
    timeout: 120000,
  });

  const testsRoot = __dirname;

  const files = await glob("**/*.test.js", { cwd: testsRoot });
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} UI tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
