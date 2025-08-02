import "@lwc/synthetic-shadow";
import { createElement } from "lwc";
import HelloWorld from "s/helloWorld";
import PromptInput from "s/promptInput";

console.log("LWC UI initializing...");

const lwcIdAndClasses = {
  "s-hello-world": HelloWorld,
  "s-prompt-input": PromptInput
}

// Communication bridge between VS Code webview and LWC components
window.vscodeAPI = acquireVsCodeApi();

// Function to send messages to VS Code
window.sendMessageToVSCode = function(message) {
  console.log("Sending message to VS Code:", message);
  window.vscodeAPI.postMessage(message);
};

// Listen for messages from VS Code
window.addEventListener('message', event => {
  const message = event.data;
  console.log("Received message from VS Code:", message);
  
  // Handle initialization message
  if (message.type === 'initialize' && window.lwcComponentInstance) {
    if (typeof window.lwcComponentInstance.initialize === 'function') {
      window.lwcComponentInstance.initialize(message.data);
    } else if (typeof window.lwcComponentInstance.showPrompt === 'function') {
      // For prompt input component
      window.lwcComponentInstance.showPrompt(message.data);
    }
  }
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
      const initData = initDataAttr ? JSON.parse(initDataAttr) : null;
      
      console.log(`LWC ID: ${lwcId}`);
      console.log(`Init data:`, initData);

      // Create the LWC element
      const element = createElement(lwcId, { is: lwcIdAndClasses[lwcId] });
      
      // Store reference for message handling
      window.lwcComponentInstance = element;

      appContainer.appendChild(element);
      console.log("✅ LWC component mounted successfully!");
      
      // Initialize the component if it has initialization data
      if (initData && typeof element.initialize === 'function') {
        element.initialize(initData);
      } else if (initData && typeof element.showPrompt === 'function') {
        // For prompt input component
        element.showPrompt(initData);
      }
    } else {
      console.error("❌ App container not found");
    }
  } catch (error) {
    console.error("❌ Error creating LWC component:", error);
  }
});
