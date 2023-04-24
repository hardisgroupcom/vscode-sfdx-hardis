import { parentPort, workerData } from "worker_threads";
import * as childProcess from "child_process";

// Execute CLI command
if (workerData.cliCommand) {
  childProcess.exec(
    workerData.cliCommand.cmd,
    JSON.parse(workerData.cliCommand.execOptions),
    (error, stdout, stderr) => {
      if (error) {
        if (parentPort) {
          parentPort.postMessage({ error: error });
        }
      } else {
        if (parentPort) {
          parentPort.postMessage({ stdout: stdout, stderr: stderr });
        }
      }
    }
  );
}
