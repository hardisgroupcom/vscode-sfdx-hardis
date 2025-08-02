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
      try {
        await injectSLDSResources(element);
        
        // Additional debugging after injection
        setTimeout(() => {
          const shadowRoot = element.shadowRoot;
          if (!shadowRoot) {
            console.error('❌ No shadow root available for post-injection analysis');
            return;
          }
          
          console.log('Post-injection shadow root analysis:');
          console.log('Shadow root children count:', shadowRoot.children.length);
          console.log('Shadow root HTML:', shadowRoot.innerHTML.substring(0, 500) + '...');
          
          // Check for SLDS styles
          const sldsStyles = shadowRoot.querySelector('style[data-source="slds-injected"]');
          if (sldsStyles) {
            console.log('✅ SLDS styles found in shadow root, length:', sldsStyles.textContent.length);
            console.log('First 200 chars of CSS:', sldsStyles.textContent.substring(0, 200));
          } else {
            console.error('❌ SLDS styles not found in shadow root');
          }
          
          // Check for SVG sprites
          const svgSprites = shadowRoot.querySelector('#slds-utility-sprites-shadow');
          if (svgSprites) {
            console.log('✅ SVG sprites found in shadow root');
          } else {
            console.warn('⚠️ SVG sprites not found in shadow root');
          }
          
          // Try to check computed styles on a specific SLDS element
          const sldsCard = shadowRoot.querySelector('.slds-card');
          if (sldsCard) {
            const cardStyles = window.getComputedStyle(sldsCard);
            console.log('SLDS Card computed styles:');
            console.log('  background-color:', cardStyles.backgroundColor);
            console.log('  border:', cardStyles.border);
            console.log('  padding:', cardStyles.padding);
            console.log('  border-radius:', cardStyles.borderRadius);
          } else {
            console.warn('⚠️ No .slds-card element found in shadow root');
          }
        }, 200);
        
      } catch (injectionError) {
        console.error('❌ SLDS injection failed:', injectionError);
      }
      
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
    const shadowRoot = element.shadowRoot;
    
    if (!shadowRoot) {
      console.error('❌ No shadow root found on LWC element');
      return;
    }
    
    console.log('Found shadow root, injecting SLDS resources...');
    console.log('Shadow root type:', shadowRoot.mode);
    console.log('Shadow root host:', shadowRoot.host);
    
    // 1. Inject SLDS CSS by fetching the content and creating a style element
    const documentSldsLink = document.querySelector('link[rel="stylesheet"]');
    if (documentSldsLink && documentSldsLink.href.includes('slds')) {
      try {
        console.log('Fetching SLDS CSS content from:', documentSldsLink.href);
        const response = await fetch(documentSldsLink.href);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        let cssContent = await response.text();
        console.log('SLDS CSS fetched, length:', cssContent.length);
        
        // Process the CSS to ensure it works in shadow DOM
        // Remove any scoping that might interfere with shadow DOM
        cssContent = cssContent.replace(/\.slds-scope\s+/g, '');
        cssContent = cssContent.replace(/\.slds-scope,/g, '');
        cssContent = cssContent.replace(/\.slds-scope/g, ':host');
        
        // Create a style element with the processed CSS content
        const styleElement = document.createElement('style');
        styleElement.textContent = cssContent;
        styleElement.setAttribute('data-source', 'slds-injected');
        
        // Insert at the beginning of shadow root
        shadowRoot.insertBefore(styleElement, shadowRoot.firstChild);
        console.log('✅ SLDS CSS injected into shadow root');
        
      } catch (cssError) {
        console.error('❌ Error processing SLDS CSS:', cssError);
        throw cssError;
      }
    } else {
      console.error('❌ SLDS CSS link not found in document');
      console.log('Available stylesheets:', Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => link.href));
      throw new Error('SLDS CSS link not found');
    }
    
    // 2. Fetch and inject the actual SLDS utility symbols SVG
    const utilitySymbolsUri = window.SLDS_UTILITY_SYMBOLS_URI;
    if (utilitySymbolsUri) {
      try {
        console.log('Fetching SLDS utility symbols from:', utilitySymbolsUri);
        const response = await fetch(utilitySymbolsUri);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
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
    
  } catch (error) {
    console.error('❌ Error injecting SLDS resources:', error);
    throw error;
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLWC);
} else {
  initializeLWC();
}
