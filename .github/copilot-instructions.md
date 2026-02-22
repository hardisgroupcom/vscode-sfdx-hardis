# GitHub Copilot Instructions for vscode-sfdx-hardis

## Github Copilot behavior

Act like Claude 4 even when using another model: explain your reasoning step by step and update code incrementally.
Ensure best practices are followed, and refactor when necessary.

## Project Overview

This is a **Visual Studio Code extension** that provides an intuitive UI for **SFDX Hardis**, a comprehensive Salesforce DX toolkit that simplifies Salesforce development, deployment, and CI/CD processes. The extension allows users to manage Salesforce projects without requiring deep knowledge of SFDX or Git commands.

**Key Facts:**
- Extension publisher: `NicolasVuillamy`
- Main CLI dependency: `sfdx-hardis` plugin for Salesforce CLI
- Target users: Both beginner consultants and expert developers
- License: AGPL-3.0
- Documentation: <https://sfdx-hardis.cloudity.com/>

## Architecture

### Core Technologies
- **TypeScript** - Main development language
- **VS Code Extension API** - Extension framework
- **Salesforce CLI (`sf`)** - Modern CLI commands (not legacy `sfdx`)
- **Node.js Worker Threads** - Performance optimization
- **WebSocket Server** - Real-time communication with CLI
- **webpack** - Bundling and build system
- **yarn** - NPM packages manager (so use `yarn` commands instead of `npm`)
- **LWC**: Salesforce lightning web components for UI

