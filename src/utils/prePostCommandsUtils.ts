import * as fs from "fs-extra";
import * as yaml from "js-yaml";
import * as path from "path";
import { getWorkspaceRoot } from "../utils";
import { PullRequest } from "./gitProviders/types";

export interface PrePostCommand {
  id: string;
  label: string;
  type: 'command' | 'data' | 'apex' | 'publish-community' | 'manual';
  when: 'pre-deploy' | 'post-deploy';
  // Known parameters used by action implementations. Additional keys allowed.
  parameters?: {
    apexScript?: string;     // for 'apex' actions
    sfdmuProject?: string;   // for 'data' actions
    communityName?: string;  // for 'publish-community' actions
    instructions?: string;   // for 'manual' actions
    [key: string]: any;
  };
  command: string;
  context: 'all' | 'check-deployment-only' | 'process-deployment-only';
  skipIfError?: boolean;
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  customUsername?: string;
  // If command comes from a PR, we attach PR info
  pullRequest?: PullRequest;
  result?: ActionResult;
}

export type ActionResult = {
  statusCode: 'success' | 'failed' | 'skipped' | "manual";
  output?: string;
  skippedReason?: string;
};

export async function listPrePostCommandsForPullRequest(pr: PullRequest | undefined): Promise<PrePostCommand[]> {
  const commands: PrePostCommand[] = [];
    if (!pr || !pr.number) {
    return commands;
  }
  // Check if there is a .sfdx-hardis.PULL_REQUEST_ID.yml file in the PR
  const workspaceRoot = getWorkspaceRoot();
  const prConfigFileName = path.join(workspaceRoot, "scripts", "actions", `.sfdx-hardis.${pr.number}.yml`);
    if (!fs.existsSync(prConfigFileName)) {
    return commands;
  }
  try {
    const prConfig = await fs.readFile(prConfigFileName, 'utf8');
    const prConfigParsed = yaml.load(prConfig) as any;
    if (prConfigParsed) {
      // Extract commandsPreDeploy
      if (prConfigParsed.commandsPreDeploy && Array.isArray(prConfigParsed.commandsPreDeploy)) {
        const preDeployCommands = prConfigParsed.commandsPreDeploy as PrePostCommand[];
        for (const cmd of preDeployCommands) {
            handleDefaultAttributes(cmd);
            cmd.pullRequest = removePrCircularReferences(pr);
            cmd.when = 'pre-deploy';
            commands.push(cmd);
        }
      }
      // Extract commandsPostDeploy
      if (prConfigParsed.commandsPostDeploy && Array.isArray(prConfigParsed.commandsPostDeploy)) {
        const postDeployCommands = prConfigParsed.commandsPostDeploy as PrePostCommand[];
        for (const cmd of postDeployCommands) {
            handleDefaultAttributes(cmd);
            cmd.pullRequest = removePrCircularReferences(pr);
            cmd.when = 'post-deploy';
            commands.push(cmd);
        }
      }
    }
  } 
  catch (e) {
    console.error(`Error while parsing ${prConfigFileName} file: ${(e as Error).message}`);
  }

  return commands;
}

