# LWC Webview Demo

This demonstrates how to embed Lightning Web Components (LWC) in VS Code webviews using SLDS styling.

## Features

- ✅ Lightning Web Components framework integration
- ✅ Salesforce Lightning Design System (SLDS) styling
- ✅ Reactive data binding with `@track` decorator
- ✅ Interactive button handlers
- ✅ VS Code webview integration
- ✅ Webpack bundling for LWC components

## File Structure

```
src/webviews/lwc-demo/
├── index.js                           # Entry point for LWC app
├── modules/s/helloWorld/
│   ├── helloWorld.js                  # LWC component JavaScript
│   ├── helloWorld.html                # LWC component template
│   └── helloWorld.css                 # LWC component styles
└── lwc-demo-panel.ts                  # VS Code webview panel provider
```

## How to Use

1. Open VS Code with the SFDX Hardis extension
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run `SFDX Hardis: LWC Demo`
4. Or click the preview icon in the SFDX Hardis Commands view

## Technical Implementation

### LWC Component (`helloWorld.js`)
- Uses Lightning Web Components framework
- Implements reactive properties with `@track`
- Handles user interactions with event handlers

### VS Code Integration (`lwc-demo-panel.ts`)
- Creates webview panels with proper security
- Loads SLDS CSS from node_modules
- Serves bundled LWC JavaScript
- Manages webview lifecycle

### Webpack Configuration
- Separate webpack config for LWC webview
- Uses `@lwc/babel-plugin-component` for LWC transformation
- Bundles LWC components for browser execution
- Includes source maps for debugging

## Dependencies

The following packages are required:
- `@lwc/engine-dom` - LWC runtime for DOM
- `@lwc/synthetic-shadow` - Shadow DOM polyfill
- `@salesforce-ux/design-system` - SLDS CSS and assets
- `lwc-webpack-plugin` - Webpack plugin for LWC
- `@lwc/babel-plugin-component` - Babel transformer for LWC

## Inspiration

Based on:
- [VS Code Extension with LWC Blog](https://developer.salesforce.com/blogs/2021/04/how-to-build-a-webview-powered-vs-code-extension-with-lightning-web-components)
- [LWC Builder Repository](https://github.com/forcedotcom/lwc-builder)
- [Skyline Extension](https://github.com/mitchspano/Skyline)
