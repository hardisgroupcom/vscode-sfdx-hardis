// LWC Demo Webview Entry Point
import { createElement } from 'lwc';
import HelloWorld from 's/helloWorld';

// Configure synthetic shadow DOM for global style penetration
if (typeof window !== 'undefined') {
  window.lwcRuntimeFlags = window.lwcRuntimeFlags || {};
  window.lwcRuntimeFlags.ENABLE_SYNTHETIC_SHADOW_SUPPORT_FOR_TEMPLATE = true;
  window.lwcRuntimeFlags.ENABLE_SYNTHETIC_SHADOW_SUPPORT_FOR_STYLE = true;
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
    
    // Inject SLDS resources into the shadow DOM after mounting
    setTimeout(async () => {
      await injectSLDSResources(element);
      
      console.log('Component HTML after mount:', appContainer.innerHTML);
      console.log('Component children count:', appContainer.children.length);
      if (appContainer.children.length > 0) {
        console.log('✅ LWC component is visible in DOM');
        console.log('Component tag name:', appContainer.children[0].tagName);
        
        // Check if SLDS styles are being applied by looking for computed styles
        const computedStyle = window.getComputedStyle(appContainer.children[0]);
        console.log('Component display style:', computedStyle.display);
        console.log('Component font-family:', computedStyle.fontFamily);
      } else {
        console.warn('⚠️ LWC component not visible in DOM');
      }
    }, 100);
    
  } catch (error) {
    console.error('❌ Error initializing LWC:', error);
    console.error('Error stack:', error.stack);
  }
}

// Function to inject SLDS styles and SVG sprites into the component's shadow root
async function injectSLDSResources(element) {
  try {
    // Get the shadow root of the LWC element
    const shadowRoot = element.shadowRoot || element;
    
    if (shadowRoot) {
      console.log('Found shadow root, injecting SLDS resources...');
      
      // 1. Inject SLDS CSS link
      const documentSldsLink = document.querySelector('link[href*="slds.css"]');
      if (documentSldsLink) {
        const sldsLink = document.createElement('link');
        sldsLink.rel = 'stylesheet';
        sldsLink.href = documentSldsLink.href;
        shadowRoot.appendChild(sldsLink);
        console.log('✅ SLDS CSS link injected into shadow root');
      }
      
      // 2. Fetch and inject the actual SLDS utility symbols SVG
      const utilitySymbolsUri = window.SLDS_UTILITY_SYMBOLS_URI;
      if (utilitySymbolsUri) {
        try {
          console.log('Fetching SLDS utility symbols from:', utilitySymbolsUri);
          const response = await fetch(utilitySymbolsUri);
          const svgContent = await response.text();
          
          // Create a container div for the SVG sprites
          const svgContainer = document.createElement('div');
          svgContainer.innerHTML = svgContent;
          svgContainer.style.display = 'none';
          svgContainer.id = 'slds-utility-sprites-shadow';
          
          // Inject the SVG sprites into the shadow root
          shadowRoot.appendChild(svgContainer);
          console.log('✅ SLDS utility symbols injected into shadow root');
          
        } catch (fetchError) {
          console.error('❌ Error fetching SLDS utility symbols:', fetchError);
        }
      } else {
        console.warn('⚠️ SLDS utility symbols URI not found');
      }
      
      console.log('✅ SLDS resources injection completed');
      
    } else {
      console.warn('⚠️ No shadow root found, using document-level styles');
    }
  } catch (error) {
    console.error('❌ Error injecting SLDS resources:', error);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLWC);
} else {
  initializeLWC();
}
