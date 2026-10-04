import { randomUUID } from "node:crypto";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { dumpRepositoryYaml } from "./yamlUtils";
import * as path from "path";
import * as vscode from "vscode";
import { getWorkspaceRoot, listSfdxProjectPackageDirectories } from "../utils";
import { CacheManager } from "./cache-manager";
import { PullRequest } from "./gitProviders/types";
import { GLOB_IGNORE_PATTERNS, normalizeGlobBase } from "./projectUtils";
import {
  fetchBranch,
  listFilesAtRef,
  originRef,
  readFileAtRef,
} from "./gitFileReader";
import { isMergedPullRequest } from "./pipeline/promotionBranchUtils";
import { getCurrentGitBranch } from "./pipeline/sfdxHardisConfig";

/** Action types implemented by sfdx-hardis itself. A project custom function id is also valid. */
export type BuiltInActionType =
  | "command"
  | "data"
  | "apex"
  | "publish-community"
  | "manual"
  | "schedule-batch"
  | "run-batch"
  | "remove-packagexml-items";

export const BUILT_IN_ACTION_TYPES: BuiltInActionType[] = [
  "command",
  "data",
  "apex",
  "publish-community",
  "manual",
  "schedule-batch",
  "run-batch",
  "remove-packagexml-items",
];

export function isBuiltInActionType(type: string): boolean {
  return (BUILT_IN_ACTION_TYPES as string[]).includes(type);
}

export interface PrePostCommand {
  id: string;
  label: string;
  // A built-in type, or the id of a custom function declared in customFunctions.
  // Widened so built-in literals still autocomplete and narrow.
  type: BuiltInActionType | (string & {});
  when: "pre-deploy" | "post-deploy";
  // Known parameters used by action implementations. Additional keys allowed.
  parameters?: {
    apexScript?: string; // for 'apex' actions
    sfdmuProject?: string; // for 'data' actions
    communityName?: string; // for 'publish-community' actions
    instructions?: string; // for 'manual' actions
    className?: string; // for 'schedule-batch' and 'run-batch' actions
    cronExpression?: string; // for 'schedule-batch' actions
    jobName?: string; // optional for 'schedule-batch' actions
    runMode?: "wait" | "no-wait"; // optional for 'run-batch' actions, "wait" when unset
    batchSize?: number; // optional for 'run-batch' actions, 1 to 2000
    waitTimeoutMinutes?: number; // optional for 'run-batch' actions in wait mode
    successEvenIfBatchErrors?: boolean; // optional for 'run-batch' actions in wait mode
    // for 'remove-packagexml-items' actions: entries "TypeName:Member1,Member2"
    // (use "*" as member to remove the whole type). A single string is also accepted.
    packageXmlItems?: string[] | string;
    [key: string]: any;
  };
  command: string;
  context: "all" | "check-deployment-only" | "process-deployment-only";
  // Run the action only when the deployment targets one of these branches.
  // "dev-sandboxes" matches any target without a branch config file.
  // Mutually exclusive with excludeTargetBranches.
  includeTargetBranches?: string[];
  // Run the action on every target branch except these ones.
  excludeTargetBranches?: string[];
  // Deprecated in sfdx-hardis and ignored: post-deployment actions are never run
  // when the metadata deployment failed. Kept so existing YAML values survive a save.
  skipIfError?: boolean;
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  customUsername?: string;
  // Pull Request a failed action was moved from, to fix its definition (set by sfdx-hardis)
  movedFrom?: number;
  // If command comes from a PR, we attach PR info
  pullRequest?: PullRequest;
  result?: ActionResult;
}

export type ActionResult = {
  statusCode: "success" | "failed" | "skipped" | "manual" | "not-run";
  output?: string;
  skippedReason?: string;
};

/** Folder of the actions files, as git names it */
export const PR_ACTIONS_FOLDER = "scripts/actions";

/** Actions file of a Pull Request, -1 being the draft of a branch that has none yet */
export function prActionsFileName(prNumber: number): string {
  return prNumber === -1
    ? ".sfdx-hardis.draft.yml"
    : `.sfdx-hardis.${prNumber}.yml`;
}