### Utilities and Config Management
- **src/utils/** contains helpers for caching, config, org, string operations, and git PR button logic.
- **src/utils/pipeline/sfdxHardisConfigHelper.ts**: Singleton per workspace, loads config schema (remote/local), merges global/branch config, exposes config fields/sections for LWC editors, and saves config from LWC UI. Only fields in `CONFIGURABLE_FIELDS` are exposed, grouped by `SECTIONS`.
- **Config schema** is loaded from a remote URL or local fallback. LWC config editors use this schema for field rendering and validation.

### Main Components

#### 1. Extension Entry Point (`src/extension.ts`)
- Activates on SFDX project detection or Apex language
- Initializes telemetry, providers, WebSocket server
- Manages configuration changes and file watchers

#### 2. Command System (`src/hardis-commands-provider.ts`)
- Tree view provider for organized command structure
- 200+ predefined commands across categories:
  - **CI/CD Simple**: Basic workflow commands
  - **CI/CD Advanced**: Expert development commands  
  - **Data Import/Export**: SFDMU integration
  - **Debugger**: Apex debugging tools
  - **Org Operations**: User management, monitoring
  - **Packaging**: Package creation and versioning
  - **Documentation**: Flow diagrams, project docs
  - **Metadata Analysis**: Auditing and cleanup
  - **Configuration**: Project and CI setup

#### 3. Status Monitoring (`src/hardis-status-provider.ts`)
- Displays current org info, expiration dates
- Shows git repository status and branch info
- Monitors project health and configuration
- Provides org color theming for environment awareness

#### 4. Dependency Management (`src/hardis-plugins-provider.ts`)
- Tracks SFDX plugins and versions
- Monitors VS Code extensions
- Provides update notifications
- Supports custom plugin configurations

#### 5. WebSocket Communication (`src/hardis-websocket-server.ts`)
- Enables UI prompts instead of terminal input
- Handles real-time status updates
- Manages file opening requests
- Port range: 2702-2784 (configurable via env var)

## Development Guidelines

### Command Patterns

All commands follow the modern Salesforce CLI format:
```bash
sf hardis:category:action [options]
```

**Never use legacy `sfdx` commands** - always use `sf` CLI.

### Code Style

Always use {} after `if`, `else`, `for`, `while`, even for single statements.

Always go to the next line after `{` and before `}`.

Example:

```
if (condition) {
  // Do something
} 
else {
  // Do something else
}
```

In the HTML of LWC components, you can NOT use ternaries or expression evaluations.

### TypeScript Conventions

#### TreeDataProvider Implementation
```typescript
export class HardisCommandsProvider implements vscode.TreeDataProvider<CommandTreeItem> {
  getTreeItem(element: CommandTreeItem): vscode.TreeItem
  getChildren(element?: CommandTreeItem): Thenable<CommandTreeItem[]>
  refresh(keepCache: boolean): void
}
```

#### Command Structure
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

#### Error Handling Pattern
```typescript
try {
  const result = await execSfdxJson("sf hardis:command");
  // Handle success
} catch (error) {
  Logger.log(`Error executing command: ${error.message}`);
  vscode.window.showErrorMessage("User-friendly error message");
}
```

### Performance Best Practices

#### Caching Strategy
- Use `utils.ts` cache functions for expensive operations
- Cache org info, git status, plugin versions
- Implement lazy loading for tree views
- Use `preLoadCache()` for startup optimization

#### Multithread Support
```typescript
// Check multithread capability
if (isMultithreadActive()) {
  // Use worker threads for CLI operations
  const worker = new Worker('./worker.js');
}
```

#### Background Operations
```typescript
// Use `--skipauth` for performance when appropriate
const command = "sf hardis:org:list --skipauth";
```

## Configuration Management

### Local Configuration (`.sfdx-hardis.yml`)
```yaml
customCommands:
  - id: custom-section
    label: Custom Commands
    commands:
      - id: my-command
        label: My Custom Command
        command: sf my:custom:command
        tooltip: Description
        requiresProject: true

customPlugins:
  - name: my-custom-plugin
    helpUrl: https://example.com/docs
```

### VS Code Settings
Key extension settings in `package.json`:
- `vsCodeSfdxHardis.userInput`: UI vs terminal prompts
- `vsCodeSfdxHardis.customCommandsConfiguration`: External config URL
- `vsCodeSfdxHardis.enableMultithread`: Performance optimization
- `vsCodeSfdxHardis.disableVsCodeColors`: Org-based theming
- `vsCodeSfdxHardis.colorUpdateLocation`: Org-based theming update location (Workspace- or User settings)
- `vsCodeSfdxHardis.theme.menuIconType`: Icon theme selection

### Remote Configuration
Supports loading configuration from URLs:
```typescript
const remoteConfig = await loadExternalSfdxHardisConfiguration();
```

## User Experience Guidelines

### Command Categories
1. **Simple (CI/CD)**: For non-technical users
   - Start new User Story
   - Pull from org
   - Save/publish User Story

2. **Advanced (CI/CD)**: For technical users  
   - Push to org
   - Package installation
   - Apex testing
   - Deployment simulation

3. **Expert (Nerdy Stuff)**: For power users
   - Git delta generation
   - Package.xml manipulation
   - Metadata retrieval

### Theming and Icons
- Supports two icon themes: VS Code native or Hardis custom SVG
- Org-based color theming (red for production, blue for sandboxes)
- Emoji support in section titles (configurable)

### Tooltips and Help
- Every command must have descriptive tooltips
- Include usage guidance and prerequisites
- Link to comprehensive documentation at sfdx-hardis.cloudity.com
- Show clear error messages with actionable guidance


## Lightning Web Components (LWC) UI & Message Exchange Architecture

### LWC Usage in the Extension
- All custom UI in the extension is implemented using Lightning Web Components (LWC), rendered in VS Code webviews.
- LWC is used for user prompts, command execution logs, pipeline views, and other interactive panels.
- SLDS (Salesforce Lightning Design System) is the default styling system. Avoid custom CSS unless SLDS cannot provide the required style.
- LWC base components are located in `node_modules/@salesforce-ux/design-system/ui/components`.

#### LWC UI Structure
- **src/webviews/lwc-ui/index.js**: LWC webview bootstrapper, instantiates components, and routes messages.
- **src/webviews/lwc-ui/modules/s/**: Contains LWC modules for command execution, extension config, pipeline, pipeline config, prompt input, and help text. Each module has `.js`, `.html`, `.css` files and uses SLDS for styling.
- LWC config editors (extension config, pipeline config) receive schema and config data from the extension, render fields by section, and send save requests back to the extension.

### LWC/VS Code Message Exchange Pattern

#### 1. Initialization
- When a webview is created, the extension injects an `#app` container with `data-lwc-id` and `data-init-data` attributes.
- The LWC bootstrap (`index.js`) reads these attributes, instantiates the correct LWC component, and passes initialization data.
- The extension sends an `initialize` message to the LWC component after the DOM is ready, containing any required data (e.g., pipeline info, PR button info, command context).

#### 1a. Config Editor Workflow
- The extension provides config schema and values (global/branch) to the LWC config editor panel.
- LWC config editors render fields by section, allow editing, and send save requests to the extension.
- The extension saves config using `SfdxHardisConfigHelper.saveConfigFromEditor`, writing to the appropriate YAML file (global or branch).

#### 2. Message Bridge
- Communication is strictly message-based using `window.sendMessageToVSCode(message)` and `window.addEventListener('message', ...)`.
- LWC components send messages to the extension using `window.sendMessageToVSCode`.
- The extension listens for messages from the webview and routes them to built-in handlers or custom listeners.

#### 3. Built-in Message Types (from LWC to Extension)
- `openExternal`: Open a URL in the user's browser.
- `runCommand`: Execute a VS Code command.
- `refreshPipeline`, `refreshStatus`, `refreshCommands`, `refreshPlugins`: Refresh various tree views.
- `openFile`, `downloadFile`, `fileExistsCheck`: File operations (open, download, check existence).
- `panelDisposed`: Notify extension that the panel was closed.

#### 4. Built-in Message Types (from Extension to LWC)
- `initialize`: Initial data for the LWC component (context, config, etc.).
- `addLogLine`, `addSubCommandStart`, `addSubCommandEnd`: Command execution log events.
- `reportFile`: Notify LWC of a generated report file.
- `completeCommand`: Notify LWC that a command has finished (success, error, or aborted).
- `refreshPipeline`: Instruct LWC to refresh pipeline data.

#### 5. Custom Message Types
- Custom messages are used for specific workflows (e.g., prompt input, pipeline PR button, etc.).
- Example: The pipeline LWC receives a `prButtonInfo` object in its initialization data, containing the PR/MR button label and URL, calculated by the extension.

#### 6. Message Handling in LWC
- Each LWC component exposes `initialize(data)` and/or `handleMessage(type, data)` methods.
- The bootstrapper (`index.js`) routes incoming messages to these methods.
- For prompt input, the method may be `showPrompt(data)`.

#### 7. Command Execution Flow
- When a CLI command is run, the extension opens a command execution LWC panel with context data.
- The extension streams log lines, subcommand events, and completion status to the LWC via messages.
- The LWC can send cancellation or user input messages back to the extension.

#### 8. Pipeline PR/MR Button Workflow
- The extension detects the git provider and remote URL, calculates the PR/MR page URL and label using a utility (`getPullRequestButtonInfo`).
- This info is passed in the initialization data to the pipeline LWC.
- The LWC displays a dynamic button (e.g., "View PULL REQUESTS on GITHUB").
- When clicked, the LWC sends an `openExternal` message with the URL; the extension opens it in the browser.

#### 9. Security and Validation
- All messages are validated and sanitized before being acted upon.
- Only whitelisted commands and URLs are allowed from the LWC to the extension.

#### 10. Extensibility
- New message types should be documented and handled in both the LWC and extension message routers.
- Prefer message-based protocols for all LWC/VS Code interactions for maintainability and testability.

### LWC UI Best Practices
- Use SLDS classes for all layout and styling; avoid custom CSS unless necessary.
- Place all imports at the top of files.
- Centralize logic (e.g., PR/MR URL calculation) in utilities and import them where needed.
- Document all public LWC component APIs (initialization data, message types, events).

### Example: LWC/VS Code Message Exchange

**From Extension to LWC:**
```js
panel.webview.postMessage({
  type: "initialize",
  data: { prButtonInfo: { label: "View PULL REQUESTS on GITHUB", url: "https://github.com/org/repo/pulls" }, ... }
});
```

**From LWC to Extension:**
```js
window.sendMessageToVSCode({ type: "openExternal", data: "https://github.com/org/repo/pulls" });
```

**LWC Message Handler:**
```js
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "initialize") {
    this.initialize(message.data);
  }
  // ...
});
```

## Custom Webviews with LWC

### Guidelines for Implementing and Maintaining Custom Webviews
- Use Lightning Web Components (LWC) for all custom webview UIs in the extension. Each webview should be modular, maintainable, and leverage the LWC lifecycle.
- Webview entry points should be in `src/webviews/` and LWC modules in `src/webviews/lwc-ui/modules/`.
- Always use the VS Code Webview API to securely load and communicate with LWC-based UIs. Never expose sensitive data or APIs directly to the webview context.
- Use the provided WebSocket server for real-time communication between the extension host and LWC webviews. Prefer message-based protocols for all interactions.
- When handling user input or command execution in a webview, always validate and sanitize data before passing it to the backend or CLI.
- For UI consistency, use SLDS (Salesforce Lightning Design System) and LWC base components. Avoid custom CSS unless absolutely necessary and prefer SLDS utility classes.
- Document the public API (events, messages, properties) of each custom LWC webview component in code comments and in the project documentation.
- When updating or refactoring a webview, ensure backward compatibility for message formats and UI state where possible.
- Test webviews in both light and dark VS Code themes, and with different org color settings if applicable.
- For new features, add integration tests that simulate user interaction with the LWC webview and verify correct extension-host communication.
- See `src/webviews/lwc-ui/modules/` for examples of best practices in LWC webview structure and communication.

#### Extending Config Schema and Editors
- To add new config fields:
  1. Add to `CONFIGURABLE_FIELDS` in `sfdxHardisConfigHelper.ts`.
  2. Update the schema (remote/local) as needed.
  3. Add to the appropriate section in `SECTIONS`.
  4. LWC config editors will automatically reflect new fields if schema is updated.
- To add new LWC panels:
  1. Create a new folder in `modules/s/` with `.js`, `.html`, `.css`.
  2. Register the panel in the extension.
  3. Use the message protocol for communication.

## Integration Points

### Salesforce CLI Integration
```typescript
// Execute CLI commands with JSON output
const result = await execSfdxJson("sf org list --all");

// Handle authentication checks
if (!options.skipAuth) {
  // Verify org authentication before command
}
```

### Git Integration
```typescript
import simpleGit from 'simple-git';
const git = simpleGit();
const status = await git.status();
```

### VS Code Extension Dependencies
Required extensions:
- Salesforce Extension Pack (`salesforce.salesforcedx-vscode`)

### External Tools
- **SFDMU**: Salesforce Data Move Utility for data operations
- **sfdx-git-delta**: For package.xml generation
- **MkDocs**: For documentation generation (requires Python)

## Testing and Quality

### Code Quality Tools
- **ESLint**: TypeScript linting
- **Prettier**: Code formatting  
- **jscpd**: Duplicate code detection
- **MegaLinter**: Comprehensive code analysis

### Extension Guidelines
- Follow VS Code Extension Guidelines strictly
- Respect telemetry settings (anonymous usage only)
- Handle activation events properly
- Manage extension lifecycle correctly

### Performance Monitoring
```typescript
// Telemetry for command usage (anonymized)
reporter.sendTelemetryEvent("command", {
  command: truncatedCommand // Only first 2 parts: "sf hardis"
});
```

## Security Considerations

### Sensitive Data Handling
- Never log usernames, org URLs with tokens, or passwords
- Use VS Code secret storage for credentials when needed
- Validate all user inputs before CLI execution
- Handle authentication securely through Salesforce CLI

### Command Validation
```typescript
// Validate WebSocket commands
if (!command.startsWith("sf hardis") || command.includes("&&")) {
  Logger.log("Invalid command blocked");
  return;
}
```

## Common Workflows

### Adding New Commands
1. Add command definition to appropriate section in `hardis-commands-provider.ts`
2. Include proper tooltip with usage guidance
3. Set `requiresProject: true` if SFDX project needed
4. Add icon mapping in `themeUtils.ts`
5. Register any VS Code commands in `commands.ts`

### Custom Command Integration
```typescript
// Support for custom commands via configuration
private async completeWithCustomCommands(commands: Array<any>) {
  const projectConfig = await loadProjectSfdxHardisConfig();
  const remoteConfig = await loadExternalSfdxHardisConfiguration();
  // Merge custom commands
}
```

### WebSocket Message Handling
```typescript
// Handle different prompt types from CLI
if (prompt.type === "select") {
  const quickpick = vscode.window.createQuickPick();
  // Configure and show picker
} else if (prompt.type === "text") {
  const input = await vscode.window.showInputBox(options);
}
```

## Documentation and Support

### Help Resources
- Main documentation: <https://sfdx-hardis.cloudity.com/>
- Command reference: <https://sfdx-hardis.cloudity.com/commands/>
- CI/CD guides: <https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/>
- GitHub issues: <https://github.com/hardisgroupcom/sfdx-hardis/issues>

### Contributing Guidelines
- Maintain user-friendly approach for non-technical users
- Follow established patterns for command registration
- Ensure comprehensive error handling and user feedback
- Add detailed tooltips and documentation links
- Test with various Salesforce org types and configurations

When working on this project, prioritize:
1. **User Experience** - Make complex SFDX operations simple
2. **Performance** - Use caching and background operations  
3. **Documentation** - Comprehensive tooltips and help links
4. **Error Handling** - Clear, actionable error messages
5. **Flexibility** - Support both beginners and experts