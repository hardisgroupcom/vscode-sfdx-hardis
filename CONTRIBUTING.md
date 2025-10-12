# Contributing to vscode-sfdx-hardis

Thank you for your interest in contributing to the **vscode-sfdx-hardis** extension! This guide will help you set up your development environment and contribute effectively to the project.

## Prerequisites

Before you start contributing, make sure you have the following installed:

- **Node.js** (version 22 or higher)
- **yarn** package manager (we use yarn instead of npm)
- **VS Code Insiders** (recommended for extension development)
- **Git**

## Development Environment Setup

### 1. Fork and Clone the Repository

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/vscode-sfdx-hardis.git
cd vscode-sfdx-hardis

# Add the original repository as upstream
git remote add upstream https://github.com/hardisgroupcom/vscode-sfdx-hardis.git
```

### 2. Install Dependencies

```bash
# Install all dependencies using yarn
yarn install
```

### 3. Open in VS Code Insiders

It's highly recommended to use **VS Code Insiders** for extension development as it provides the latest features and better debugging capabilities:

```bash
# Open the project in VS Code Insiders
code-insiders .
```

## Testing the Extension

### Method 1: Using Run → Start Debugging (Recommended)

1. **Open the project** in VS Code Insiders
2. **Press F5** or go to **Run → Start Debugging**
3. **Select "Launch Extension"** from the debug configuration dropdown (if prompted)
4. A new **Extension Development Host** window will open with your extension loaded
5. You can now test your changes in this development environment

### Method 2: Using the Run and Debug Panel

1. Open the **Run and Debug** panel (Ctrl+Shift+D / Cmd+Shift+D)
2. Select **"Launch Extension"** from the configuration dropdown
3. Click the **green play button** or press F5
4. The Extension Development Host window will launch

### Method 3: Using Tasks

You can also use the predefined tasks for building and watching:

```bash
# Build the extension
yarn build

# Watch for changes (recommended during development)
yarn watch
```

Then use F5 to launch the Extension Development Host.

## Development Workflow

### 1. Create a Feature Branch

```bash
# Create and switch to a new branch for your feature
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

The extension follows this architecture:

- **`src/extension.ts`** - Main extension entry point
- **`src/hardis-commands-provider.ts`** - Command tree view provider
- **`src/hardis-status-provider.ts`** - Status bar and org monitoring
- **`src/hardis-websocket-server.ts`** - WebSocket communication with CLI
- **`src/webviews/`** - LWC UI components for interactive prompts
- **`resources/`** - Icons and static assets

### 3. Testing Your Changes

1. **Start the watch task** (optional but recommended):
   ```bash
   yarn watch
   ```

2. **Launch the debugger** (F5) to open the Extension Development Host

3. **Test your changes** in the development environment:
   - Open a Salesforce project
   - Test the commands you've modified
   - Verify the UI components work correctly

4. **Reload the extension** when needed:
   - Press **Ctrl+R** (Cmd+R on Mac) in the Extension Development Host
   - Or use **Developer: Reload Window** from the Command Palette

### 4. Debugging Tips

- **Set breakpoints** in your TypeScript code - they will work in the debugger
- **Use the Debug Console** to inspect variables and execute code
- **Check the Output panel** for extension logs (select "SFDX Hardis" from the dropdown)
- **Monitor the terminal** for build errors when using watch mode

## Code Quality Guidelines

### TypeScript Conventions

- Follow the existing code style and patterns
- Use proper TypeScript types
- Handle errors gracefully with try/catch blocks

### Command Patterns

All commands should follow the modern Salesforce CLI format:
```bash
sf hardis:category:action [options]
```

**Never use legacy `sfdx` commands** - always use `sf` CLI.

### Example Command Structure

```typescript
{
  id: "unique-command-id",
  label: "Display Name",
  tooltip: "Detailed description with usage guidance",
  command: "sf hardis:category:action",
  requiresProject: boolean,
  helpUrl: "https://sfdx-hardis.cloudity.com/hardis/category/action/"
}
```

## LWC Development (WebViews)

For UI components in `src/webviews/lwc-ui/`:

- **Use Lightning Base Components** when possible
- **Follow SLDS design patterns**
- **Handle accessibility** properly
- **Test with different prompt types** (text, select, multiselect, etc.)

## Testing

### Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch
```

### Manual Testing Checklist

Before submitting your PR, test:

- [ ] Extension activates correctly in a Salesforce project
- [ ] Commands appear in the tree view
- [ ] Status bar shows org information
- [ ] WebSocket prompts work correctly
- [ ] No console errors or warnings
- [ ] Performance is acceptable

## Submitting Your Contribution

### 1. Commit Your Changes

```bash
# Stage your changes
git add .

# Commit with a descriptive message
git commit -m "feat: add new feature description"
```

Follow conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for adding tests

### 2. Push and Create Pull Request

```bash
# Push your branch
git push origin feature/your-feature-name

# Create a Pull Request on GitHub
# - Provide a clear title and description
# - Reference any related issues
# - Include screenshots if UI changes are involved
```

### 3. Pull Request Guidelines

- **Clear description** of what your PR does
- **Reference issues** if applicable (#123)
- **Include screenshots** for UI changes
- **Update documentation** if needed
- **Ensure all tests pass**
- **Follow the code review feedback**

## Getting Help

- **Documentation**: <https://sfdx-hardis.cloudity.com/>
- **Issues**: <https://github.com/hardisgroupcom/sfdx-hardis/issues>
- **Discussions**: Use GitHub Discussions for questions

## Development Resources

### VS Code Extension Development

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)

### Lightning Web Components

- [LWC Developer Guide](https://lwc.dev/)
- [Lightning Design System](https://www.lightningdesignsystem.com/)
- [Lightning Base Components](https://developer.salesforce.com/docs/component-library/overview/components)

### Salesforce CLI

- [Salesforce CLI Command Reference](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/)
- [SFDX Hardis Documentation](https://sfdx-hardis.cloudity.com/)

## Project Structure

```
vscode-sfdx-hardis/
├── src/
│   ├── extension.ts              # Main extension entry point
│   ├── commands.ts              # VS Code command registrations
│   ├── hardis-commands-provider.ts  # Command tree view
│   ├── hardis-status-provider.ts    # Status monitoring
│   ├── hardis-websocket-server.ts   # WebSocket server
│   ├── utils.ts                 # Utility functions
│   ├── webviews/               # LWC UI components
│   │   ├── lwc-ui-panel.ts     # WebView panel manager
│   │   └── lwc-ui/             # Lightning Web Components
│   └── test/                   # Test files
├── resources/                  # Icons and assets
├── package.json               # Extension manifest
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Build configuration
└── README.md                 # Project README
```

## License

By contributing to this project, you agree that your contributions will be licensed under the AGPL-3.0 license.

---

Thank you for contributing to vscode-sfdx-hardis! Your contributions help make Salesforce development more accessible and efficient for developers worldwide.
