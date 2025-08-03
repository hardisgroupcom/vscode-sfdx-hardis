import * as http from "http";
import getPort, { portNumbers } from "get-port";
import { WebSocketServer } from "ws";
import * as vscode from "vscode";
import { getWorkspaceRoot, stripAnsi } from "./utils";
import { Logger } from "./logger";
import { LwcPanelManager } from "./lwc-panel-manager";

const DEFAULT_PORT = parseInt(process.env.SFDX_HARDIS_WEBSOCKET_PORT || "2702");
let globalWss: LocalWebSocketServer | null;

export class LocalWebSocketServer {
  public websocketHostPort: any = null;
  private context: vscode.ExtensionContext ;
  private server: http.Server;
  private wss: WebSocketServer;
  private clients: any = {};

  constructor(context: vscode.ExtensionContext) {
    console.time("WebSocketServer_init");
    this.server = http.createServer();
    this.wss = new WebSocketServer({ server: this.server });
    globalWss = this;
    this.context = context || null;
    console.timeEnd("WebSocketServer_init");
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
      this.clients[data.context.id] = { context: data.context, ws: ws };
    }
    // Command end
    if (data.event === "clientClose") {
      delete this.clients[data.context.id];
    }
    // Request to refresh status box
    else if (data.event === "refreshStatus") {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
    }
    // Request to refresh commands box
    else if (data.event === "refreshCommands") {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshCommandsView");
    }
    // Request to refresh commands box
    else if (data.event === "refreshPlugins") {
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
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
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      
      // If user input is set to LWC UI, use the LWC UI panel
      if (config.get("userInput") === "ui-lwc") {
        const panelManager = LwcPanelManager.getInstance(this.context);
        const lwcId = "s-prompt-input";
        
        // Get or create the panel for prompt input
        const panel = panelManager.getOrCreatePanel(lwcId, {prompt: prompt});
        
        // Track if a response has been sent to prevent duplicate responses
        let responseSent = false;
        
        // Set up message handling for this specific prompt
        const messageUnsubscribe = panel.onMessage((messageType: string, data: any) => {
          if (messageType === "submit" && !responseSent) {
            responseSent = true;
            
            // The data should contain the response object with the prompt name as key
            this.sendResponse(ws, {
              event: "promptsResponse",
              promptsResponse: [data],
            });
            
            // Schedule panel disposal after a delay if no new prompts arrive
            panelManager.scheduleDisposal(lwcId, 2000);
            
            // Unsubscribe from messages for this prompt
            messageUnsubscribe();
          }
        });
        
        // Set up disposal callback to handle panel closure without submission
        const onDisposalCallback = () => {
          if (!responseSent) {
            responseSent = true;
            
            // Send exitNow response like when escape key is pressed in quickpick
            const exitResponse: any = {};
            exitResponse[`${prompt.name}`] = "exitNow";
            
            this.sendResponse(ws, {
              event: "promptsResponse",
              promptsResponse: [exitResponse],
            });
            
            // Unsubscribe from messages
            messageUnsubscribe();
          }
        };
        
        // Register the disposal callback with the panel manager
        panelManager.setDisposalCallback(lwcId, onDisposalCallback);
        
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
