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
      
      console.log(`LWC ID: ${lwcId}`);
      
      let initData = null;
      if (initDataAttr && initDataAttr !== '{}') {
        try {
          // Decode HTML entities first
          const decodedData = initDataAttr.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
          initData = JSON.parse(decodedData);
        } catch (parseError) {
          console.error('Error parsing init data:', parseError);
        }
      }

      // Create the LWC element
      const lwcClass = lwcIdAndClasses[lwcId];
      if (!lwcClass) {
        console.error(`❌ No LWC class found for ID: ${lwcId}`);
        return;
      }

      const element = createElement(lwcId, { is: lwcClass });
      
      // Store reference for message handling
      window.lwcComponentInstance = element;

      // Add element to DOM first
      appContainer.appendChild(element);
      console.log("✅ LWC component mounted successfully!");
      
      // Wait a bit for the component to fully initialize
      setTimeout(() => {
        // Initialize the component if it has initialization data
        if (initData) {
          if (typeof element.initialize === 'function') {
            element.initialize(initData);
          } else if (typeof element.showPrompt === 'function') {
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
