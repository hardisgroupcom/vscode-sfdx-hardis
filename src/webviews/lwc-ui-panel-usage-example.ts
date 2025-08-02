// Example usage of LwcUiPanel with onMessage listener
import * as vscode from "vscode";
import { LwcUiPanel } from "./lwc-ui-panel";

/**
 * Example demonstrating how to use the LwcUiPanel with message listeners
 */
export function exampleLwcUiPanelUsage(context: vscode.ExtensionContext) {
  // Create and display the LWC UI panel
  const lwcPanel = LwcUiPanel.display(context.extensionUri, "s-hello-world");
  
  // Register a message listener
  const unsubscribe = lwcPanel.onMessage((messageType, data) => {
    console.log(`Message Type: ${messageType}`);
    console.log(`Data: ${JSON.stringify(data)}`);
    
    // Handle different message types
    switch (messageType) {
      case 'button-click':
        handleButtonClick(data);
        break;
      case 'form-submit':
        handleFormSubmit(data);
        break;
      case 'user-action':
        handleUserAction(data);
        break;
      default:
        console.log(`Unhandled message type: ${messageType}`);
    }
  });
  
  // Register multiple listeners if needed
  const secondListener = lwcPanel.onMessage((messageType, _data) => {
    // This could be for analytics, logging, etc.
    console.log(`Analytics: User performed ${messageType} action`);
  });
  
  // Clean up listeners when extension is deactivated or panel is disposed
  context.subscriptions.push(
    { dispose: unsubscribe },
    { dispose: secondListener }
  );
}

function handleButtonClick(data: any) {
  console.log('Handling button click:', data);
  // Implement button click logic
}

function handleFormSubmit(data: any) {
  console.log('Handling form submit:', data);
  // Implement form submission logic
}

function handleUserAction(data: any) {
  console.log('Handling user action:', data);
  // Implement generic user action logic
}

/**
 * Advanced usage example with conditional listener registration
 */
export function advancedLwcUiPanelUsage(context: vscode.ExtensionContext) {
  const lwcPanel = LwcUiPanel.display(context.extensionUri, "advanced-component");
  
  // Create a cleanup array for managing multiple listeners
  const cleanupFunctions: (() => void)[] = [];
  
  // Register different listeners based on conditions
  if (vscode.workspace.getConfiguration().get('lwcUi.enableAnalytics')) {
    const analyticsUnsubscribe = lwcPanel.onMessage((messageType, data) => {
      // Send analytics data
      console.log(`Analytics: ${messageType}`, data);
    });
    cleanupFunctions.push(analyticsUnsubscribe);
  }
  
  if (vscode.workspace.getConfiguration().get('lwcUi.enableLogging')) {
    const loggingUnsubscribe = lwcPanel.onMessage((messageType, data) => {
      // Log to output channel
      console.log(`Log: ${new Date().toISOString()} - ${messageType}`, data);
    });
    cleanupFunctions.push(loggingUnsubscribe);
  }
  
  // Main message handler
  const mainUnsubscribe = lwcPanel.onMessage((messageType, data) => {
    // Main application logic
    handleMainLogic(messageType, data);
  });
  cleanupFunctions.push(mainUnsubscribe);
  
  // Register cleanup
  context.subscriptions.push({
    dispose: () => {
      cleanupFunctions.forEach(cleanup => cleanup());
    }
  });
}

function handleMainLogic(messageType: string, data: any) {
  // Main application logic implementation
  console.log(`Main logic handling: ${messageType}`, data);
}
