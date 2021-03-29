import stripAnsi = require('strip-ansi');
import * as WebSocket from 'ws';
import * as vscode from 'vscode';

const PORT = parseInt(process.env.SFDX_HARDIS_WEBSOCKET_PORT || "2702") ;
let globalWss: WebSocketServer | null;

export class WebSocketServer {

    private wss: WebSocket.Server;
    private clients:any = {};

    constructor() {
        this.wss = new WebSocket.Server({ port: PORT });
        globalWss = this;
        this.listen();
    }

    static sendMessage(data: any) {
        if (globalWss) {
            globalWss.broadcastMessage(data);
        }
    }

    listen() {
        this.wss.on('connection', (ws) => {
            ws.on('message', (data: any) => {
                this.receiveMessage(ws, JSON.parse(data));
            });
        });
    }

    async receiveMessage(ws: any, data: any) {
        if (process.env.DEBUG) {
            console.log('received: %s', data);
        }
        // Client initialization
        if (data.event === 'initClient') {
            this.clients[data.context.id] = {context: data.context, ws: ws};
        }
        // Client initialization
        if (data.event === 'clientClose') {
            delete this.clients[data.context.id];
        }
        // Request to refresh status box 
        else if (data.event === 'refreshStatus') {
            vscode.commands.executeCommand("vscode-sfdx-hardis.refreshStatusView");
        }
        // Request user input
        else if (data.event === 'prompts') {
            const prompt = data.prompts[0];
            // Text
            if (prompt.type === 'text') {
                const inputBoxOptions: vscode.InputBoxOptions = {
                        prompt: stripAnsi(prompt.message),
                        placeHolder: stripAnsi(prompt.placeholder) || "",
                        ignoreFocusOut: true,
                        value: prompt.initial
                    };
                vscode.window.showInputBox(inputBoxOptions).then(value => {
                    const response: any = {};
                    response[`${prompt.name}`] = value ;
                    this.sendResponse(ws,{event: 'promptsResponse', promptsResponse:[response]});
                });
            }
            // Select / Multiselect
            else if (prompt.type === 'select' || prompt.type === 'multiselect') {
                const quickpick = vscode.window.createQuickPick<vscode.QuickPickItem>();
                const value = await new Promise<any>(resolve => {
                    quickpick.ignoreFocusOut = true ;
                    quickpick.title = stripAnsi(prompt.message),
                    quickpick.canSelectMany = prompt.type === 'multiselect';
                    quickpick.items= prompt.choices.map((choice: any) => {
                        const quickPickItem : vscode.QuickPickItem = {
                            label: stripAnsi(choice.title),
                            detail: stripAnsi(choice.description || ''),
                            picked: choice.selected === true
                        };
                        return quickPickItem;
                    });
                    quickpick.show();
                    quickpick.onDidHide(() => resolve(["exitNow"])),
                    quickpick.onDidAccept(() => {
                        if (quickpick.selectedItems.length > 0) {
                            const values = quickpick.selectedItems.map(item => {
                                return prompt.choices.filter((choice: any) => {
                                    return item.label === stripAnsi(choice.title);
                                })[0].value;
                            });
                            resolve(values);
                        }
                        else if (prompt.type === 'multiselect') {
                            resolve([]);
                        }
                        resolve(["exitNow"]);
                    });
                });
                const response: any = {};
                response[`${prompt.name}`] = prompt.type === 'multiselect' ? value: value[0] ;
                this.sendResponse(ws,{event: 'promptsResponse', promptsResponse:[response]});
                quickpick.dispose();
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

    async sendResponse(ws: any,data: any) {
        ws.send(JSON.stringify(data));
    }

    dispose() {
        this.wss.close();
        globalWss = null;
    }
}
