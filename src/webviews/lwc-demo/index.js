// LWC Demo Webview Entry Point
import { createElement } from 'lwc';
import HelloWorld from 's/helloWorld';

// Configure synthetic shadow DOM for global style penetration
if (typeof window !== 'undefined') {
  window.lwcRuntimeFlags = window.lwcRuntimeFlags || {};
  window.lwcRuntimeFlags.ENABLE_SYNTHETIC_SHADOW_SUPPORT_FOR_TEMPLATE = true;
}

console.log('LWC Demo script starting with synthetic shadow DOM...');

// Initialize the LWC component when DOM is ready
function initializeLWC() {
  console.log('Creating LWC component...');
  
  try {
    // Create the LWC element (synthetic shadow mode is configured via webpack and runtime flags)
    const element = createElement('s-hello-world', { is: HelloWorld });
    console.log('LWC element created with synthetic shadow:', element);
    
    // Find the app container
    const appContainer = document.getElementById('app');
    if (!appContainer) {
      console.error('App container not found');
      return;
    }
    
    console.log('App container found, mounting component...');
    
    // Clear any existing content and append the component
    appContainer.innerHTML = '';
    appContainer.appendChild(element);
    
    console.log('✅ LWC component mounted successfully!');
    
    // Inject SLDS styles into the component's shadow root after mounting
    setTimeout(async () => {
      await injectSLDSStyles(element);
      
      console.log('Component HTML after mount:', appContainer.innerHTML);
      console.log('Component children count:', appContainer.children.length);
      if (appContainer.children.length > 0) {
        console.log('✅ LWC component is visible in DOM');
        console.log('Component tag name:', appContainer.children[0].tagName);
      } else {
        console.warn('⚠️ LWC component not visible in DOM');
      }
    }, 100);
    
  } catch (error) {
    console.error('❌ Error initializing LWC:', error);
    console.error('Error stack:', error.stack);
  }
}

// Function to inject SLDS styles into the component's shadow root
async function injectSLDSStyles(element) {
  try {
    // Get the shadow root of the LWC element
    const shadowRoot = element.shadowRoot || element;
    
    if (shadowRoot) {
      // Get the SLDS CSS link from the document head to use the correct webview URI
      const documentSldsLink = document.querySelector('link[href*="slds.css"]');
      
      if (documentSldsLink) {
        console.log('Found SLDS link, fetching CSS content...');
        
        try {
          // Fetch the CSS content
          const response = await fetch(documentSldsLink.href);
          const cssContent = await response.text();
          
          // Create a style element with the CSS content
          const styleElement = document.createElement('style');
          styleElement.textContent = cssContent;
          
          // Inject the style element into the shadow root
          shadowRoot.appendChild(styleElement);
          console.log('✅ SLDS styles injected as style element into shadow root');
          
        } catch (fetchError) {
          console.error('❌ Error fetching SLDS CSS:', fetchError);
          
          // Fallback: try link element approach
          const sldsLink = document.createElement('link');
          sldsLink.rel = 'stylesheet';
          sldsLink.href = documentSldsLink.href;
          shadowRoot.appendChild(sldsLink);
          console.log('✅ SLDS styles injected as link fallback');
        }
      } else {
        console.warn('⚠️ Could not find SLDS link in document head');
      }
    } else {
      console.warn('⚠️ No shadow root found, using document-level styles');
    }
  } catch (error) {
    console.error('❌ Error injecting SLDS styles:', error);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLWC);
} else {
  initializeLWC();
}
