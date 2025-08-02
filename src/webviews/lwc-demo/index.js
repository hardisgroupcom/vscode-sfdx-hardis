// LWC Demo Webview Entry Point
import { createElement } from 'lwc';
import HelloWorld from 's/helloWorld';

console.log('LWC Demo script starting...');

// Initialize the LWC component when DOM is ready
function initializeLWC() {
  console.log('Creating LWC component...');
  
  try {
    // Create the LWC element
    const element = createElement('s-hello-world', { is: HelloWorld });
    console.log('LWC element created:', element);
    
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
    
    // Add a small delay to check if the component rendered
    setTimeout(() => {
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

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLWC);
} else {
  initializeLWC();
}
