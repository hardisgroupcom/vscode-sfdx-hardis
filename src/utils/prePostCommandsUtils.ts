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
            cmd.type = cmd.type || 'command';
            cmd.pullRequest = removePrCircularReferences(pr);
            cmd.when = 'pre-deploy';
            commands.push(cmd);
        }
      }
      // Extract commandsPostDeploy
      if (prConfigParsed.commandsPostDeploy && Array.isArray(prConfigParsed.commandsPostDeploy)) {
        const postDeployCommands = prConfigParsed.commandsPostDeploy as PrePostCommand[];
        for (const cmd of postDeployCommands) {
            cmd.type = cmd.type || 'command';
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

function removePrCircularReferences(pr: PullRequest): PullRequest {
  const prCopy = { ...pr };
  prCopy.deploymentActions = []; // avoid circular reference
  prCopy.jobs = [];
  prCopy.relatedTickets = [];
  return prCopy;
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