/**
 * Deployment actions and test classes of Pull Requests. The file of the checked out branch is
 * used when it is there, and it is the only one that can be edited. When it is missing, the file
 * is read with git, without any checkout, from the branch that holds it: the source branch of a
 * Pull Request not merged yet, the target branch of a merged one.
 * `fetch` brings these branches up to date first: for one Pull Request, never for a list.
 */
export async function completePullRequestsWithActions(
  pullRequests: PullRequest[],
  options: {
    fetch?: boolean;
    // Injectable for unit tests, which cannot rely on a real VS Code workspace
    workspaceRoot?: string;
    currentBranch?: string | null;
  } = {},
): Promise<PullRequest[]> {
  const root = options.workspaceRoot ?? getWorkspaceRoot();
  const elsewhere: { pr: PullRequest; branch: string; merged: boolean }[] = [];
  let currentBranch = options.currentBranch;
  for (const pr of pullRequests) {
    pr.deploymentActionsSource = "workingTree";
    delete pr.deploymentActionsBranch;
    pr.deploymentActions = await listPrePostCommandsForPullRequest(pr, root);
    pr.deploymentApexTestClasses =
      await getDeploymentApexTestClassesForPullRequest(pr, root);
    if (
      !pr.number ||
      pr.number === -1 ||
      fs.existsSync(getPrConfigFilePath(pr.number, root))
    ) {
      continue;
    }
    const merged = isMergedPullRequest(pr);
    const branch = (merged ? pr.targetBranch : pr.sourceBranch) || "";
    if (!branch) {
      continue;
    }
    if (currentBranch === undefined) {
      currentBranch = await getCurrentGitBranch();
    }
    // The checked out branch is the one that would hold the file: there is none yet
    if (branch !== currentBranch) {
      elsewhere.push({ pr, branch, merged });
    }
  }
  if (elsewhere.length === 0) {
    return pullRequests;
  }

  // One listing per branch, a few branches at a time: a window of merged Pull Requests reads its
  // target branch once, whatever their number
  const listings = new Map<string, Set<string> | null>();
  const branches = Array.from(new Set(elsewhere.map((entry) => entry.branch)));
  for (let i = 0; i < branches.length; i += BRANCH_READ_BATCH_SIZE) {
    await Promise.all(
      branches.slice(i, i + BRANCH_READ_BATCH_SIZE).map(async (branch) => {
        if (options.fetch) {
          await fetchBranch(branch, undefined, root);
        }
        listings.set(
          branch,
          await listFilesAtRef(originRef(branch), PR_ACTIONS_FOLDER, root),
        );
      }),
    );
  }

  const readFromBranch = async ({
    pr,
    branch,
    merged,
  }: (typeof elsewhere)[number]) => {
    const files = listings.get(branch);
    const fileName = prActionsFileName(pr.number as number);
    if (!files) {
      // A merged Pull Request whose target is not known here has nothing more to say than
      // before. One still open whose branch is missing (a fork) cannot be read.
      if (!merged) {
        pr.deploymentActionsSource = "unreadable";
      }
      return;
    }
    if (!files.has(fileName)) {
      // Open: its branch has no actions, and is still the place to add some
      if (!merged) {
        pr.deploymentActionsSource = "branch";
        pr.deploymentActionsBranch = branch;
      }
      return;
    }
    const content = await readFileAtRef(
      originRef(branch),
      `${PR_ACTIONS_FOLDER}/${fileName}`,
      root,
    );
    if (content === null) {
      pr.deploymentActionsSource = "unreadable";
      return;
    }
    pr.deploymentActionsSource = "branch";
    pr.deploymentActionsBranch = branch;
    try {
      const parsed = parsePrActionsFile(content, pr);
      pr.deploymentActions = parsed.commands;
      pr.deploymentApexTestClasses = parsed.testClasses;
    } catch (e) {
      console.error(
        `Error while parsing ${fileName} of ${branch}: ${(e as Error).message}`,
      );
    }
  };
  for (let i = 0; i < elsewhere.length; i += BRANCH_READ_BATCH_SIZE) {
    await Promise.all(
      elsewhere.slice(i, i + BRANCH_READ_BATCH_SIZE).map(readFromBranch),
    );
  }
  return pullRequests;
}

