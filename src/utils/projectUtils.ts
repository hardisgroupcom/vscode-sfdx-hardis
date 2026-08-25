import * as vscode from "vscode";
import { getWorkspaceRoot, listSfdxProjectPackageDirectories } from "../utils";
import { getMetadataTypes } from "./metadataTypes";
import { t } from "../i18n/i18n";

// Folders that never hold Salesforce sources of the project and must be kept
// out of a walk starting at the repository root. Passing no exclude at all to
// vscode.workspace.findFiles() is not enough: `null` disables even the default
// excludes, so node_modules gets walked.
//
// .claude and .cursor are in the list for correctness, not only for speed: the
// instructions and skills they hold can carry example metadata (Apex classes,
// objects...), which must never be taken for sources of the project.
export const GLOB_IGNORE_PATTERNS =
  "**/{node_modules,.git,.github,.claude,.cursor,.sf,.sfdx,.vscode,dist,out,coverage,tmp,temp,logs,hardis-report,mkdocs}/**";

// Same purpose, for a walk already scoped to a package directory. The folders
// above live at the repository root, never inside force-app, and every ignore
// pattern is tested against every walked path, so listing them there only costs
// time. Only node_modules is kept, for the projects holding a JS bundle inside
// a package directory.
export const PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS = "**/node_modules/**";

// VS Code's glob matcher (used by vscode.workspace.findFiles / RelativePattern) does not
// normalize a leading "./" the way fast-glob used to, so a pattern like "./force-app/**/*.cls"
// never matches. Normalize package directory segments before building glob patterns from them.
export function normalizeGlobBase(p: string): string {
  let normalized = (p || "").replace(/\\/g, "/").trim();
  if (normalized === "." || normalized === "./") {
    return "";
  }
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}

export async function openMetadataFile(
  metadataType: string,
  metadataName: string,
): Promise<void> {
  try {
    if (!metadataType || !metadataName) {
      vscode.window.showErrorMessage(t("missingMetadataTypeOrName"));
      return;
    }
    const filePath = await getMetadataFilePath(metadataType, metadataName);
    if (!filePath) {
      vscode.window.showInformationMessage(
        `No local file found for ${metadataType}: ${metadataName}`,
      );
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to open metadata file: ${err?.message || err}`,
      );
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Error locating metadata file: ${err?.message || err}`,
    );
  }
}

export async function getMetadataFilePath(
  metadataType: string,
  metadataName: string,
): Promise<string | null> {
  try {
    const workspaceRoot = getWorkspaceRoot();
    const packageDirs = await listSfdxProjectPackageDirectories();
    const pkgDirs = packageDirs && packageDirs.length > 0 ? packageDirs : ["."];

    const metadataTypes = getMetadataTypes();
    const mt: any = metadataTypes.find((m: any) => m.xmlName === metadataType);
    if (!mt) {
      return null;
    }

    // Build candidate keys similar to buildMetadataKeys in the retriever
    const candidateKeys = new Set<string>();
    const name = metadataName || "";
    const splitName = name.includes(".") ? name.split(".") : [name];
    /* jscpd:ignore-start */
    if (splitName.length > 1 && mt.directoryName) {
      const parentApiName = splitName.slice(0, -1).join("/");
      const componentName = splitName.slice(-1)[0];
      if (mt.suffix) {
        candidateKeys.add(
          `/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}`,
        );
        candidateKeys.add(
          `/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}-meta.xml`,
        );
      } else if (mt.content && Array.isArray(mt.content)) {
        for (const c of mt.content) {
          if (c && c.suffix) {
            candidateKeys.add(
              `/${parentApiName}/${mt.directoryName}/${componentName}.${c.suffix}`,
            );
            candidateKeys.add(
              `/${parentApiName}/${mt.directoryName}/${componentName}.${c.suffix}-meta.xml`,
            );
          }
        }
      } else {
        candidateKeys.add(
          `/${parentApiName}/${mt.directoryName}/${componentName}`,
        );
        candidateKeys.add(
          `/${parentApiName}/${mt.directoryName}/${componentName}-meta.xml`,
        );
      }
    } else if (mt.suffix) {
      candidateKeys.add(`/${name}.${mt.suffix}`);
      candidateKeys.add(`/${name}.${mt.suffix}-meta.xml`);
      // also consider content suffixes when present
      if (mt.content && Array.isArray(mt.content)) {
        for (const c of mt.content) {
          if (c && c.suffix) {
            candidateKeys.add(`/${name}.${c.suffix}`);
            candidateKeys.add(`/${name}.${c.suffix}-meta.xml`);
          }
        }
      }
    } else if (mt.content && Array.isArray(mt.content)) {
      for (const c of mt.content) {
        if (c && c.suffix) {
          candidateKeys.add(`/${name}.${c.suffix}`);
          candidateKeys.add(`/${name}.${c.suffix}-meta.xml`);
        }
      }
    } else {
      // fallback
      if (mt.directoryName) {
        candidateKeys.add(`/${mt.directoryName}/${name}`);
        candidateKeys.add(`/${mt.directoryName}/${name}-meta.xml`);
      }
      candidateKeys.add(`/${name}`);
      candidateKeys.add(`/${name}-meta.xml`);
    }
    /* jscpd:ignore-end */

    // Every candidate key is a path suffix ending on a file name, so it goes
    // straight into the glob expression: one walk for all the package
    // directories, returning the handful of matching files, instead of one walk
    // per package directory listing everything under the metadata folder and
    // filtering the names afterwards. Salesforce API names hold no glob special
    // character, so they need no escaping here.
    const keyList = Array.from(candidateKeys);
    const patterns: string[] = [];
    for (const pkg of pkgDirs) {
      const base = normalizeGlobBase(String(pkg));
      for (const key of keyList) {
        const relKey = key.replace(/^\//, "");
        patterns.push(base ? `${base}/**/${relKey}` : `**/${relKey}`);
      }
    }
    if (patterns.length === 0) {
      return null;
    }
    const combinedPattern =
      patterns.length > 1 ? `{${patterns.join(",")}}` : patterns[0];

    let files: string[] = [];
    try {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceRoot, combinedPattern),
        GLOB_IGNORE_PATTERNS,
      );
      files = uris.map((uri) => uri.fsPath.replace(/\\/g, "/"));
    } catch {
      return null;
    }
    if (files.length === 0) {
      return null;
    }

    // Return the match of the earliest package directory, and within it the
    // earliest candidate key (the source file before its -meta.xml companion)
    for (const pkg of pkgDirs) {
      const base = normalizeGlobBase(String(pkg));
      const pkgFiles = base
        ? files.filter((f) => f.includes(`/${base}/`) || f.startsWith(`${base}/`))
        : files;
      for (const key of keyList) {
        const match = pkgFiles.find((f) => f.endsWith(key));
        if (match) {
          return match;
        }
      }
    }

    // nothing found
    return files[0];
  } catch {
    return null;
  }
}
