import * as vscode from "vscode";
import { Commands } from "../commands";

/**
 * Opens Guinea Run, the game hidden in the training site. The Welcome page
 * asks for it (five clicks on its guinea pig, or the Konami code), and the
 * command is left out of the command palette: it is an easter egg.
 *
 * Registering it costs nothing at startup: the panel module is a lazy chunk
 * imported when the command runs, and the game loads from the site only once
 * the panel is open.
 */
export function registerOpenGuineaRun(command: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.openGuineaRun",
    async () => {
      const { openGuineaRunPanel } = await import("../webviews/guineaRunPanel");
      openGuineaRunPanel(command.extensionUri);
    },
  );
  command.disposables.push(disposable);
}
