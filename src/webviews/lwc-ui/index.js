import "@lwc/synthetic-shadow";
import { createElement } from "lwc";
import HelloWorld from "s/helloWorld";
import PromptInput from "s/promptInput";

console.log("LWC UI initializing...");

const lwcIdAndClasses = {
  "s-hello-world": HelloWorld,
  "s-prompt-input": PromptInput
}

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM ready, creating LWC component...");

  try {
    // Find the app container and mount the component
    const appContainer = document.getElementById("app");
    if (appContainer) {
      // Get lwc to instanciate
      const lwcId = appContainer.getAttribute("data-lwc-id");
      console.log(`LWC ID: ${lwcId}`);

      // Create the LWC element
      const element = createElement(lwcId, { is: lwcIdAndClasses[lwcId] });

      appContainer.appendChild(element);
      console.log("✅ LWC component mounted successfully!");
    } else {
      console.error("❌ App container not found");
    }
  } catch (error) {
    console.error("❌ Error creating LWC component:", error);
  }
});
