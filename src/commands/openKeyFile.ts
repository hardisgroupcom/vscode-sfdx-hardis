import * as vscode from "vscode";
import * as fs from "fs-extra";
import path from "path";
import { getWorkspaceRoot } from "../utils";
import { Commands } from "../commands";

export function registerOpenKeyFile(commands: Commands) {
  // Open key file command
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.openKeyFile",
    async () => {
      const keyFileList = [
        {
          file: "config/.sfdx-hardis.yml",
          label: "sfdx-hardis main configuration file",
        },
        {
          file: "manifest/package.xml",
          label: "List of all deployed metadatas",
        },
        {
          file: "manifest/destructiveChanges.xml",
          label: "List of all deleted metadatas",
        },
        {
          file: "manifest/package-no-overwrite.xml",
          label:
            "List of metadatas that will be deployed only if they are not already existing in the target org",
        },
        {
          file: "manifest/packageDeployOnce.xml",
          label:
            "List of metadatas that will be deployed only if they are not already existing in the target org",
        },
        {
          file: "config/project-scratch-def.json",
          label: "Scratch org creation definition file",
        },
        { file: "sfdx-project.json", label: "Sfdx Project config file" },
        { file: ".forceignore", label: "Files ignored by SFDX" },
        { file: ".gitignore", label: "Files ignored by Git" },
        { file: ".mega-linter.yml", label: "Mega-Linter configuration" },
      ];
      const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
      const currentWorkspaceFolderUri = getWorkspaceRoot();
      const value = await new Promise<any>((resolve) => {
        quickpick.ignoreFocusOut = true;
        ((quickpick.title = "Please select a configuration file to open"),
          (quickpick.canSelectMany = false));
        quickpick.items = keyFileList
          .filter((choice: any) =>
            fs.existsSync(currentWorkspaceFolderUri + path.sep + choice.file),
          )
          .map((choice: any) => {
            const quickPickItem: vscode.QuickPickItem = {
              label: choice.file,
              detail: choice.label,
            };
            return quickPickItem;
          });
        quickpick.show();
        quickpick.onDidHide(() => resolve(null));
        quickpick.onDidAccept(() => {
          if (quickpick.selectedItems.length > 0) {
            const values = quickpick.selectedItems.map((item) => {
              return keyFileList.filter((choice: any) => {
                return item.label === choice.file;
              })[0].file;
            });
            resolve(values);
          }
          resolve(null);
        });
      });
      quickpick.dispose();
      if (value) {
        var openPath = vscode.Uri.parse(
          "file:///" + currentWorkspaceFolderUri + "/" + value,
        );
        vscode.workspace.openTextDocument(openPath).then((doc) => {
          vscode.window.showTextDocument(doc);
        });
      }
    },
  );
  commands.disposables.push(disposable);
}
