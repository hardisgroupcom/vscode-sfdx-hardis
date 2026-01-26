import * as path from "path";
import * as fs from "fs-extra";

function getGitDirPath(workspaceRoot: string): string | null {
  const dotGitPath = path.join(workspaceRoot, ".git");
  if (!fs.existsSync(dotGitPath)) {
    return null;
  }
  try {
    const stats = fs.lstatSync(dotGitPath);
    if (stats.isDirectory()) {
      return dotGitPath;
    }
    if (stats.isFile()) {
      const content = fs.readFileSync(dotGitPath, "utf8");
      const match = content.match(/^gitdir:\s*(.+)\s*$/im);
      if (!match || !match[1]) {
        return null;
      }
      const rawGitDir = match[1].trim();
      const resolvedGitDir = path.isAbsolute(rawGitDir)
        ? rawGitDir
        : path.resolve(workspaceRoot, rawGitDir);
      if (fs.existsSync(resolvedGitDir)) {
        return resolvedGitDir;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

function getGitInfoAttributesPath(workspaceRoot: string): string | null {
  const gitDir = getGitDirPath(workspaceRoot);
  if (!gitDir) {
    return null;
  }
  return path.join(gitDir, "info", "attributes");
}

export async function isMergeDriverEnabled(
  workspaceRoot: string,
): Promise<boolean | null> {
  const attributesPath = getGitInfoAttributesPath(workspaceRoot);
  if (!attributesPath) {
    return null;
  }
  if (!fs.existsSync(attributesPath)) {
    return false;
  }
  try {
    const content = await fs.readFile(attributesPath, "utf8");
    const lines = content.split(/\r?\n/g);
    for (const line of lines) {
      const trimmedLeft = line.replace(/^\s+/, "");
      if (!trimmedLeft || trimmedLeft.startsWith("#")) {
        continue;
      }
      if (/merge=salesforce-source/i.test(trimmedLeft)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