export async function listPrePostCommandsForPullRequest(
  pr: PullRequest | undefined,
  // Injectable for unit tests, which cannot rely on a real VS Code workspace
  workspaceRootOverride?: string,
): Promise<PrePostCommand[]> {
  if (!pr || !pr.number) {
    return [];
  }
  // Check if there is a .sfdx-hardis.PULL_REQUEST_ID.yml file in the PR
  const prConfigFileName = getPrConfigFilePath(
    pr.number,
    workspaceRootOverride,
  );
  if (!fs.existsSync(prConfigFileName)) {
    return [];
  }
  try {
    const prConfig = await fs.promises.readFile(prConfigFileName, "utf8");
    return parsePrActionsFile(prConfig, pr).commands;
  } catch (e) {
    console.error(
      `Error while parsing ${prConfigFileName} file: ${(e as Error).message}`,
    );
  }
  return [];
}

const BRANCH_READ_BATCH_SIZE = 8;

/** Actions and test classes declared by the content of an actions file */
function parsePrActionsFile(
  content: string,
  pr: PullRequest,
): { commands: PrePostCommand[]; testClasses: string[] } {
  const commands: PrePostCommand[] = [];
  const prConfigParsed = yaml.load(content) as any;
  if (!prConfigParsed) {
    return { commands, testClasses: [] };
  }
  const lists: [string, "pre-deploy" | "post-deploy"][] = [
    ["commandsPreDeploy", "pre-deploy"],
    ["commandsPostDeploy", "post-deploy"],
  ];
  for (const [key, when] of lists) {
    if (!Array.isArray(prConfigParsed[key])) {
      continue;
    }
    for (const cmd of prConfigParsed[key] as PrePostCommand[]) {
      handleDefaultAttributes(cmd);
      cmd.pullRequest = removePrCircularReferences(pr);
      cmd.when = when;
      commands.push(cmd);
    }
  }
  return {
    commands,
    testClasses: normalizeTestClassNames(
      prConfigParsed.deploymentApexTestClasses,
    ),
  };
}

function normalizeTestClassNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((v: any) => String(v || "").trim())
    .filter((v: string) => v.length > 0);
}

function handleDefaultAttributes(cmd: PrePostCommand): void {
  cmd.type = cmd.type ?? "command";
  cmd.context = cmd.context ?? "process-deployment-only";
  cmd.allowFailure = cmd.allowFailure ?? false;
  // Same default as sfdx-hardis: an action runs only once per target org unless
  // it is explicitly set to false
  cmd.runOnlyOnceByOrg = cmd.runOnlyOnceByOrg ?? true;
  cmd.parameters = cmd.parameters ?? {};
}

function removePrCircularReferences(pr: PullRequest): PullRequest {
  const prCopy = { ...pr };
  prCopy.deploymentActions = []; // avoid circular reference
  prCopy.jobs = [];
  prCopy.relatedTickets = [];
  return prCopy;
}

// Helper function to get PR config file path
function getPrConfigFilePath(
  prNumber: number,
  // Injectable for unit tests, which cannot rely on a real VS Code workspace
  workspaceRootOverride?: string,
): string {
  const workspaceRoot = workspaceRootOverride ?? getWorkspaceRoot();
  return path.join(
    workspaceRoot,
    "scripts",
    "actions",
    prActionsFileName(prNumber),
  );
}

// Helper function to load PR config file
async function loadPrConfig(prConfigFileName: string): Promise<any> {
  if (!fs.existsSync(prConfigFileName)) {
    return {};
  }
  const prConfig = await fs.promises.readFile(prConfigFileName, "utf8");
  const prConfigParsed = yaml.load(prConfig) as any;
  return prConfigParsed || {};
}

// Helper function to save PR config file
async function savePrConfig(
  prConfigFileName: string,
  prConfigParsed: any,
): Promise<void> {
  const yamlContent = dumpRepositoryYaml(prConfigParsed);
  await fs.promises.mkdir(path.dirname(prConfigFileName), { recursive: true });
  await fs.promises.writeFile(prConfigFileName, yamlContent, "utf8");
}

// Helper function to get target array name from when value
function getTargetArrayName(when: "pre-deploy" | "post-deploy"): string {
  return when === "pre-deploy" ? "commandsPreDeploy" : "commandsPostDeploy";
}

// Helper function to ensure target array exists in config
function ensureTargetArray(prConfigParsed: any, targetArrayName: string): void {
  if (
    !prConfigParsed[targetArrayName] ||
    !Array.isArray(prConfigParsed[targetArrayName])
  ) {
    prConfigParsed[targetArrayName] = [];
  }
}

