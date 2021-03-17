import * as c from 'chalk';
import * as child from 'child_process';
import * as ora from 'ora';
import * as util from 'util'
const exec = util.promisify(child.exec);

// Execute command
export async function execCommand(
    command: string,
    commandThis: any,
    options: any = {
      fail: false,
      output: false,
      debug: false,
      spinner: true
    }
  ): Promise<any> {
    const commandLog = `[sfdx-hardis][command] ${c.bold(c.grey(command))}`;
    let commandResult = null;
    // Call command (disable color before for json parsing)
    const prevForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '0';
    const spinner = ora({ text: commandLog, spinner: 'moon' }).start();
    if (options.spinner === false) {
      spinner.stop();
    }
    try {
      commandResult = await exec(command, { maxBuffer: 10000 * 10000 });
      spinner.succeed();
    } catch (e) {
      spinner.fail();
      process.env.FORCE_COLOR = prevForceColor;
      // Display error in red if not json
      if (!command.includes('--json') || options.fail) {
        console.error(c.red(`${e.stdout}\n${e.stderr}`));
        throw e;
      }
      // if --json, we should not have a crash, so return status 1 + output log
      return {
        status: 1,
        errorMessage: `[sfdx-hardis][ERROR] Error processing command\n$${e.stdout}\n${e.stderr}`
      };
    }
    // Display output if requested, for better user unrstanding of the logs
    if (options.output || options.debug) {
      console.log(c.italic(c.grey(commandResult.stdout)));
    }
    // Return status 0 if not --json
    process.env.FORCE_COLOR = prevForceColor;
    if (!command.includes('--json')) {
      return {
        status: 0,
        stdout: commandResult.stdout,
        stderr: commandResult.stderr
      };
    }
    // Parse command result if --json
    try {
      const parsedResult = JSON.parse(commandResult.stdout);
      if (options.fail && parsedResult.status && parsedResult.status > 0) {
        throw new Error(
          c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`)
        );
      }
      if (commandResult.stderr && commandResult.stderr.length > 2) {
        console.warn('[sfdx-hardis][WARNING] stderr: ' + c.yellow(commandResult.stderr));
      }
      return parsedResult;
    } catch (e) {
      // Manage case when json is not parseable
      return {
        status: 1,
        errorMessage: c.red(`[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}\n${commandResult.stderr})`)
      };
    }
  }

// Execute salesforce DX command with --json
export async function execSfdxJson(
    command: string,
    commandThis: any,
    options: any = {
      fail: false,
      output: false,
      debug: false
    }
  ): Promise<any> {
    if (!command.includes('--json')) {
      command += ' --json';
    }
    return await execCommand(command, commandThis, options);
  }