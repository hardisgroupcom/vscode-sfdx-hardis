// Simple test script to check if LWC demo loads properly
// This can be run in VS Code Developer Console

// Open the LWC demo webview
console.log('Testing LWC Demo with Lightning Base Components...');

// Execute the command to open LWC demo
vscode.commands.executeCommand('sfdx-hardis.openLwcDemo').then(() => {
  console.log('LWC Demo opened successfully');
  
  // Instructions for manual testing
  console.log(`
    Manual Testing Steps:
    1. The LWC Demo webview should have opened
    2. Check if the Lightning Card has proper styling (white background, border, shadow)
    3. Check if the Lightning Buttons have proper styling:
       - "Say Hello" button should be blue (brand variant)
       - "Clear Message" button should be white with blue text (neutral variant)  
       - "Reset" button should be transparent with blue border (brand-outline variant)
    4. If buttons appear as unstyled HTML, styling is not working
    5. If buttons have proper Lightning styling, the fix was successful
  `);
}).catch(error => {
  console.error('Failed to open LWC Demo:', error);
});