// Helper function to validate config and target array
function validateConfigAndArray(
  prConfigParsed: any,
  targetArrayName: string,
): boolean {
  if (!prConfigParsed || Object.keys(prConfigParsed).length === 0) {
    return false;
  }
  if (
    !prConfigParsed[targetArrayName] ||
    !Array.isArray(prConfigParsed[targetArrayName])
  ) {
    return false;
  }
  return true;
}

// Locates the entry matching `command` inside `array`. Prefers matching by id
// (the id it currently carries, then the id it had before the edit, in case a
// fresh one was just generated), and falls back to a content match. The content
// match is based on `original` (the action as it was BEFORE the current edit)
// when available, so that renaming an action or changing its command still
// matches the pre-existing entry instead of appearing as a new one.
function findPrePostCommandIndex(
  array: PrePostCommand[],
  command: PrePostCommand,
  original?: Partial<PrePostCommand> | null,
): number {
  let index = array.findIndex((cmd) => !!cmd.id && cmd.id === command.id);
  if (index >= 0) {
    return index;
  }
  if (original?.id) {
    index = array.findIndex((cmd) => cmd.id === original.id);
    if (index >= 0) {
      return index;
    }
  }
  // Actions written by hand in the YAML file have no id: match them on the
  // content they had BEFORE this edit, so that editing one (including renaming
  // it or changing its command) updates it rather than duplicating it
  const contentReference = original ?? command;
  return array.findIndex(
    (cmd) =>
      !cmd.id &&
      cmd.label === contentReference.label &&
      (cmd.type ?? "command") === (contentReference.type ?? "command") &&
      cmd.command === contentReference.command,
  );
}

export async function savePrePostCommand(
  prNumber: number,
  command: PrePostCommand,
  originalCommand?: Partial<PrePostCommand> | null,
  // Injectable for unit tests, which cannot rely on a real VS Code workspace
  workspaceRootOverride?: string,
): Promise<string> {
  const prConfigFileName = getPrConfigFilePath(prNumber, workspaceRootOverride);
  const prConfigParsed = await loadPrConfig(prConfigFileName);

  const targetArrayName = getTargetArrayName(command.when);
  ensureTargetArray(prConfigParsed, targetArrayName);

  // The action may have been moved between pre-deploy and post-deploy (the
  // "when" field changed): look it up in the array it used to live in too, so it
  // can be removed from there instead of ending up in both lists.
  const originalWhen = originalCommand?.when;
  const sourceArrayName = originalWhen
    ? getTargetArrayName(originalWhen)
    : null;
  if (sourceArrayName && sourceArrayName !== targetArrayName) {
    ensureTargetArray(prConfigParsed, sourceArrayName);
    const sourceIndex = findPrePostCommandIndex(
      prConfigParsed[sourceArrayName],
      command,
      originalCommand,
    );
    if (sourceIndex >= 0) {
      prConfigParsed[sourceArrayName].splice(sourceIndex, 1);
    }
  }

  const existingIndex = findPrePostCommandIndex(
    prConfigParsed[targetArrayName],
    command,
    originalCommand,
  );
  if (existingIndex >= 0) {
    prConfigParsed[targetArrayName][existingIndex] =
      normalizePrePostCommandToSave(command);
  } else {
    // If Id not set, generate a new one with uuid
    if (!command.id || command.id.trim() === "") {
      command.id = randomUUID();
    }
    prConfigParsed[targetArrayName].push(
      normalizePrePostCommandToSave(command),
    );
  }

  await savePrConfig(prConfigFileName, prConfigParsed);
  return prConfigFileName;
}

export async function getDeploymentApexTestClassesForPullRequest(
  pr: PullRequest | undefined,
  // Injectable for unit tests, which cannot rely on a real VS Code workspace
  workspaceRootOverride?: string,
): Promise<string[]> {
  if (!pr || !pr.number) {
    return [];
  }

  const prConfigFileName = getPrConfigFilePath(
    pr.number,
    workspaceRootOverride,
  );
  const prConfigParsed = await loadPrConfig(prConfigFileName);
  return normalizeTestClassNames(prConfigParsed?.deploymentApexTestClasses);
}

