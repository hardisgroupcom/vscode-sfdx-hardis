import path from "path";
import Mocha from "mocha";
import { glob } from "glob";

/**
 * Shared mocha bootstrap for the unit suite (suite/index.ts) and the UI
 * integration suite (ui/index.ts).
 */
export async function runMochaSuite(options: {
  testsRoot: string;
  pattern: string;
  ignore?: string;
  timeout?: number;
}): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: options.timeout ?? 2000,
  });

  const files = await glob(options.pattern, {
    cwd: options.testsRoot,
    ignore: options.ignore,
  });
  files.forEach((f: string) =>
    mocha.addFile(path.resolve(options.testsRoot, f)),
  );

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
