import { createSimpleGit } from "./simpleGitInstance";
import { getWorkspaceRoot } from "../utils";
import { Logger } from "../logger";

/**
 * Reads files of a branch that is not checked out, straight from the git objects of the local
 * repository. Nothing here changes the current branch or the working tree, and nothing throws:
 * a ref or a file that is not there reads as absent.
 */

/** Remote-tracking ref of a branch of origin */
export function originRef(branch: string): string {
  return `origin/${branch}`;
}

/**
 * Brings the remote-tracking ref of one branch up to date. Returns false when the branch could
 * not be fetched (no network, no credentials, branch not on origin, or too long): the caller then
 * reads what the last fetch left.
 */
export async function fetchBranch(
  branch: string,
  timeoutMs = 10000,
  root?: string,
): Promise<boolean> {
  try {
    await createSimpleGit(root ?? getWorkspaceRoot(), {
      timeout: { block: timeoutMs },
      // The ref is named in full: a clone limited to one branch would otherwise fetch without
      // writing the remote-tracking ref, and a branch name is never read as an option
    }).raw([
      "fetch",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
    return true;
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] fetch of origin/${branch} not done: ${e?.message || e}`,
    );
    return false;
  }
}

/**
 * Names of the files of a folder at a ref, or null when the ref does not exist in the local
 * repository. An existing ref without that folder gives an empty list.
 */
export async function listFilesAtRef(
  ref: string,
  folder: string,
  root?: string,
): Promise<Set<string> | null> {
  try {
    // One git call for both answers: it fails on a ref that does not exist, and prints nothing
    // for a ref without that folder
    const folderPath = folder.replace(/\/+$/, "") + "/";
    const out = await createSimpleGit(root ?? getWorkspaceRoot()).raw([
      "ls-tree",
      "--name-only",
      ref,
      folderPath,
    ]);
    return new Set(
      out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("/").pop() as string),
    );
  } catch {
    return null;
  }
}

/** Content of a file at a ref, or null when it cannot be read */
export async function readFileAtRef(
  ref: string,
  filePath: string,
  root?: string,
): Promise<string | null> {
  try {
    return await createSimpleGit(root ?? getWorkspaceRoot()).raw([
      "show",
      // Relative to the workspace folder, as the listing is: the project may sit in a
      // subfolder of the repository
      `${ref}:./${filePath}`,
    ]);
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] ${filePath} not read at ${ref}: ${e?.message || e}`,
    );
    return null;
  }
}