export async function saveDeploymentApexTestClasses(
  prNumber: number,
  deploymentApexTestClasses: string[],
): Promise<string> {
  const prConfigFileName = getPrConfigFilePath(prNumber);
  const prConfigParsed = await loadPrConfig(prConfigFileName);

  const normalized = (
    Array.isArray(deploymentApexTestClasses) ? deploymentApexTestClasses : []
  )
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0);

  // de-duplicate while preserving order
  const unique: string[] = [];
  for (const v of normalized) {
    if (!unique.includes(v)) {
      unique.push(v);
    }
  }

  if (unique.length > 0) {
    prConfigParsed.deploymentApexTestClasses = unique;
  } else {
    delete prConfigParsed.deploymentApexTestClasses;
  }

  await savePrConfig(prConfigFileName, prConfigParsed);
  return prConfigFileName;
}

const APEX_TEST_CLASSES_CACHE_KEY = "projectApexTestClasses";
const APEX_TEST_CLASSES_CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes
// Read files in parallel batches: scanning thousands of .cls files one-at-a-time
// (sequential await) took ~minutes cold on large repos.
const APEX_TEST_READ_BATCH_SIZE = 60;

// Names of the Apex classes of the project whose source matches, sorted
async function listProjectApexClassNames(
  matches: (content: string) => boolean,
): Promise<string[]> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    return [];
  }

  const packageDirs = await listSfdxProjectPackageDirectories();
  const pkgDirs =
    Array.isArray(packageDirs) && packageDirs.length > 0 ? packageDirs : ["."];

  const patterns = pkgDirs.map((pkgDir) => {
    const normalized = normalizeGlobBase(String(pkgDir || "."));
    return normalized ? `${normalized}/**/classes/*.cls` : `**/classes/*.cls`;
  });
  const combinedPattern =
    patterns.length > 1 ? `{${patterns.join(",")}}` : patterns[0];

  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceRoot, combinedPattern),
    GLOB_IGNORE_PATTERNS,
  );
  const files = Array.from(new Set(uris.map((uri) => uri.fsPath)));

  const found: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < files.length; i += APEX_TEST_READ_BATCH_SIZE) {
    const batch = files.slice(i, i + APEX_TEST_READ_BATCH_SIZE);
    const batchClassNames = await Promise.all(
      batch.map(async (absFile) => {
        try {
          const content = await fs.promises.readFile(absFile, "utf8");
          if (!matches(content || "")) {
            return null;
          }
          return path.basename(absFile, ".cls").trim() || null;
        } catch {
          // ignore file read errors
          return null;
        }
      }),
    );
    for (const className of batchClassNames) {
      if (!className) {
        continue;
      }
      const key = className.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        found.push(className);
      }
    }
  }

  found.sort((a, b) => a.localeCompare(b));
  return found;
}

export async function listProjectApexTestClasses(): Promise<string[]> {
  const cached = CacheManager.get<string[]>(
    "project",
    APEX_TEST_CLASSES_CACHE_KEY,
  );
  if (cached) {
    return cached;
  }
  if (!getWorkspaceRoot()) {
    return [];
  }

  const isTestRegex = /@istest\b/i;
  const found = await listProjectApexClassNames((content) =>
    isTestRegex.test(content),
  );
  await CacheManager.set(
    "project",
    APEX_TEST_CLASSES_CACHE_KEY,
    found,
    APEX_TEST_CLASSES_CACHE_TTL_MS,
  );
  return found;
}

// Not cached: a class added to the project a minute ago must be listed.
// Same loose test as the list read from the org, so that both sources agree.
export async function listProjectSchedulableClasses(): Promise<string[]> {
  return listProjectApexClassNames((content) =>
    content.toLowerCase().includes("schedulable"),
  );
}

// A class that can be run by a 'run-batch' action. Same loose test as the list
// read from the org, so that both sources agree.
export const BATCHABLE_APEX_CLASS_REGEX = /database\s*\.\s*batchable/i;

// Not cached, for the same reason as the schedulable classes
export async function listProjectBatchableClasses(): Promise<string[]> {
  return listProjectApexClassNames((content) =>
    BATCHABLE_APEX_CLASS_REGEX.test(content),
  );
}

