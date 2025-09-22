
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
          title: "Install Dependencies",
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
            panel.sendMessage({ type: "checkResult", data: { id: data.id, res } });
          } 
          // Install or upgrade a dependency
          else if (type === "installDependency") {
            let result: any;
            const dependency = dependencies[data.id];
            if (dependency && typeof dependency.installMethod === 'function') {
              try {
                result = await dependency.installMethod();
              } catch (err: any) {
                result = { success: false, message: err?.message || String(err) };
                vscode.window.showErrorMessage(`Installation of ${dependency.label} failed: ${result.message}`);
              }
            }
            else {
              // If no install method is provided, return an explicit error
              return { success: false, message: `No installer available for ${dependency.label}` };
            }
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
            const message = res?.message ?? res?.installed ? `${label} is already installed` : `${label} is not installed. See documentation.`;
            const buttonMessage = res?.messageLinkLabel || "Open instructions";
            const action = helpUrl ? 
              await vscode.window.showInformationMessage(message,{modal: true}, buttonMessage) :
              await vscode.window.showInformationMessage(message, {modal: true});
            if (action === buttonMessage && helpUrl) {
              vscode.env.openExternal(vscode.Uri.parse(helpUrl));
            }
          }
        });
      },
    );
    commands.disposables.push(disposable);
  }