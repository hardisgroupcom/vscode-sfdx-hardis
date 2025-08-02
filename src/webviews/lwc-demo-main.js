// LWC Demo Webview Entry Point
import { createElement } from 'lwc';
import { lwcRenderOptions } from 'lwc-engine-dom';
import HelloWorld from 's/helloWorld';

console.log('LWC Demo starting...');

// Initialize the LWC component when DOM is ready
function initializeLWC() {
  try {
    console.log('Creating LWC component...');
    
    // Create the LWC element
    const element = createElement('s-hello-world', { is: HelloWorld });
    
    // Find the app container
    const appContainer = document.getElementById('app');
    if (!appContainer) {
      console.error('App container not found');
      return;
    }
    
    // Clear loading message
    appContainer.innerHTML = '';
    
    // Append the component to the DOM
    appContainer.appendChild(element);
    
    console.log('LWC component mounted successfully');
  } catch (error) {
    console.error('Error initializing LWC:', error);
    
    // Show fallback content
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.innerHTML = `
        <div class="slds-card slds-m-around_medium">
          <div class="slds-card__header slds-grid">
            <header class="slds-media slds-media_center slds-has-flexi-truncate">
              <div class="slds-media__figure">
                <span class="slds-icon_container slds-icon-utility-error">
                  <span class="slds-icon slds-icon_small" style="background: red; width: 16px; height: 16px;"></span>
                </span>
              </div>
              <div class="slds-media__body">
                <h2 class="slds-card__header-title">
                  <span class="slds-text-heading_small">LWC Demo Error</span>
                </h2>
              </div>
            </header>
          </div>
          <div class="slds-card__body slds-card__body_inner">
            <p>Failed to load Lightning Web Component.</p>
            <p><strong>Error:</strong> ${error.message}</p>
            <div class="slds-text-body_small slds-m-top_medium">
              <p>This is a fallback display showing that the webview is working, but the LWC failed to initialize.</p>
            </div>
          </div>
        </div>
      `;
    }
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLWC);
} else {
  initializeLWC();
}
