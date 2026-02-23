import * as http from "http";
import getPort, { portNumbers } from "get-port";
import { WebSocketServer } from "ws";
import * as vscode from "vscode";
import { getWorkspaceRoot, stripAnsi } from "./utils";
import { Logger } from "./logger";
import { LwcPanelManager } from "./lwc-panel-manager";
import { HardisStatusProvider } from "./hardis-status-provider";
import { refreshDataWorkbenchPanel } from "./commands/showDataWorkbench";

const DEFAULT_PORT = parseInt(process.env.SFDX_HARDIS_WEBSOCKET_PORT || "2702");
let globalWss: LocalWebSocketServer | null;

export class LocalWebSocketServer {
  public websocketHostPort: any = null;
  private context: vscode.ExtensionContext;
  private server: http.Server;
  private wss: WebSocketServer;
  private clients: any = {};
  private config: vscode.WorkspaceConfiguration;

  constructor(context: vscode.ExtensionContext) {
    console.time("WebSocketServer_init");
    this.server = http.createServer();
    this.wss = new WebSocketServer({ server: this.server });
    globalWss = this;
    this.context = context || null;
    console.timeEnd("WebSocketServer_init");
    this.config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  }

  async refreshConfig() {
    this.config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  }

  async start() {
    let port = DEFAULT_PORT;
    if (port === 2702) {
      // Define random port if not forced by the user with env var SFDX_HARDIS_WEBSOCKET_PORT
      port = await getPort({ port: portNumbers(2702, 2784) });
    }
    this.listen();
    //start our server
    console.time("WebSocketServer_listen");
    this.server.listen(port, () => {
      this.websocketHostPort = `localhost:${port}`;
      Logger.log(`Data stream server started on port ${port}`);
      console.timeEnd("WebSocketServer_listen");
    });
  }

  static sendMessage(data: any) {
    if (globalWss) {
      globalWss.broadcastMessage(data);
    }
  }

  listen() {
    this.wss.on("connection", (ws) => {
      ws.on("message", (data: any) => {
        this.receiveMessage(ws, JSON.parse(data));
      });
    });
  }

  async receiveMessage(ws: any, data: any) {
    if (process.env.DEBUG) {
      Logger.log("received:" + data);
    }
    // Command initialization
    if (data.event === "initClient") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        await this.sendCommandReady(ws);
        return;
      }
      // If the UI is configured to be hidden, do not proceed with command execution
      if (data?.uiConfig?.hide === true) {
        await this.sendCommandReady(ws);
        return;
      }

      // Close any completed commandExecution panel before opening a new one
      const panelManager = LwcPanelManager.getInstance(this.context);
      const activePanelIds = panelManager.getActivePanelIds();
      for (const panelId of activePanelIds) {
        if (panelId.startsWith("s-command-execution-")) {
          const panel = panelManager.getPanel(panelId);
          if (panel && panel.getTitle && typeof panel.getTitle === "function") {
            const title = panel.getTitle();
            if (title && title.endsWith("- Completed")) {
              panelManager.disposePanel(panelId);
            }
          }
        }
      }

      this.clients[data.context.id] = { context: data.context, ws: ws };

      // Create a new command execution panel for this command
      const lwcId = `s-command-execution-${data.context.id}`;
      const panel = panelManager.getOrCreatePanel(lwcId, data.context);
      this.clients[data.context.id].panel = panel;
      this.clients[data.context.id].lwcId = lwcId;

      const messageUnsubscribe = panel.onMessage(
        async (messageType: any, _msgData: any) => {
          // Handle cancel command request from the panel
          if (messageType === "panelDisposed") {
            // Send cancel command event to the server
            this.sendResponse(ws, {
              event: "cancelCommand",
              context: data.context,
            });
            messageUnsubscribe();
          } else if (messageType === "commandLWCReady") {
            // Notify the command that the LWC panel is ready to receive messages
            await this.sendCommandReady(ws);
          }
        },
      );

      // Set the panel title to include command info
      const commandName = data.context.command || "SFDX Hardis Command";
      panel.updateTitle(`${commandName} - Running`);

