import * as crypto from "crypto";
import * as vscode from "vscode";
import { getCurrentLocale, t } from "../i18n/i18n";
import { Logger } from "../logger";
import {
  allowedGameLink,
  deleteGuineaRunSave,
  GUINEA_RUN_SITE_ENV,
  guineaRunPlayUrl,
  guineaRunSaveFile,
  guineaRunSiteOrigin,
  readGuineaRunSave,
  writeGuineaRunSave,
} from "../utils/guineaRunUtils";
import { LwcUiPanel } from "./lwc-ui-panel";

/**
 * The Guinea Run panel: a frame on the game page of the training site.
 *
 * This module is a lazy chunk, loaded by the command the first time the game
 * opens (src/commands/openGuineaRun.ts). The game itself comes from the site,
 * so it is fetched only when the panel opens, and never at startup.
 *
 * The frame talks to the panel through postMessage. The panel script accepts
 * only messages from the site origin and from its own frame, and forwards
 * these to the extension: "exit" closes the panel, "openExternal" opens a
 * link in the browser once allowedGameLink() accepted it, and "loadSave",
 * "storeSave" and "clearSave" keep the save every project shares
 * (guineaRunSaveFile). The game signs that save: the extension never reads it.
 */

// Without the "ready" message of the game by then, the panel says the game
// needs an internet connection and offers to try again
const READY_TIMEOUT_MS = 15000;

let currentPanel: vscode.WebviewPanel | undefined;
// Writes and deletes of the save, one after the other, never two at once
let saveQueue: Promise<unknown> = Promise.resolve();

/** Opens the game, or shows it again when its panel is already open */
export function openGuineaRunPanel(extensionUri: vscode.Uri): void {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }
  const stylesRoot = vscode.Uri.joinPath(extensionUri, "out", "assets");
  const panel = vscode.window.createWebviewPanel(
    "sfdxHardisGuineaRun",
    "Guinea Run",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // Switching to another tab must not lose a game in progress
      retainContextWhenHidden: true,
      localResourceRoots: [stylesRoot],
    },
  );
  panel.iconPath = vscode.Uri.joinPath(
    extensionUri,
    "resources",
    "webviews",
    "guinea-pig-small.webp",
  );
  currentPanel = panel;
  panel.onDidDispose(() => {
    currentPanel = undefined;
  });
  panel.webview.onDidReceiveMessage((message) =>
    handleGameMessage(panel, message),
  );
  panel.webview.html = buildPanelHtml(panel.webview, stylesRoot);
}

function handleGameMessage(panel: vscode.WebviewPanel, message: unknown) {
  if (!message || typeof message !== "object") {
    return;
  }
  const { type, url, blob } = message as {
    type?: unknown;
    url?: unknown;
    blob?: unknown;
  };
  if (type === "exit") {
    panel.dispose();
  } else if (type === "loadSave") {
    void sendSave(panel);
  } else if (type === "storeSave") {
    saveQueue = saveQueue.then(async () => {
      if (!(await writeGuineaRunSave(guineaRunSaveFile(), blob))) {
        Logger.log("[Guinea Run] The save sent by the game was not written");
      }
    });
  } else if (type === "clearSave") {
    Logger.log("[Guinea Run] The game refused an edited save: it is deleted");
    saveQueue = saveQueue.then(() => deleteGuineaRunSave(guineaRunSaveFile()));
  } else if (type === "openExternal") {
    const link = allowedGameLink(url);
    if (!link) {
      Logger.log("[Guinea Run] Ignored a link to a site the game may not open");
      return;
    }
    // A string, not a Uri: VS Code then opens the address exactly as written
    void vscode.env.openExternal(link as unknown as vscode.Uri);
  }
}

/** Answers "loadSave" with the save as stored, or null; after the writes already asked for. */
async function sendSave(panel: vscode.WebviewPanel) {
  await saveQueue.catch(() => undefined);
  const blob = await readGuineaRunSave(guineaRunSaveFile());
  try {
    await panel.webview.postMessage({ type: "save", blob });
  } catch {
    // The panel was closed meanwhile
  }
}

