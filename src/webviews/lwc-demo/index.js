// LWC Demo Webview Entry Point - Simplified following Skyline patterns
import '@lwc/synthetic-shadow';
import { createElement } from 'lwc';
import HelloWorld from 's/helloWorld';

console.log('LWC Demo initializing...');

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready, creating LWC component...');
  
  try {
    // Create the LWC element
    const element = createElement('s-hello-world', { is: HelloWorld });
    
    // Find the app container and mount the component
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.appendChild(element);
      console.log('✅ LWC component mounted successfully!');
    } else {
      console.error('❌ App container not found');
    }
  } catch (error) {
    console.error('❌ Error creating LWC component:', error);
  }
});
