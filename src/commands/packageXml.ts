import * as vscode from "vscode";
import * as fs from "fs-extra";
import path from "path";
import { LwcPanelManager } from "../lwc-panel-manager";
import { getWorkspaceRoot } from "../utils";

export async function showPackageXmlPanel(packageConfig: any = {}): Promise<void> {
    const lwcManager = LwcPanelManager.getInstance();

    // Default to skip items if no config provided (backward compatibility)
    const config = {
      packageType: packageConfig.packageType || "skip",
      filePath: packageConfig.filePath || "manifest/package-skip-items.xml",
      fallbackFilePath: packageConfig.fallbackFilePath || null,
      title: packageConfig.title || "Package Configuration",
    };

    try {
      let packageData;
      let actualFilePath = config.filePath;

      try {
        packageData = await loadPackageXmlData(config.filePath);
      } catch (error) {
        // Try fallback file if specified and main file fails
        if (config.fallbackFilePath) {
          try {
            packageData = await loadPackageXmlData(
              config.fallbackFilePath,
            );
            actualFilePath = config.fallbackFilePath; // Update to show the actual loaded file
          } catch {
            throw error; // Throw original error if fallback also fails
          }
        } else {
          throw error;
        }
      }

      const panel = lwcManager.getOrCreatePanel("s-package-xml", {
        packageData: packageData,
        config: { ...config, filePath: actualFilePath },
      });
      panel.updateTitle(config.title);

      // Handle messages from the Package XML panel
      panel.onMessage(async (type: string, data: any) => {
        switch (type) {
          case "refreshPackageConfig": {
            try {
              const refreshFilePath = data?.filePath || config.filePath;
              const newPackageData =
                await loadPackageXmlData(refreshFilePath);
              panel.sendMessage({
                type: "packageDataUpdated",
                data: {
                  packageData: newPackageData,
                  config: { ...config, filePath: refreshFilePath },
                },
              });
            } catch (error: any) {
              panel.sendMessage({
                type: "packageDataUpdated",
                data: {
                  error: error.message,
                  config: config,
                },
              });
            }
            break;
          }
          case "editPackageFile": {
            const workspaceRoot = getWorkspaceRoot();
            const editFilePath = data?.filePath || config.filePath;
            const packagePath = path.join(workspaceRoot, editFilePath);
            try {
              const document =
                await vscode.workspace.openTextDocument(packagePath);
              await vscode.window.showTextDocument(document);
            } catch (error: any) {
              vscode.window.showErrorMessage(
                `Failed to open package file: ${error.message}`,
              );
            }
            break;
          }
          case "backToMonitoring": {
            vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showOrgMonitoring",
            );
            break;
          }
          default:
            break;
        }
      });
    } catch (error: any) {
      const panel = lwcManager.getOrCreatePanel("s-package-xml", {
        error: error.message,
      });
      panel.updateTitle("Package Configuration - Error");
    }
  }

async function loadPackageXmlData(
    relativeFilePath: string = "manifest/package-skip-items.xml",
  ): Promise<any> {
    const workspaceRoot = getWorkspaceRoot();
    const packagePath = path.join(workspaceRoot, relativeFilePath);

    if (!fs.existsSync(packagePath)) {
      throw new Error(`Package file not found: ${relativeFilePath}`);
    }

    try {
      const xmlContent = await fs.readFile(packagePath, "utf8");
      return await parsePackageXml(xmlContent);
    } catch (error: any) {
      throw new Error(
        `Failed to read package-skip-items.xml: ${error.message}`,
      );
    }
  }

async function parsePackageXml(xmlContent: string): Promise<any> {
    // Simple XML parsing for package.xml structure
    try {
      // Extract API version
      const apiVersionMatch = xmlContent.match(/<version>([^<]+)<\/version>/);
      const apiVersion = apiVersionMatch ? apiVersionMatch[1] : "Unknown";

      // Extract types
      const typesRegex = /<types>([\s\S]*?)<\/types>/g;
      const types: any[] = [];
      let typeMatch;

      while ((typeMatch = typesRegex.exec(xmlContent)) !== null) {
        const typeContent = typeMatch[1];

        // Extract type name
        const nameMatch = typeContent.match(/<name>([^<]+)<\/name>/);
        const typeName = nameMatch ? nameMatch[1] : "Unknown";

        // Extract members
        const membersRegex = /<members>([^<]+)<\/members>/g;
        const members: string[] = [];
        let memberMatch;

        while ((memberMatch = membersRegex.exec(typeContent)) !== null) {
          members.push(memberMatch[1]);
        }

        if (typeName !== "Unknown") {
          types.push({
            name: typeName,
            members: members,
          });
        }
      }

      return {
        apiVersion: apiVersion,
        types: types,
      };
    } catch (error: any) {
      throw new Error(`Failed to parse XML content: ${error.message}`);
    }
  }