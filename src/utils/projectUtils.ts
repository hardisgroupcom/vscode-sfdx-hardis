
import * as vscode from "vscode";
import * as path from "path";
import fg from "fast-glob";
import { getWorkspaceRoot, listSfdxProjectPackageDirectories } from "../utils";
import { listMetadataTypes } from "./metadataList";

export async function openMetadataFile(metadataType: string,metadataName: string): Promise<void> {
    try {
        if (!metadataType || !metadataName) {
            vscode.window.showErrorMessage("Missing metadata type or name");
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
    metadataType: string, metadataName: string
): Promise<string | null> {
    try {
        const workspaceRoot = getWorkspaceRoot();
        const packageDirs = await listSfdxProjectPackageDirectories();
        const pkgDirs = packageDirs && packageDirs.length > 0 ? packageDirs : ["."];

        const metadataTypes = listMetadataTypes();
        const mt: any = metadataTypes.find((m: any) => m.xmlName === metadataType);
        if (!mt) {
            return null;
        }

        // Build candidate keys similar to buildMetadataKeys in the retriever
        const candidateKeys = new Set<string>();
        const name = metadataName || "";
        const splitName = name.includes(".") ? name.split(".") : [name];

        if (splitName.length > 1 && mt.directoryName) {
            const parentApiName = splitName.slice(0, -1).join("/");
            const componentName = splitName.slice(-1)[0];
            if (mt.suffix) {
                candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}`);
                candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}.${mt.suffix}-meta.xml`);
            } else if (mt.content && Array.isArray(mt.content)) {
                for (const c of mt.content) {
                    if (c && c.suffix) {
                        candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}.${c.suffix}`);
                        candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}.${c.suffix}-meta.xml`);
                    }
                }
            } else {
                candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}`);
                candidateKeys.add(`/${parentApiName}/${mt.directoryName}/${componentName}-meta.xml`);
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

        // For each package dir, scan relevant files and try to find a match
        for (const pkg of pkgDirs) {
            try {
                const dirName = mt.directoryName || "";
                const baseGlob = path
                    .join(workspaceRoot, pkg, "**", dirName || "", "**", "*")
                    .replace(/\\/g, "/");

                const files: string[] = await fg(baseGlob, {
                    dot: true,
                    onlyFiles: true,
                    followSymbolicLinks: true,
                }).catch(() => []);

                if (!files || files.length === 0) {
                    continue;
                }

                const keyList = Array.from(candidateKeys);
                for (const f of files) {
                    for (const cand of keyList) {
                        if (f.endsWith(cand)) {
                            return f;
                        }
                    }
                }
            } catch {
                // ignore scanning errors for this package
                continue;
            }
        }

        // nothing found
        return null;
    } catch {
        return null;
    }
}