function buildPanelHtml(webview: vscode.Webview, stylesRoot: vscode.Uri) {
  const siteOrigin = guineaRunSiteOrigin(process.env[GUINEA_RUN_SITE_ENV]);
  const playUrl = guineaRunPlayUrl(siteOrigin, getCurrentLocale());
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `frame-src ${siteOrigin}`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource}`,
  ].join("; ");
  // The stylesheets of the LWC panels, for the message shown offline
  const styleUri = (fileName: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(stylesRoot, "styles", fileName));
  const sldsCss = styleUri("salesforce-lightning-design-system.min.css");
  const themeVariablesCss = styleUri("global-theme-variables.css");
  const themeCss = styleUri("global-theme.css");
  const colorThemeConfig = vscode.workspace
    .getConfiguration("vsCodeSfdxHardis.theme")
    .get("colorTheme", "auto");
  const { colorTheme, colorContrast } =
    LwcUiPanel.resolveTheme(colorThemeConfig);
  const lang = escapeHtml(getCurrentLocale());
  const theme = escapeHtml(colorTheme);
  const contrast = escapeHtml(colorContrast);
  const offlineTitle = escapeHtml(t("guineaRunOfflineTitle"));
  const offlineMessage = escapeHtml(t("guineaRunOfflineMessage"));
  const retryLabel = escapeHtml(t("tryAgainLabel"));

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Guinea Run</title>
  <link rel="stylesheet" href="${sldsCss}">
  <link rel="stylesheet" href="${themeVariablesCss}">
  <link rel="stylesheet" href="${themeCss}">
  <style nonce="${nonce}">
    html, body { height: 100%; overflow: hidden; }
    .guinea-run-frame { display: block; width: 100%; height: 100vh; border: 0; }
    .guinea-run-offline { display: flex; align-items: center; justify-content: center; height: 100vh; }
    [hidden] { display: none !important; }
  </style>
</head>
<body class="slds-scope blue-back" data-theme="${theme}" data-contrast="${contrast}">
  <iframe id="game" class="guinea-run-frame" src="${playUrl}" title="Guinea Run" allow="autoplay; fullscreen; gamepad"></iframe>
  <div id="offline" class="guinea-run-offline" hidden>
    <div class="hardis-empty">
      <h3 class="hardis-empty-title">${offlineTitle}</h3>
      <p class="hardis-empty-desc">${offlineMessage}</p>
      <div class="hardis-empty-actions">
        <button id="retry" type="button" class="slds-button slds-button_neutral hardis-btn-tinted-blue">${retryLabel}</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const GAME_ORIGIN = ${JSON.stringify(siteOrigin)};
      const PLAY_URL = ${JSON.stringify(playUrl)};
      const frame = document.getElementById("game");
      const offline = document.getElementById("offline");
      let state = "loading";
      let readyTimer = null;

      // "loading", "ready" or "offline", also written on the body for the UI tests
      function setState(next) {
        state = next;
        document.body.dataset.game = next;
        offline.hidden = next !== "offline";
        frame.hidden = next === "offline";
      }

      function waitForGame() {
        setState("loading");
        clearTimeout(readyTimer);
        readyTimer = setTimeout(function () {
          if (state !== "ready") {
            setState("offline");
          }
        }, ${READY_TIMEOUT_MS});
      }

      window.addEventListener("message", function (event) {
        // The extension answers "loadSave": the save goes to the game, and only to its site
        if (event.source === window.parent && event.data && event.data.type === "save") {
          const blob = typeof event.data.blob === "string" ? event.data.blob : null;
          if (frame.contentWindow) {
            frame.contentWindow.postMessage({ source: "vscode-sfdx-hardis", type: "save", blob: blob }, GAME_ORIGIN);
          }
          return;
        }
        // Only the game, from its own site and in this frame, is heard
        if (event.origin !== GAME_ORIGIN || event.source !== frame.contentWindow) {
          return;
        }
        const data = event.data;
        if (!data || typeof data !== "object" || data.source !== "guinea-run") {
          return;
        }
        if (data.type === "ready") {
          clearTimeout(readyTimer);
          setState("ready");
          frame.focus();
        }
        else if (data.type === "exit") {
          vscode.postMessage({ type: "exit" });
        }
        else if (data.type === "openExternal" && typeof data.url === "string") {
          vscode.postMessage({ type: "openExternal", url: data.url });
        }
        else if (data.type === "loadSave" || data.type === "clearSave") {
          vscode.postMessage({ type: data.type });
        }
        else if (data.type === "storeSave" && typeof data.blob === "string") {
          vscode.postMessage({ type: "storeSave", blob: data.blob });
        }
      });

      document.getElementById("retry").addEventListener("click", function () {
        waitForGame();
        frame.src = PLAY_URL;
      });

      // Back on the tab, the keys go to the game again
      window.addEventListener("focus", function () {
        if (state === "ready") {
          frame.focus();
        }
      });

      waitForGame();
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
