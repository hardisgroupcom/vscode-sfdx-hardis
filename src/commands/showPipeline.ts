import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { getPullRequestButtonInfo } from "../utils/gitPrButtonUtils";
import { Logger } from "../logger";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";

export function registerShowPipeline(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPipeline",
    async () => {
      // Show progress while loading config editor input
      const pipelineData = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading pipeline information...",
          cancellable: false,
        },
        async () => {
          const pipelineDataProvider = new PipelineDataProvider();
          return await pipelineDataProvider.getPipelineData();
        },
      );

      // Calculate PR button info using utility
      const repoPath =
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.length > 0
          ? vscode.workspace.workspaceFolders[0].uri.fsPath
          : process.cwd();
      let prButtonInfo = null;
      try {
        prButtonInfo = await getPullRequestButtonInfo(repoPath);
      } catch (e) {
        Logger.log("Error getting PR button info:\n" + JSON.stringify(e));
      }

      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline",
        { pipelineData: pipelineData, prButtonInfo },
      );
      panel.updateTitle("DevOps Pipeline");

      // Register message handler for refreshpipeline and runCommand
      panel.onMessage(async (type, data) => {
        if (type === "refreshpipeline") {
          const provider = new PipelineDataProvider();
          const newData = await provider.getPipelineData();
          panel.sendInitializationData({
            pipelineData: newData,
            prButtonInfo,
          });
        } else if (type === "showPackageXml") {
          // Handle package XML display requests from pipeline
          await showPackageXmlPanel(data);
        }
      });
    },
  );
  commands.disposables.push(disposable);
}