      // Initialize the command in the panel, including commandDocUrl if available
      const initData: any = {
        type: "initializeCommand",
        data: data.context,
      };
      if (data.commandDocUrl) {
        initData.data.commandDocUrl = data.commandDocUrl;
      }
      if (data.uiConfig) {
        initData.data.uiConfig = data.uiConfig;
      }
      if (data.commandLogFile) {
        initData.data.commandLogFile = data.commandLogFile;
      }
      panel.sendMessage(initData);
    }
    // Command end
    if (data.event === "closeClient" || data.event === "clientClose") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      /* jscpd:ignore-start */
      if (clientData?.panel) {
        // Mark command as completed in the panel
        const success = data?.status !== "aborted" && data?.status !== "error";
        const message: any = {
          type: "completeCommand",
          data: { success: success, status: data?.status },
        };
        if (data?.error) {
          message.data.error = data.error;
        }
        clientData.panel.sendMessage(message);

        const titleLabel =
          data?.status === "aborted"
            ? "Aborted"
            : data?.status === "error"
              ? "Error"
              : "Completed";

        // Update panel title to show completion
        const commandName = clientData.context.command || "SFDX Hardis Command";

        clientData.panel.updateTitle(`${commandName} - ${titleLabel}`);

        // Auto-close panel if command is in autoclose list and completed successfully
        if (success) {
          // Extract core command without arguments
          const coreCommand = this.extractCoreCommand(commandName);
          // Refresh config to get the latest autoclose commands list
          await this.refreshConfig();
          const autocloseCommands: string[] =
            this.config.get("autocloseCommands") || [];
          if (coreCommand && autocloseCommands.includes(coreCommand)) {
            // Schedule panel disposal after a short delay to allow user to see completion
            const panelManager = LwcPanelManager.getInstance(this.context);
            panelManager.scheduleDisposal(clientData.lwcId, 2000); // 2 seconds
          }
        }

        // Schedule panel disposal after a delay to allow user to review logs
        // const panelManager = LwcPanelManager.getInstance(this.context);
        // panelManager.scheduleDisposal(clientData.lwcId, 10000); // 10 seconds
      }
      /* jscpd:ignore-end */
      delete this.clients[data.context?.id];
    }
    // Command log line
    else if (data.event === "commandLogLine") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      // Find the client context for this log line using the context ID
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "addLogLine",
          data: {
            logType: data.logType,
            message: data.message,
            timestamp: new Date(),
            isQuestion: data.isQuestion || false,
          },
        });
      }
    }
    // Sub-command start
    else if (data.event === "commandSubCommandStart") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "addSubCommandStart",
          data: data.data,
        });
      }
    }
    // Sub-command end
    /* jscpd:ignore-start */
    else if (data.event === "commandSubCommandEnd") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "addSubCommandEnd",
          data: data.data,
        });
      }
    }
    // Progress start
    else if (data.event === "progressStart") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "progressStart",
          data: {
            title: data.title || "Progress",
            totalSteps: data.totalSteps || data.steps || 0,
          },
        });
      }
    }
    // Progress step
    else if (data.event === "progressStep") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "progressStep",
          data: {
            step: data.step,
            totalSteps: data.totalSteps || data.steps,
          },
        });
      }
    }
    // Progress end
    else if (data.event === "progressEnd") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "progressEnd",
          data: {
            totalSteps: data.totalSteps || data.steps,
          },
        });
      }
    }

    // Report file
    else if (data.event === "reportFile") {
      // Ignore if not lwc UI
      if (this.config.get("userInput") !== "ui-lwc") {
        return;
      }
      const clientData = this.clients[data.context?.id];
      if (clientData?.panel) {
        clientData.panel.sendMessage({
          type: "reportFile",
          data: {
            file: data.file,
            title: data.title,
            type: data.type, // Forward the type property for LWC simplification
          },
        });
      }
    }
    /* jscpd:ignore-end */
    // Request to refresh status box
    else if (data.event === "refreshStatus") {
      HardisStatusProvider.refreshOrgRelatedUis();
    }
    // Request to refresh commands box
    else if (data.event === "refreshCommands") {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshCommandsView");
    }
    // Request to refresh commands box
    else if (data.event === "refreshPlugins") {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
    }
    // Request to refresh pipeline info
    else if (data.event === "refreshPipeline") {
      const panelManager = LwcPanelManager.getInstance();
      // Pipeline config
      const pipelinePanel = panelManager.getPanel("s-pipeline");
      if (pipelinePanel) {
        pipelinePanel.sendMessage({
          type: "refreshPipeline",
        });
      }
      const packagesConfigPanel = panelManager.getPanel("s-installed-packages");
      // Packages config
      if (packagesConfigPanel) {
        packagesConfigPanel.sendMessage({
          type: "refreshPackages",
        });
      }
    }
    // Request to refresh data workbench
    else if (data.event === "refreshDataWorkbench") {
      refreshDataWorkbenchPanel();
    }
    // Request to refresh commands box
    else if (data.event === "runSfdxHardisCommand") {
      const sfdxHardisCommand = data?.sfdxHardisCommand || "";
      if (
        (!sfdxHardisCommand.startsWith("sfdx hardis") &&
          !sfdxHardisCommand.startsWith("sf hardis")) ||
        sfdxHardisCommand.includes("&&")
      ) {
        Logger.log("You can only run sfdx hardis commands from WebSocket");
        return;
      }
      vscode.commands.executeCommand(
        "vscode-sfdx-hardis.execute-command",
        data.sfdxHardisCommand,
      );
    }
    // Request to open a file in editor
    else if (data.event === "openFile") {
      const currentWorkspaceFolderUri = getWorkspaceRoot();
      var openPath = vscode.Uri.parse(
        "file:///" + currentWorkspaceFolderUri + "/" + data.file,
      );
      vscode.workspace.openTextDocument(openPath).then((doc) => {
        vscode.window.showTextDocument(doc);
        if (data.file.endsWith(".md")) {
          new Promise((resolve) => setTimeout(resolve, 500)).then(() => {
            vscode.commands.executeCommand("markdown.showPreview", doc);
          });
        }
      });
    }
    // Request user input
    else if (data.event === "prompts") {
      const prompt = data.prompts[0];
      // If user input is set to LWC UI, use the LWC UI panel
      if (this.config.get("userInput") === "ui-lwc") {
        const panelManager = LwcPanelManager.getInstance(this.context);
        // Try to find an active command execution panel for this context
        const commandLwcId = `s-command-execution-${data.context?.id || ""}`;
        const commandPanel = panelManager.getPanel(commandLwcId);

        // Factorized handler for prompt submit/cancel
        const handlePromptPanelMessages = (
          panel: any,
          lwcId: any,
          prompt: any,
        ) => {
          let responseSent = false;
          const messageUnsubscribe = panel.onMessage(
            (messageType: any, msgData: any) => {
              // Accept both legacy and embedded promptInput message types
              if (
                (messageType === "promptSubmit" || messageType === "submit") &&
                !responseSent
              ) {
                responseSent = true;
                this.sendResponse(ws, {
                  event: "promptsResponse",
                  promptsResponse: [msgData],
                });
                // If this is a standalone promptInput, check for command panel before disposal
                if (lwcId === "s-prompt-input") {
                  const hasActiveCommandPanel = Object.values(
                    this.clients,
                  ).some((client) => {
                    const c = client as any;
                    return (
                      c.panel &&
                      c.lwcId &&
                      c.lwcId.startsWith("s-command-execution-")
                    );
                  });
                  if (hasActiveCommandPanel) {
                    panelManager.disposePanel(lwcId);
                  } else {
                    panelManager.scheduleDisposal(lwcId, 2000);
                  }
                }
                messageUnsubscribe();
              }
              /* jscpd:ignore-start */
              if (
                (messageType === "promptExit" || messageType === "cancel") &&
                !responseSent
              ) {
                responseSent = true;
                const exitResponse: Record<string, any> = {};
                exitResponse[String(prompt.name)] = "exitNow";
                this.sendResponse(ws, {
                  event: "promptsResponse",
                  promptsResponse: [exitResponse],
                });
                messageUnsubscribe();
              }
              /* jscpd:ignore-end */
              // hide prompt in panel after submit or cancel message
              if (
                ["promptSubmit", "submit", "promptExit", "cancel"].includes(
                  messageType,
                )
              ) {
                panel.sendMessage({
                  type: "hidePrompt",
                  data: { promptName: prompt.name },
                });
              }
            },
          );
          // Disposal callback for standalone promptInput
          if (lwcId === "s-prompt-input") {
            const onDisposalCallback = () => {
              if (!responseSent) {
                responseSent = true;
                const exitResponse: Record<string, any> = {};
                exitResponse[String(prompt.name)] = "exitNow";
                this.sendResponse(ws, {
                  event: "promptsResponse",
                  promptsResponse: [exitResponse],
                });
                messageUnsubscribe();
              }
            };
            panelManager.setDisposalCallback(lwcId, onDisposalCallback);
          }
        };

        if (commandPanel) {
          // Send a message to the commandExecution LWC to show the prompt
          commandPanel.sendMessage({
            type: "showPrompt",
            data: { prompt, context: data.context },
          });
          handlePromptPanelMessages(commandPanel, commandLwcId, prompt);
          return;
        }
        // Fallback: no command panel, use standalone promptInput as before
        const lwcId = "s-prompt-input";
        const panel = panelManager.getOrCreatePanel(lwcId, { prompt });
        handlePromptPanelMessages(panel, lwcId, prompt);
        return;
      }

      const maxLenMessage = 1000;
      prompt.message =
        prompt.message > maxLenMessage
          ? prompt.message.substring(0, maxLenMessage) + "..."
          : prompt.message;
      // Text
      if (prompt.type === "text") {
        const inputBoxOptions: vscode.InputBoxOptions = {
          prompt: stripAnsi(prompt.message),
          placeHolder: stripAnsi(prompt.placeholder || ""),
          ignoreFocusOut: true,
          value: prompt.initial,
        };
        vscode.window.showInputBox(inputBoxOptions).then((value) => {
          const response: any = {};
          response[`${prompt.name}`] = value;
          this.sendResponse(ws, {
            event: "promptsResponse",
            promptsResponse: [response],
          });
        });
      }
      // Text
      else if (prompt.type === "number") {
        const inputBoxOptions: vscode.InputBoxOptions = {
          prompt: stripAnsi(prompt.message),
          placeHolder: stripAnsi(prompt.placeholder || ""),
          ignoreFocusOut: true,
          value: prompt.initial ? prompt.initial.toString() : null,
        };
        vscode.window.showInputBox(inputBoxOptions).then((value) => {
          const response: any = {};
          response[`${prompt.name}`] =
            typeof value === "string"
              ? prompt.isFloat
                ? parseFloat(value)
                : parseInt(value)
              : value;
          this.sendResponse(ws, {
            event: "promptsResponse",
            promptsResponse: [response],
          });
        });
      }
      // Select / Multiselect
      else if (prompt.type === "select" || prompt.type === "multiselect") {
        const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
        const value = await new Promise<any>((resolve) => {
          quickpick.ignoreFocusOut = true;
          quickpick.title = stripAnsi(prompt.message);
          quickpick.canSelectMany = prompt.type === "multiselect";
          quickpick.items = prompt.choices.map((choice: any) => {
            const quickPickItem: vscode.QuickPickItem = {
              label: stripAnsi(
                choice.title,
              ) /*+ ((choice.selected === true && prompt.type === "select" && !choice.title.includes('(default)')) ? ' (default) ' : '')*/,
              detail: stripAnsi(choice.description || ""),
              picked: choice.selected === true,
            };
            return quickPickItem;
          });
          // Show quickpick item
          quickpick.show();
          // Handle user selection
          quickpick.onDidAccept(() => {
            if (quickpick.selectedItems.length > 0) {
              const values = quickpick.selectedItems.map((item) => {
                return prompt.choices.filter((choice: any) => {
                  return item.label === stripAnsi(choice.title);
                })[0].value;
              });
              resolve(values);
            } else if (prompt.type === "multiselect") {
              resolve([]);
            }
            resolve(["exitNow"]);
          });
          // Handle ESCAPE key
          quickpick.onDidHide(() => resolve(["exitNow"]));
        });
        const response: any = {};
        response[`${prompt.name}`] =
          prompt.type === "multiselect" ? value : value[0];
        this.sendResponse(ws, {
          event: "promptsResponse",
          promptsResponse: [response],
        });
        quickpick.dispose();
      } else {
        throw new Error(`WSS: prompt type ${prompt.type} not taken in account`);
      }
    }
  }

  async sendCommandReady(ws: any) {
    // Send user input type back to caller so it know it can continue the command
    this.sendResponse(ws, {
      event: "userInput",
      userInput: this.config.get("userInput"),
    });
  }

  extractCoreCommand(fullCommand: string): string | null {
    if (!fullCommand) {
      return null;
    }
    // Extract core command without arguments
    // Split by space and take only the parts that form the command (sf hardis:category:action)
    const parts = fullCommand.split(/\s+/);
    // Find the command parts (sf hardis:... format)
    const commandParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Stop when we hit an argument (starts with -)
      if (part.startsWith("-")) {
        break;
      }
      commandParts.push(part);
      // If we have 'sf hardis:...' pattern, that's our command
      if (part.includes("hardis:") && commandParts.length >= 2) {
        break;
      }
    }
    return commandParts.length > 0 ? commandParts.join(" ") : null;
  }

  async broadcastMessage(data: any) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  async sendResponse(ws: any, data: any) {
    ws.send(JSON.stringify(data));
  }

  dispose() {
    try {
      // Dispose all LWC panels through the panel manager
      const panelManager = LwcPanelManager.getInstance();
      panelManager.disposeAllPanels();

      this.wss.close();
      this.server.close();
      globalWss = null;
    } catch {
      Logger.log("[sfdx-hardis] Error while closing WebSocket Server");
    }
  }
}
