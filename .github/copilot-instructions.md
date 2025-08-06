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
- `vsCodeSfdxHardis.theme.menuIconType`: Icon theme selection

### Remote Configuration
Supports loading configuration from URLs:
```typescript
const remoteConfig = await loadExternalSfdxHardisConfiguration();
```

## User Experience Guidelines

### Command Categories
1. **Simple (CI/CD)**: For non-technical users
   - Start new task
   - Pull from org
   - Save/publish work

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

## Lightning Web Components (LWC) UI
- Use LWC for user input prompts and command execution panels
- Supports both LWC UI and traditional terminal input
- LWC components handle user interactions and display results
- Build LWC using as much as possible:
  - SLDS, that is embedded by default in all LWC, locally located in out\assets\styles\salesforce-lightning-design-system.css
  - LWC Base components, locally located in node_modules\@salesforce-ux\design-system\ui\components
- Try as much as possible to not define local CSS if you can find matching SLDS CSS classes

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