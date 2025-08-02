console.log('LWC Demo script loaded');

// Simple fallback implementation without LWC for testing
function createSimpleDemo() {
  console.log('Creating simple demo fallback');
  
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    console.error('App container not found');
    return;
  }
  
  // Clear loading message
  appContainer.innerHTML = '';
  
  // Create a simple demo using SLDS
  appContainer.innerHTML = `
    <div class="slds-card slds-m-around_medium">
      <div class="slds-card__header slds-grid">
        <header class="slds-media slds-media_center slds-has-flexi-truncate">
          <div class="slds-media__figure">
            <span class="slds-icon_container slds-icon-utility-announcement">
              <svg class="slds-icon slds-icon_small" aria-hidden="true">
                <use xlink:href="#utility-announcement"></use>
              </svg>
            </span>
          </div>
          <div class="slds-media__body">
            <h2 class="slds-card__header-title">
              <span class="slds-text-heading_small">Hello World LWC Demo</span>
            </h2>
          </div>
        </header>
      </div>
      <div class="slds-card__body slds-card__body_inner">
        <p class="slds-text-body_regular slds-m-bottom_small">
          Welcome to the SFDX Hardis LWC Demo! This is a proof of concept showing Lightning Web Components in VS Code.
        </p>
        
        <div class="slds-grid slds-gutters slds-m-top_medium">
          <div class="slds-col slds-size_1-of-2">
            <div class="slds-text-align_center">
              <p class="slds-text-heading_medium" id="counter">0</p>
              <p class="slds-text-body_small">Current Count</p>
            </div>
          </div>
          <div class="slds-col slds-size_1-of-2">
            <div class="slds-button-group" role="group">
              <button class="slds-button slds-button_brand" id="increment">
                <svg class="slds-button__icon slds-button__icon_left" aria-hidden="true">
                  <use xlink:href="#utility-add"></use>
                </svg>
                Add
              </button>
              <button class="slds-button slds-button_neutral" id="decrement">
                <svg class="slds-button__icon slds-button__icon_left" aria-hidden="true">
                  <use xlink:href="#utility-dash"></use>
                </svg>
                Subtract
              </button>
              <button class="slds-button slds-button_outline-brand" id="reset">
                <svg class="slds-button__icon slds-button__icon_left" aria-hidden="true">
                  <use xlink:href="#utility-refresh"></use>
                </svg>
                Reset
              </button>
            </div>
          </div>
        </div>
        
        <div class="slds-text-body_small slds-text-color_weak slds-m-top_large">
          <p>This demo shows SLDS styling and interactive functionality within a VS Code webview.</p>
          <p><strong>Framework:</strong> Lightning Web Components + Salesforce Lightning Design System</p>
        </div>
      </div>
    </div>
    
    <!-- Hidden SVG sprites for SLDS icons -->
    <svg xmlns="http://www.w3.org/2000/svg" style="display: none;">
      <defs>
        <symbol id="utility-announcement" viewBox="0 0 520 520">
          <path d="M430 190c-17-54-64-90-120-90s-103 36-120 90h-40c-28 0-50 22-50 50v80c0 28 22 50 50 50h40c17 54 64 90 120 90s103-36 120-90h40c28 0 50-22 50-50v-80c0-28-22-50-50-50h-40zm-120 180c-33 0-60-27-60-60v-40c0-33 27-60 60-60s60 27 60 60v40c0 33-27 60-60 60z"/>
        </symbol>
        <symbol id="utility-add" viewBox="0 0 520 520">
          <path d="M460 230H290V60c0-17-13-30-30-30s-30 13-30 30v170H60c-17 0-30 13-30 30s13 30 30 30h170v170c0 17 13 30 30 30s30-13 30-30V290h170c17 0 30-13 30-30s-13-30-30-30z"/>
        </symbol>
        <symbol id="utility-dash" viewBox="0 0 520 520">
          <path d="M460 230H60c-17 0-30 13-30 30s13 30 30 30h400c17 0 30-13 30-30s-13-30-30-30z"/>
        </symbol>
        <symbol id="utility-refresh" viewBox="0 0 520 520">
          <path d="M260 60c-55 0-105 22-141 58l-26-26c-6-6-15-6-21 0s-6 15 0 21l70 70c6 6 15 6 21 0l70-70c6-6 6-15 0-21s-15-6-21 0l-25 25c27-27 64-43 104-43 80 0 145 65 145 145s-65 145-145 145c-62 0-115-39-135-94-3-8-12-12-20-9s-12 12-9 20c26 71 93 123 174 123 100 0 180-80 180-180S360 60 260 60z"/>
        </symbol>
      </defs>
    </svg>
  `;
  
  // Add interactive functionality
  let count = 0;
  const counterEl = document.getElementById('counter');
  const incrementBtn = document.getElementById('increment');
  const decrementBtn = document.getElementById('decrement');
  const resetBtn = document.getElementById('reset');
  
  function updateCounter() {
    if (counterEl) {
      counterEl.textContent = count.toString();
    }
  }
  
  if (incrementBtn) {
    incrementBtn.addEventListener('click', () => {
      count++;
      updateCounter();
      console.log('Count incremented to:', count);
    });
  }
  
  if (decrementBtn) {
    decrementBtn.addEventListener('click', () => {
      count--;
      updateCounter();
      console.log('Count decremented to:', count);
    });
  }
  
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      count = 0;
      updateCounter();
      console.log('Count reset to:', count);
    });
  }
  
  console.log('Simple demo created successfully');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createSimpleDemo);
} else {
  createSimpleDemo();
}