function handleDefaultAttributes(cmd: PrePostCommand): void {
    cmd.type = cmd.type ?? 'command';
    cmd.context = cmd.context ?? "process-deployment-only";
    cmd.skipIfError = cmd.skipIfError ?? true;
    cmd.allowFailure = cmd.allowFailure ?? false;
    cmd.runOnlyOnceByOrg = cmd.runOnlyOnceByOrg ?? false;
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
function getPrConfigFilePath(prNumber: number): string {
  const workspaceRoot = getWorkspaceRoot();
  return path.join(workspaceRoot, "scripts", "actions", `.sfdx-hardis.${prNumber}.yml`);
}

// Helper function to load PR config file
async function loadPrConfig(prConfigFileName: string): Promise<any> {
  if (!fs.existsSync(prConfigFileName)) {
    return {};
  }
  const prConfig = await fs.readFile(prConfigFileName, 'utf8');
  const prConfigParsed = yaml.load(prConfig) as any;
  return prConfigParsed || {};
}

// Helper function to save PR config file
async function savePrConfig(prConfigFileName: string, prConfigParsed: any): Promise<void> {
  const yamlContent = yaml.dump(prConfigParsed);
  await fs.writeFile(prConfigFileName, yamlContent, 'utf8');
}

// Helper function to get target array name from when value
function getTargetArrayName(when: 'pre-deploy' | 'post-deploy'): string {
  return when === 'pre-deploy' ? 'commandsPreDeploy' : 'commandsPostDeploy';
}

// Helper function to ensure target array exists in config
function ensureTargetArray(prConfigParsed: any, targetArrayName: string): void {
  if (!prConfigParsed[targetArrayName] || !Array.isArray(prConfigParsed[targetArrayName])) {
    prConfigParsed[targetArrayName] = [];
  }
}

export async function savePrePostCommand(prNumber: number, command: PrePostCommand): Promise<string> {
  const prConfigFileName = getPrConfigFilePath(prNumber);
  const prConfigParsed = await loadPrConfig(prConfigFileName);
  
  const targetArrayName = getTargetArrayName(command.when);
  ensureTargetArray(prConfigParsed, targetArrayName);
  
  // Check if command with same id exists, replace it
  const existingIndex = prConfigParsed[targetArrayName].findIndex((cmd: PrePostCommand) => cmd.id === command.id);
  if (existingIndex >= 0) {
    prConfigParsed[targetArrayName][existingIndex] = normalizePrePostCommandToSave(command);
  } 
  else {
    // If Id not set, generate a new one with uuid
    if (!command.id || command.id.trim() === '') {
      const { v4: uuidv4 } = await import('uuid');
      command.id = uuidv4();
    }
    prConfigParsed[targetArrayName].push(normalizePrePostCommandToSave(command));
  }
  
  await savePrConfig(prConfigFileName, prConfigParsed);
  return prConfigFileName;
}

export async function movePrePostCommandUpDown(prNumber: number, commandId: string, when: 'pre-deploy' | 'post-deploy', direction: 'up' | 'down'): Promise<string | null> {
  const prConfigFileName = getPrConfigFilePath(prNumber);
  const prConfigParsed = await loadPrConfig(prConfigFileName);
  
  if (!prConfigParsed || Object.keys(prConfigParsed).length === 0) {
    return null;
  }
  
  const targetArrayName = getTargetArrayName(when);
  if (!prConfigParsed[targetArrayName] || !Array.isArray(prConfigParsed[targetArrayName])) {
    return null;
  }
  
  // Find command
  const existingIndex = prConfigParsed[targetArrayName].findIndex((cmd: PrePostCommand) => cmd.id === commandId);
  if (existingIndex >= 0) {
    const newIndex = direction === 'up' ? existingIndex - 1 : existingIndex + 1;
    if (newIndex < 0 || newIndex >= prConfigParsed[targetArrayName].length) {
      return null; // out of bounds
    }
    // Swap commands
    const temp = prConfigParsed[targetArrayName][newIndex];
    prConfigParsed[targetArrayName][newIndex] = prConfigParsed[targetArrayName][existingIndex];
    prConfigParsed[targetArrayName][existingIndex] = temp;
    
    await savePrConfig(prConfigFileName, prConfigParsed);
    return prConfigFileName;
  }
  return null;
}

export async function deletePrePostCommand(prNumber: number, commandId: string, when: 'pre-deploy' | 'post-deploy'): Promise<string|null> {
  const prConfigFileName = getPrConfigFilePath(prNumber);
  const prConfigParsed = await loadPrConfig(prConfigFileName);
  
  if (!prConfigParsed || Object.keys(prConfigParsed).length === 0) {
    return null;
  }
  
  const targetArrayName = getTargetArrayName(when);
  if (!prConfigParsed[targetArrayName] || !Array.isArray(prConfigParsed[targetArrayName])) {
    return null;
  }
  
  // Find and remove command
  const existingIndex = prConfigParsed[targetArrayName].findIndex((cmd: PrePostCommand) => cmd.id === commandId);
  if (existingIndex >= 0) {
    prConfigParsed[targetArrayName].splice(existingIndex, 1);
    await savePrConfig(prConfigFileName, prConfigParsed);
  }
  return prConfigFileName;
}

function normalizePrePostCommandToSave(command: PrePostCommand): PrePostCommand {
    const commandToSave: any = { ...command };
    // Remove pullRequest and result before saving
    delete commandToSave.pullRequest;
    delete commandToSave.result;
    delete commandToSave.when;
    return commandToSave;
}

export async function listProjectApexScripts(): Promise<{ label: string; value: string }[]> {
  const workspaceRoot = getWorkspaceRoot();
  const apexScriptsDir = path.join(workspaceRoot, 'scripts', 'apex');
  const options: { label: string; value: string }[] = [];
    if (fs.existsSync(apexScriptsDir)) {
        const files = await fs.readdir(apexScriptsDir);
        for (const file of files) {
        if (file.endsWith('.apex')) {
            options.push({
                label: file,
                value: path.join('scripts', 'apex', file).replace(/\\/g, '/'),
            });
        }
        }
    }
    return options;
}

export async function listProjectDataWorkspaces(): Promise<{ label: string; value: string }[]> {
    const workspaceRoot = getWorkspaceRoot();
    const sfdmuProjectsDir = path.join(workspaceRoot,'scripts','data');
    const options: { label: string; value: string }[] = [];
    // List all folders in data that contain an export.json
    if (fs.existsSync(sfdmuProjectsDir)) {
        const items = await fs.readdir(sfdmuProjectsDir);
        for (const item of items) {
            const itemPath = path.join(sfdmuProjectsDir, item);
            const exportJsonPath = path.join(itemPath, 'export.json');
            if ((await fs.stat(itemPath)).isDirectory() && fs.existsSync(exportJsonPath)) {
                let hardisLabel = '';
                try {
                    const jsonContent = await fs.readFile(exportJsonPath, 'utf8');
                    const parsed = JSON.parse(jsonContent);
                    hardisLabel = parsed.sfdxHardisLabel || item;
                } catch {
                    // Ignore JSON parse errors
                }
                options.push({
                    label: `${item} - ${item !== hardisLabel ? `: ${hardisLabel}` : 'Label not defined in export.json'}`,
                    value: item.replace(/\\/g, '/'),
                });
            }
        }
    }
    return options;
}