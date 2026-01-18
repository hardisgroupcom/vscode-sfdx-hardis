/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
import "@lwc/synthetic-shadow";
import { createElement } from "lwc";

console.log("LWC UI initializing...");

const pendingMessages = [];

function routeMessageToComponent(message) {
  const component = window.lwcComponentInstance;
  if (!component) {
    return;
  }

  if (message.type === "initialize") {
    if (typeof component.initialize === "function") {
      component.initialize(message.data);
    } else if (typeof component.showPrompt === "function") {
      component.showPrompt(message.data);
    }
  }

  if (message.type === "updateTheme") {
    if (message.data?.colorTheme && document?.body) {
      document.body.setAttribute("data-theme", message.data?.colorTheme);
      document.body.setAttribute("data-contrast", message.data?.colorContrast);
      if (typeof component.handleColorThemeMessage === "function") {
        component.handleColorThemeMessage(message.type, message.data);
      }
    }
  }

  if (typeof component.handleMessage === "function") {
    component.handleMessage(message.type, message.data);
  }
}

function flushPendingMessages() {
  if (!window.lwcComponentInstance || pendingMessages.length === 0) {
    return;
  }
  const messagesToProcess = pendingMessages.splice(0, pendingMessages.length);
  messagesToProcess.forEach((msg) => routeMessageToComponent(msg));
}

// Static import map for all LWC modules (ensures Webpack bundles them)
const lwcModules = {
  "s-welcome": () => import("s/welcome"),
  "s-prompt-input": () => import("s/promptInput"),
  "s-command-execution": () => import("s/commandExecution"),
  "s-pipeline": () => import("s/pipeline"),
  "s-pipeline-config": () => import("s/pipelineConfig"),
  "s-extension-config": () => import("s/extensionConfig"),
  "s-metadata-retriever": () => import("s/metadataRetriever"),
  "s-multiline-helptext": () => import("s/multilineHelptext"),
  "s-installed-packages": () => import("s/installedPackages"),
  "s-org-manager": () => import("s/orgManager"),
  "s-org-monitoring": () => import("s/orgMonitoring"),
  "s-package-xml": () => import("s/packageXml"),
  "s-data-workbench": () => import("s/dataWorkbench"),
  "s-files-workbench": () => import("s/filesWorkbench"),
  "s-setup": () => import("s/setup"),
  "s-spinner": () => import("s/spinner"),
  "s-apex-tests-select": () => import("s/apexTestsSelect"),
};

// Communication bridge between VS Code webview and LWC components
window.vscodeAPI = acquireVsCodeApi();

// Function to send messages to VS Code
window.sendMessageToVSCode = function (message) {
  console.log("Sending message to VS Code:", message);
  window.vscodeAPI.postMessage(message);
};

// Listen for messages from VS Code
window.addEventListener("message", (event) => {
  const message = event.data;
  console.log("Received message from VS Code:", message);

  if (!window.lwcComponentInstance) {
    pendingMessages.push(message);
    return;
  }

  routeMessageToComponent(message);
});

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM ready, creating LWC component...");

  try {
    // Find the app container and mount the component
    const appContainer = document.getElementById("app");
    if (appContainer) {
      // Get lwc to instanciate
      const lwcId = appContainer.getAttribute("data-lwc-id");
      const initDataAttr = appContainer.getAttribute("data-init-data");

      console.log(`LWC ID: ${lwcId}`);

      let initData = null;
      if (initDataAttr && initDataAttr !== "{}") {
        try {
          // Decode HTML entities first
          const decodedData = initDataAttr
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
          initData = JSON.parse(decodedData);
        } catch (parseError) {
          console.error("Error parsing init data:", parseError);
        }
      }

      // Handle dynamic IDs by extracting the base component name
      let lwcImportFn = lwcModules[lwcId];
      if (!lwcImportFn) {
        // Try to find a matching base component (e.g., s-command-execution-41208 -> s-command-execution)
        const baseId = Object.keys(lwcModules).find((id) =>
          lwcId.startsWith(id),
        );
        if (baseId) {
          lwcImportFn = lwcModules[baseId];
          console.log(`Found base component ${baseId} for dynamic ID ${lwcId}`);
        }
      }

      if (!lwcImportFn) {
        console.error(`❌ No LWC class found for ID: ${lwcId}`);
        return;
      }
      // Dynamically import the LWC class using the static import map
      const lwcClass = (await lwcImportFn()).default;

      // Create the LWC element
      const element = createElement(lwcId, { is: lwcClass });

      // Store reference for message handling
      window.lwcComponentInstance = element;

      // Add element to DOM first
      appContainer.appendChild(element);
      console.log("✅ LWC component mounted successfully!");

      flushPendingMessages();

      // Avoid flash of unthemed content by applying theme early
      if (initData?.colorTheme && element.handleColorThemeMessage) {
        element.handleColorThemeMessage("updateTheme", { colorTheme: initData.colorTheme, colorContrast: initData.colorContrast } );
      }

      // Wait a bit for the component to fully initialize
      setTimeout(() => {
        // Initialize the component if it has initialization data
        if (initData) {
          if (typeof element.initialize === "function") {
            element.initialize(initData);
          } else if (typeof element.showPrompt === "function") {
            // For prompt input component
            element.showPrompt(initData);
          }
        }
      }, 100);
    } else {
      console.error("❌ App container not found");
    }
  } catch (error) {
    console.error("❌ Error creating LWC component:", error);
  }
});
