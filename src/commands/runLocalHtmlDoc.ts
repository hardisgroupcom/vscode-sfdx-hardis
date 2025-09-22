import * as vscode from "vscode";
import { Commands } from "../commands";
import { getPythonCommand } from "../utils";
import axios from "axios";

export async function registerRunLocalHtmlDocPages(commands: Commands) {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.runLocalHtmlDocPages",
      async () => {
        // Check how python is installed
        const pythonCommand = await getPythonCommand();
        if (!pythonCommand) {
          vscode.window
            .showErrorMessage(
              "🦙 Python is not installed or not available in PATH. Please install Python to run the local documentation server.",
              "Download and install Python",
            )
            .then((selection) => {
              if (selection === "Download and install Python") {
                vscode.env.openExternal(
                  vscode.Uri.parse("https://www.python.org/downloads/"),
                );
              }
            });
          return;
        }
        const command = `${pythonCommand} -m pip install mkdocs-material mkdocs-exclude-search mdx_truly_sane_lists && mkdocs serve --verbose`;
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.execute-command",
          command,
        );
        // Display a progress vscode UI message while the server starts (check that the server is started by pinging localhost:8000)
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title:
              "Starting local documentation server...\n(it can take a while 😱)",
            cancellable: true,
          },
          async (progress, token) => {
            return new Promise<void>((resolve, reject) => {
              let isResolved = false;
              const interval = setInterval(() => {
                axios
                  .get("http://localhost:8000", { timeout: 2000 })
                  .then(() => {
                    if (!isResolved) {
                      isResolved = true;
                      clearInterval(interval);
                      progress.report({
                        message:
                          "Local documentation server is running at http://localhost:8000",
                      });
                      vscode.env.openExternal(
                        vscode.Uri.parse("http://localhost:8000"),
                      );
                      resolve();
                    }
                  })
                  .catch(() => {
                    // Server not started yet or not reachable
                  });
              }, 3000);
              token.onCancellationRequested(() => {
                if (!isResolved) {
                  isResolved = true;
                  clearInterval(interval);
                  reject();
                }
              });
            });
          },
        );
      },
    );
    commands.disposables.push(disposable);
  }