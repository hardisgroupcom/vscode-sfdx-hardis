
import * as vscode from "vscode";
import { LwcPanelManager } from "../lwc-panel-manager";
import { SetupHelper } from "../utils/setupUtils";
import { Commands } from "../commands";

export function registerShowSetup(commands: Commands) {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.showSetup",
      async () => {
        const lwcManager = LwcPanelManager.getInstance();
        const panel = lwcManager.getOrCreatePanel("s-setup", {
          title: "Setup",
          viewColumn: vscode.ViewColumn.One,
        });
        const helper = SetupHelper.getInstance();
        const dependencies = helper.listDependencies();
        panel.onMessage(async (type: string, data: any) => {
          // Return initial list
          if (type === "requestSetupInit") {
            const checks = Object.keys(dependencies).map((key) => {
              const meta = dependencies[key] || { explanation: "", installable: true, iconName: "utility:settings", prerequisites: [] };
              return {
                id: key,
                label: meta.label || key,
                explanation: meta.explanation,
                installable: meta.installable,
                iconName: meta.iconName,
                prerequisites: meta.prerequisites || [],
                installed: false,
                version: null,
              };
            });
            // Send initialize immediately so the LWC can render static list first
            panel.sendMessage({ type: "initialize", data: { checks } });
          } 
          // Check presence and validity of a dependency
          else if (type === "checkDependency") {
            const dependency = dependencies[data.id];
            let res = null;

            if (dependency && typeof dependency.checkMethod === 'function') {
              try {
                res = await dependency.checkMethod();
              } catch {
                res = { id: data.id, label: dependency.label, installed: false, version: null, status: 'error' };
              }
            } else {
              // No check method defined
              res = { id: data.id, label: dependency.label, installed: false, version: null, status: 'error' };
            }

            panel.sendMessage({ type: "checkResult", data: { id, res } });
          } 
          // Install a dependency
          else if (type === "installDependency") {
            const dependency = dependencies[data.id];
            // Run install under a VS Code progress notification
            const result = await vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: `Installing ${dependency.label}...`, cancellable: false },
              async () => {
                if (dependency && typeof dependency.installMethod === 'function') {
                  try {
                    const res = await dependency.installMethod();
                    return res;
                  } catch (err: any) {
                    return { success: false, message: err?.message || String(err) };
                  }
                }
                // If no install method is provided, return an explicit error
                return { success: false, message: `No installer available for ${dependency.label}` };
              },
            );
            panel.sendMessage({ type: "installResult", data: { id: data.id, res: result } });
          } 
          else if (type === "showInstructions") {
            const id = data?.id;
            let res = null;
            const meta = id ? dependencies[id] : undefined;

            if (meta && typeof meta.checkMethod === 'function') {
              try {
                res = await meta.checkMethod();
              } catch {
                res = { id, label: meta.label || id, installed: false, version: null, status: 'error' };
              }
            } else {
              res = { id, label: id, installed: false, version: null, status: 'error' };
            }

            const helpUrl = res?.helpUrl || null;
            const label = res?.label || id || "dependency";
            const message = res?.installed ? `${label} is already installed` : `${label} is not installed. See documentation.`;
            const action = helpUrl ? await vscode.window.showInformationMessage(message, "Open instructions") : await vscode.window.showInformationMessage(message);
            if (action === "Open instructions" && helpUrl) {
              vscode.env.openExternal(vscode.Uri.parse(helpUrl));
            }
          }
        });
      },
    );
    commands.disposables.push(disposable);
  }