/* jscpd:ignore-start */
export async function movePrePostCommandUpDown(
  prNumber: number,
  commandId: string,
  when: "pre-deploy" | "post-deploy",
  direction: "up" | "down",
): Promise<string | null> {
  const prConfigFileName = getPrConfigFilePath(prNumber);
  const prConfigParsed = await loadPrConfig(prConfigFileName);
  const targetArrayName = getTargetArrayName(when);

  if (!validateConfigAndArray(prConfigParsed, targetArrayName)) {
    return null;
  }

  // Find command
  const existingIndex = prConfigParsed[targetArrayName].findIndex(
    (cmd: PrePostCommand) => cmd.id === commandId,
  );
  if (existingIndex >= 0) {
    const newIndex = direction === "up" ? existingIndex - 1 : existingIndex + 1;
    if (newIndex < 0 || newIndex >= prConfigParsed[targetArrayName].length) {
      return null; // out of bounds
    }
    // Swap commands
    const temp = prConfigParsed[targetArrayName][newIndex];
    prConfigParsed[targetArrayName][newIndex] =
      prConfigParsed[targetArrayName][existingIndex];
    prConfigParsed[targetArrayName][existingIndex] = temp;

    await savePrConfig(prConfigFileName, prConfigParsed);
    return prConfigFileName;
  }
  return null;
}
/* jscpd:ignore-end */

export async function deletePrePostCommand(
  prNumber: number,
  commandId: string,
  when: "pre-deploy" | "post-deploy",
): Promise<string | null> {
  const prConfigFileName = getPrConfigFilePath(prNumber);
  const prConfigParsed = await loadPrConfig(prConfigFileName);
  const targetArrayName = getTargetArrayName(when);

  if (!validateConfigAndArray(prConfigParsed, targetArrayName)) {
    return null;
  }

  // Find and remove command
  const existingIndex = prConfigParsed[targetArrayName].findIndex(
    (cmd: PrePostCommand) => cmd.id === commandId,
  );
  if (existingIndex >= 0) {
    prConfigParsed[targetArrayName].splice(existingIndex, 1);
    await savePrConfig(prConfigFileName, prConfigParsed);
  }
  return prConfigFileName;
}

function normalizePrePostCommandToSave(
  command: PrePostCommand,
): PrePostCommand {
  const commandToSave: any = { ...command };
  // Remove pullRequest and result before saving
  delete commandToSave.pullRequest;
  delete commandToSave.result;
  delete commandToSave.when;
  return commandToSave;
}

export async function listProjectApexScripts(): Promise<
  { label: string; value: string }[]
> {
  const workspaceRoot = getWorkspaceRoot();
  const apexScriptsDir = path.join(workspaceRoot, "scripts", "apex");
  const options: { label: string; value: string }[] = [];
  if (fs.existsSync(apexScriptsDir)) {
    const files = await fs.promises.readdir(apexScriptsDir);
    for (const file of files) {
      if (file.endsWith(".apex")) {
        options.push({
          label: file,
          value: path.join("scripts", "apex", file).replace(/\\/g, "/"),
        });
      }
    }
  }
  return options;
}

export async function listProjectDataWorkspaces(): Promise<
  { label: string; value: string }[]
> {
  const workspaceRoot = getWorkspaceRoot();
  const sfdmuProjectsDir = path.join(workspaceRoot, "scripts", "data");
  const options: { label: string; value: string }[] = [];
  // List all folders in data that contain an export.json
  if (fs.existsSync(sfdmuProjectsDir)) {
    const items = await fs.promises.readdir(sfdmuProjectsDir);
    for (const item of items) {
      const itemPath = path.join(sfdmuProjectsDir, item);
      const exportJsonPath = path.join(itemPath, "export.json");
      if (
        (await fs.promises.stat(itemPath)).isDirectory() &&
        fs.existsSync(exportJsonPath)
      ) {
        let hardisLabel = "";
        try {
          const jsonContent = await fs.promises.readFile(
            exportJsonPath,
            "utf8",
          );
          const parsed = JSON.parse(jsonContent);
          hardisLabel = parsed.sfdxHardisLabel || "";
        } catch {
          // Ignore JSON parse errors
        }
        // A label equal to the folder name is still a label: comparing the two made
        // a workspace named after its own folder read as having none
        options.push({
          label: `${item} - ${hardisLabel || "Label not defined in export.json"}`,
          value: item.replace(/\\/g, "/"),
        });
      }
    }
  }
  return options;
}
