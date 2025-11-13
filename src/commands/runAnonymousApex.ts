import * as vscode from "vscode";
import { Commands } from "../commands";
import fs from "fs-extra";
import path from "path";
import {
  execSfdxJsonWithProgress,
  getReportDirectory,
  getWorkspaceRoot,
} from "../utils";

export async function registerRunAnonymousApex(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.runAnonymousApex",
    async (params) => {
      let codeAnalyzerIsInstalled = false;
      // Get anonymous apex from the file (if context menu of file) or from the current editor (if right click in an .apex file editor)
      const reportDir = await getReportDirectory();
      const anonymousApexReportDir = `${reportDir}/anonymousApex`;
      let anonymousApex: string | undefined;
      if (params && params.fsPath) {
        anonymousApex = await fs.readFile(params.fsPath, "utf8");
      } else {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "apex") {
          anonymousApex = editor.document.getText();
        } else {
          // Folder is root + /scripts/apex if existing, or anonymousApexReportDir
          const apexScriptsFolder = path.join(
            getWorkspaceRoot(),
            "scripts",
            "apex",
          );
          const scriptsApexFolderExists =
            await fs.pathExists(apexScriptsFolder);
          const apexFolderToUse = scriptsApexFolderExists
            ? apexScriptsFolder
            : anonymousApexReportDir;
          const newAnonymousApexFilePath = path.join(
            apexFolderToUse,
            "anonymousApex.apex",
          );
          // Open file in a document tab if existing
          const fileExists = await fs.pathExists(newAnonymousApexFilePath);
          if (fileExists) {
            const document = await vscode.workspace.openTextDocument(
              newAnonymousApexFilePath,
            );
            await vscode.window.showTextDocument(document);
          } else {
            await fs.ensureDir(apexFolderToUse);
            const defaultApexCode = `// Write your anonymous Apex code here
// Then run it using either:
// - the menu command "Nerdy stuff -> Run anonymous Apex code"
// - the context menu on the file or in this window "Run anonymous Apex code"

System.debug('sfdx-hardis rocks !!!');
`;
            await fs.writeFile(
              newAnonymousApexFilePath,
              defaultApexCode,
              "utf8",
            );
            const document = await vscode.workspace.openTextDocument(
              newAnonymousApexFilePath,
            );
            await vscode.window.showTextDocument(document);
          }
          return;
        }
      }
      if (!anonymousApex || anonymousApex.trim().length === 0) {
        vscode.window.showErrorMessage(
          "🦙 No anonymous Apex code found. Please open an .apex file or select a file to run.",
        );
        return;
      }
      // Create a temporary file to store the anonymous apex code
      await fs.ensureDir(anonymousApexReportDir);
      let fileName = "anonymousApex";
      if (params && params.fsPath) {
        fileName = fs.pathExistsSync(params.fsPath)
          ? path.basename(params.fsPath, ".apex")
          : "anonymousApex";
      } else {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName) {
          fileName = path.basename(editor.document.fileName, ".apex");
        }
      }
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const formattedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const tempFilePath = `${anonymousApexReportDir}/${fileName}_${formattedDate}.apex`;
      await fs.writeFile(tempFilePath, anonymousApex, "utf8");
      // Run the anonymous apex
      const apexRunCommand = `sf apex run --file "${tempFilePath}"`;
      const apexRes = await execSfdxJsonWithProgress(
        apexRunCommand,
        {
          cwd: getWorkspaceRoot(),
          fail: false,
        },
        "Running Anonymous Apex...",
      );

      const showMessageWithLog = async (
        type: "info" | "error",
        message: string,
        logFile: string,
      ) => {
        const openLogAction = "Open Raw Log";
        const openAnalysisLog = "Open Log Analysis";
        let selection: string | undefined;
        if (type === "info") {
          selection = await vscode.window.showInformationMessage(
            message,
            openLogAction,
            openAnalysisLog
          );
        } else {
          selection = await vscode.window.showErrorMessage(
            message,
            openLogAction,
            openAnalysisLog
          );
        }
        if (selection === openLogAction) {
          const document = await vscode.workspace.openTextDocument(logFile);
          await vscode.window.showTextDocument(document);
        }
        else if (selection === openAnalysisLog) {
          // Check if the Lana extension command is available
          const lanaCommand = 'lana.showLogAnalysis';
          if (codeAnalyzerIsInstalled === false) {
            const availableCommands = await vscode.commands.getCommands();
            if (availableCommands.includes(lanaCommand)) {
              codeAnalyzerIsInstalled = true;
            }
            else {
              vscode.window.showWarningMessage(
                '🦙 Log Analysis command not available. Please install the Apex Log Analyzer extension.',
                "Install Apex Log Analyzer"
              ).then((selection) => {
                if (selection === "Install Apex Log Analyzer") {
                  vscode.commands.executeCommand('workbench.extensions.search', 'financialforce.lana');
                }
              });
              return;
            }
          }
          if (codeAnalyzerIsInstalled === true) {
            const fileUri = vscode.Uri.file(logFile);
            vscode.commands.executeCommand(lanaCommand, fileUri);
          }
        }
      };

      // Open new VsCode tab with the result log file
      if (apexRes && apexRes.result) {
        const logFile = tempFilePath.replace(".apex", ".log");
        const logContent = apexRes.result.logs || "No log available.";
        await fs.writeFile(logFile, logContent, "utf8");
        await showMessageWithLog(
          "info",
          "🦙 Anonymous Apex executed successfully.",
          logFile,
        );
      } else if (apexRes?.message && apexRes?.data?.logs) {
        // In case of error, we can still have a log
        const logFile = tempFilePath.replace(".apex", ".err.log");
        const logContent = apexRes.data.logs || "No log available.";
        await fs.writeFile(logFile, logContent, "utf8");
        // Display error with a button to open log file
        await showMessageWithLog(
          "error",
          `🦙 An error occurred: ${apexRes.message}`,
          logFile,
        );
      } else if (apexRes?.message) {
        vscode.window.showErrorMessage(
          `🦙 An error occurred: ${apexRes.message}`,
        );
      } else {
        vscode.window.showErrorMessage(
          "🦙 An error occurred while running the anonymous Apex code.",
        );
      }
    },
  );
  commands.disposables.push(disposable);
}
