import { parentPort } from "worker_threads";
import * as childProcess from "child_process";



// Execute a command concurrently

function execCliCommand(cmd: string, execOptions: any, requestId: string) {
  childProcess.exec(cmd, execOptions, (error, stdout, stderr) => {
    if (parentPort) {
      if (error) {
        parentPort.postMessage({ error: error, requestId });
      } else {
        parentPort.postMessage({ stdout: stdout, stderr: stderr, requestId });
      }
    }
  });
}

if (parentPort) {
  parentPort.on("message", (msg) => {
    if (msg && msg.cliCommand) {
      execCliCommand(
        msg.cliCommand.cmd,
        JSON.parse(msg.cliCommand.execOptions),
        msg.requestId
      );
    }
  });
}
