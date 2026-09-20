import * as vscode from "vscode";
import { execSfdxJson } from "../utils";
import { Logger } from "../logger";
import { t } from "../i18n/i18n";

/**
 * Custom functions are project scripts (node, python or bash) usable as deployment action
 * types. They are declared in the `customFunctions` property of config/.sfdx-hardis.yml.
 *
 * The CLI is the engine here: this module never writes the YAML itself, it drives
 * `sf hardis:project:function:*` and reads their --json output. Everything the panel offers
 * exists as a CLI flag.
 */

export const CUSTOM_FUNCTION_RUNTIMES = ["node", "python", "bash"] as const;

export const CUSTOM_FUNCTION_INPUT_TYPES = [
  "string",
  "number",
  "boolean",
  "select",
  "multiline",
  "secret",
] as const;

export interface CustomFunctionInput {
  name: string;
  label?: string;
  description?: string;
  type?: string;
  required?: boolean;
  default?: any;
  options?: string[];
}

export interface CustomFunctionOutput {
  name: string;
  label?: string;
  description?: string;
  type?: string;
}

export interface CustomFunctionDefinition {
  id: string;
  label?: string;
  description?: string;
  runtime: string;
  script: string;
  timeout?: number;
  when?: "pre-deploy" | "post-deploy";
  allowedContexts?: string[];
  defaults?: {
    context?: string;
    allowFailure?: boolean;
    runOnlyOnceByOrg?: boolean;
    includeTargetBranches?: string[];
    excludeTargetBranches?: string[];
  };
  inputs?: CustomFunctionInput[];
  outputs?: CustomFunctionOutput[];
  // Only present when the list was requested with runtime checking
  runtimeAvailable?: boolean;
}

/**
 * List the custom functions of the project.
 * Never throws: an older sfdx-hardis without the command, or a project with no function at
 * all, both yield an empty catalog so the deployment action editor keeps working.
 */
export async function listCustomFunctions(
  options: { checkRuntimes?: boolean } = {},
): Promise<CustomFunctionDefinition[]> {
  const command =
    "sf hardis:project:function:list --json" +
    (options.checkRuntimes ? " --check-runtimes" : "");
  try {
    const result = await execSfdxJson(command, {
      fail: false,
      output: false,
    });
    const customFunctions = result?.result?.customFunctions;
    return Array.isArray(customFunctions) ? customFunctions : [];
  } catch (error: any) {
    Logger.log(`Unable to list custom functions: ${error.message}`);
    return [];
  }
}

/**
 * Build the flags of hardis:project:function:create / update from a definition edited in the
 * panel. The inputs and outputs contracts are sent with the compact syntax the CLI parses, so
 * a whole function is described by a single command.
 */
export function buildFunctionCommandFlags(
  definition: CustomFunctionDefinition,
  mode: "create" | "update",
): string {
  const flags: string[] = [`--id ${quote(definition.id)}`];
  if (definition.label) {
    flags.push(`--label ${quote(definition.label)}`);
  }
  if (definition.description !== undefined) {
    flags.push(`--description ${quote(definition.description)}`);
  }
  if (definition.runtime) {
    flags.push(`--runtime ${definition.runtime}`);
  }
  if (definition.script) {
    flags.push(`--script ${quote(definition.script)}`);
  }
  if (definition.timeout) {
    flags.push(`--timeout ${definition.timeout}`);
  }
  if (definition.when) {
    flags.push(`--when ${definition.when}`);
  } else if (mode === "update") {
    // "any" is how the CLI removes a phase restriction: an empty --when cannot be told
    // apart from the flag not being passed at all.
    flags.push("--when any");
  }
  if (definition.allowedContexts !== undefined) {
    flags.push(
      `--allowed-contexts ${quote(definition.allowedContexts.join(","))}`,
    );
  }
  flags.push(`--inputs ${quote(serializeInputs(definition.inputs || []))}`);
  flags.push(`--outputs ${quote(serializeOutputs(definition.outputs || []))}`);
  return flags.join(" ");
}

/** "name[:type][:required][|opt1,opt2][=default]" entries separated by ";" */
export function serializeInputs(inputs: CustomFunctionInput[]): string {
  return inputs
    .filter((input) => input && input.name)
    .map((input) => {
      let entry = input.name;
      if (input.type) {
        entry += `:${input.type}`;
      }
      if (input.required === true) {
        entry += ":required";
      }
      if (input.type === "select" && (input.options || []).length > 0) {
        entry += `|${(input.options || []).join(",")}`;
      }
      if (
        input.default !== undefined &&
        input.default !== null &&
        String(input.default) !== ""
      ) {
        entry += `=${input.default}`;
      }
      return entry;
    })
    .join(";");
}

/** "name[:type]" entries separated by ";" */
export function serializeOutputs(outputs: CustomFunctionOutput[]): string {
  return outputs
    .filter((output) => output && output.name)
    .map((output) =>
      output.type ? `${output.name}:${output.type}` : output.name,
    )
    .join(";");
}

/**
 * Quote a flag value for the shell the CLI is launched with.
 * Values come from a panel the user typed in, so a label with a space or a quote must not
 * break the command line.
 */
export function quote(value: string): string {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Run a function command and surface its outcome. Returns true when it succeeded. */
export async function runFunctionCommand(
  command: string,
  successMessage: string,
): Promise<boolean> {
  try {
    const result = await execSfdxJson(command, { fail: false, output: true });
    if (result?.status === 0) {
      vscode.window.showInformationMessage(successMessage);
      return true;
    }
    const message = result?.message || result?.errorMessage || "";
    vscode.window.showErrorMessage(
      t("customFunctionCommandFailed", { message: message }),
    );
    return false;
  } catch (error: any) {
    Logger.log(`Custom function command failed: ${error.message}`);
    vscode.window.showErrorMessage(
      t("customFunctionCommandFailed", { message: error.message }),
    );
    return false;
  }
}
