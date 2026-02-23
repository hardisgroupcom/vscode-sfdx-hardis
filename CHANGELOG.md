# Changelog

## Unreleased
- Custom Color Improvements
  - Support for selecting which settings.json file to update the colors to (Workspace or User).
  - Added org URL Wildcard Support for colors. Example 'https://yourcompany--*.sandbox.my.salesforce.com'
  - URL validation added, witch warns the user if a URL in .hardis-config.yml is invalid.
  - Simplified Sandbox and Scratch org colors by checking if URL includes .sandbox. or .scratch.
  - Colors will no longer fail when the org alias include a whitespace.
  - Faster color changes, since instance URL is now cached correctly.
  - Colors are now correctly loaded upon start-up

- Data Workbench enhancements:
  - Adds log file display
  - Add column "Created date" in Exported files and logs tables
  - Handle refresh event after import, export or delete operations

## [6.28.0] 2025-02-22

- Data Workbench: Allow to configure all settings related to SFDMU export.json file

## [6.27.2] 2025-02-20

- Improve Data Workbench to individually edit objects in modal, not all objects at once
- Improve tooltips

## [6.27.1] 2025-02-19

- Improves duplicate command prevention
- Add support of Mock data in Data Workbench

## [6.27.0] 2025-02-10

- New Documentation Workbench LWC to gather in one place all documentation related commands, and allow to easily run them and configure related settings. Commands include:
  - Generate documentation, with options
    - Generate Markdown (always selected)
    - Generate PDF (default : false)
    - With flow history (default: true)
  - Deploy to Cloudflare Pages
  - Deploy to Salesforce as static resource
  - Run locally
  - Override prompt templates
- Command runner: Display total elapsed time on progress components when completed.

## [6.26.2] 2025-02-04

- Improve release workflows

## [6.26.1] 2025-02-04

- Upgrade npm dependencies

## [6.26.0] 2025-02-01

- Add new monitoring command **Health Check** to audit security policies of an org

## [6.25.5] 2025-01-29

- January egg

## [6.25.3] 2025-01-27

- Suggest to clone a repository if not in a git repo (status panel)

## [6.25.2] 2025-01-26

- Deactivate and re-active sf-git-merge-driver during plugin upgrade.
- Pipeline view: Use `sf org open` command to open orgs when clicking in the diagram, to benefit from existing user authentication.

## [6.25.1] 2025-01-21

- Refactor command groups for improved navigation in context menus
- Add focus management for modal input fields in package XML component
- Extension settings: Move debug settings to a dedicated "Debug" section
- Org Manager: Display API version of the orgs
- Org Monitoring enhancements:
  - Display monitored org url
  - Rearrange buttons for better UX

## [6.25.0] 2025-01-18

- Allow Package XML Viewer to also edit package
- Add synchronization of JSON Schema in build script
- Display package and flow contextual menu commands only on relevant files

## [6.24.1] 2025-01-16

- Add **skipCodeCoverage** in pipeline configuration (branch scoped)

## [6.24.0] 2025-01-13

- Adds copy-to-clipboard functionality to logs to enhance UX when configuring new org authentication
- Update messages to replace text emojis by real emojis 😁

## [6.23.0] 2025-12-31

- Integrate Salesforce Git Merge Driver management
  - Add in sf plugins dependencies
  - Toggle merge driver from status bar
- Fix startup error message
- Add capability to debug internal sfdx-hardis commands by setting `vsCodeSfdxHardis.debugSfdxHardisCommands` to true
- Implement Data Workbench
- Add monitoring command: [Object Field Usage](https://sfdx-hardis.cloudity.com/hardis/doc/object-field-usage/)

## [6.22.1] 2025-12-27

- Metadata Retriever & Package XML viewer enhancements:
  - Add clickable metadata-type links based on <https://sf-explorer.github.io/sf-doc-to-json>
  - Add clickable icon to display standard objects documentation

## [6.22.0] 2025-12-26

- Handle display of data cloud queries in command execution LWC
- DevOps Pipeline enhancements
  - Add danger zone Settings in pipeline configuration
    - enableDeltaDeploymentBetweenMajorBranches
    - enableDeploymentApexTestClasses
    - deploymentApexTestClasses
    - enableDeprecatedDeploymentPlan

## [6.21.0] 2025-12-21

- Metadata Retriever: Add option to retrieve metadatas in a specific local sfdx package folder

## [6.20.1] 2025-12-12

- Metadata Retriever: Filter metadatas types that are not retrievable (ex: `PicklistValue`)

## [6.20.0] 2025-11-25

- Prompts to disable TLS for certificate issues
- Live DevOps Pipeline:
  - Disables PR button when no PR exists or Git not connected
  - Improve labels when the PR is not created yet
  - Fix missing initial display for Git provider images
- Git integration: look specifically for remote "origin"
- Improve LWC loading performances

## [6.19.0] 2025-11-25

- Upgrade minimal NodeJS version to 24.0 (except on CodeBuilder / Agentforce Vibes as it can't be changed there)

## [6.18.3] 2025-11-18

- Live DevOps Pipeline:
  - When connected, open Git Provider or Ticketing provider in browser
  - Add disconnect functionality for Git & Ticketing providers

## [6.18.2] 2025-11-17

- Update README badges labels
- Upgrade dependencies

## [6.18.1] 2025-11-16

- Metadata Retriever enhancements
  - Add "View logs" option on retrieve failures to see detailed error in output channel
  - Fix managed layout name resolution
- Upgrade js-yaml

## [6.18.0] 2025-11-13

- Live DevOps Pipeline: Update "in progress" emoji
- Adds Run Anonymous Apex to Welcome page + Log Analyzer button and install link if not present.
- Allow to display filtered logs with only DEBUG statements

## [6.17.2] 2025-11-10

- Live DevOps Pipeline enhancements & fixes
  - Sort pending PRs by merge date descending in branch configuration
  - Optimize loading performances
  - Improves PR detection in Azure DevOps
  - Fix listing of Pull Requests with Azure DevOps
  - Adds debug mode for VS Code extension with API call logging to investigate issues
  - Change the default refresh interval to 10 minutes instead of 5 minutes to reduce API calls

## [6.17.1] 2025-11-10

- Refactors PR fetching to optimize job collection
- GitHub integration: Fix ways to collect GitHub workflows
- Azure DevOps: Fix way to collect latest build from a branch
- Fix mermaid node name sanitization to avoid multiple consecutive hyphens (mermaid crashes in that case)
- Create actions folder if not existing when saving PR config file

## [6.17.0] 2025-11-09

- Live DevOps Pipeline: UI part for deployment actions
- Orgs Manager: Fix issue when renaming or removing an existing org alias
- Fix Git / Jira icons display issue
- Upgrade dependencies

## [6.16.5] 2025-11-06

- Pipeline view: Fix available target branches check

## [6.16.4] 2025-11-03

- Displays selected item count in multiselect
- DevOps Pipeline: fix click on Commit changes

## [6.16.3] 2025-11-02

- Handle command line too long in french
- Display error message in case of unknown error

## [6.16.2] 2025-11-02

- Contextual menu for PackageXML viewer
- Metadata Retriever: Keep history of retrieved metadata in `hardis-report/retrieve`
  - Individual retrievals
  - Global package with all retrievals
  - fix: Include scratch orgs in Metadata Retriever org selection

## [6.16.0] 2025-10-31

- New command: [Data Storage Statistics](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/storage-stats/)
- Fix: When switching org, remove current custom color if it is a custom one

## [6.15.3] 2025-10-30

- DevOps Pipeline
  - Fallback when jiraHost is not defined
  - Initialize title when clicking on "Create pull request"

## [6.15.2] 2025-10-29

- Metadata Retriever: Handle case when line is too long, generate and use a temporary package.xml

## [6.15.1] 2025-10-28

- Refactor JIRA authentication: centralize active-user check and simplify credential handling.
- DevOps Pipeline: Replace Pull command shortcut by Metadata Retriever
- Reorganize DevOps menu

## [6.15.0] 2025-10-23

- Live DevOps Pipelines enhancements
  - Display Git & ticketing providers icons
  - Add button to view pipeline configuration from pipeline view
  - Allow more formats of jiraHost
  - Fix issue when both Jira PAT and Email + Token are set
- Package XML viewer: Direct link to the Metadata file

## [6.14.5] 2025-10-22

- Fix WebPack compile in production

## [6.14.4] 2025-10-22

- Fix images display within WebView panels

## [6.14.3] 2025-10-22

- Metadata Retriever fixes
  - Always display "Search in results" filters once there are loaded results.
  - Unselect deleted files

## [6.14.2] 2025-10-22

- Add button to view logs when it is relevant

## [6.14.1] 2025-10-21

- Improve Metadata retriever
  - Display operation in the org: created, modified, deleted
  - New option to check if there is a matching local file in the repo
  - Overwrite management
  - When operation is deleted, delete locally the file in the repo if existing
  - Unselect retrieved files from results after retrieval
  - List the metadatas available in the selected org (lazy loading)
  - Display floating button to retrieve metadata when we scrolled down

## [6.14.0] 2025-10-21

- New UI: Metadata Retriever allowing to search in recent changes or all metadatas, with filters
  - Metadata type
  - Metadata name
  - Last Updated By
  - Last Updated Date
  - Package

## [6.13.0] 2025-10-19

- Live DevOps Pipelines
  - Display the number of PR that are currently in a major branch
  - When clicking on a major branch node, display related Pull Requests and Related Tickets in a modal
  - JIRA and Azure Boards integration and connect button

## [6.12.0] 2025-10-16

- New feature: Contextual menu on apex files to run as anonymous Apex (like in Developer Console)

## [6.11.2] 2025-10-13

- Improves datatable column width handling
- Add AutoClose command toggle and setting

## [6.11.1] 2025-10-13

- Fix issue related to VsCode theme colorization sometimes keeping custom colors when not necessary
- Fix mermaid diagram display issue by sanitizing node names

## [6.11.0] 2025-10-12

- Pipeline Settings: Allow to configure commands to run before deployment in pipeline configuration
- Add new menu: CI/CD (Misc) -> [Activate decomposed format for metadata (beta)](https://sfdx-hardis.cloudity.com/hardis/project/metadata/activate-decomposed/)
- Display [**useDeltaDeploymentWithDependencies**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-delta-deployment/#delta-with-dependencies-beta) in pipeline configuration

## [6.10.2] 2025-10-11

- Adds create PR URL to branch strategy diagram
- Allow to connect to Azure with Personal Access Token (only way when your are guest user on another tenant)
- Fix issue when fetching PRs and builds for PRs in Azure DevOps
- Fix pull requests table auto-sizing

## [6.10.1] 2025-10-08

- Adds pipeline configuration validations (developmentBranch and availableTargetBranches)

## [6.10.0] 2025-10-05

- Pipeline view
  - Display Pull Requests within the mermaid diagram, with status and hyperlinks
  - Animate Pull Requests and deployment jobs links when they are in progress
  - Refactor buttons organization for optimized distribution
- Package XML view: Add filter

## [6.9.1] 2025-09-30

- Pipeline view: Display jobs status of each Pull Request
- Fix bug when opening Files Workbench panel
- Prompt select: autofocus filtering field when displayed

## [6.9.0] 2025-09-25

- Connect to Git provider to display the list of open Pull Requests

## [6.8.1] 2025-09-23

- Display spinner when checking or installing dependencies

## [6.8.0] 2025-09-23

- New feature: **Install dependencies** , available from Welcome LWC & plugins status panel.
- New setting: **autoUpdateDependencies**

## [6.7.0] 2025-09-21

- Welcome view
- Org Monitoring Workbench + Package XML Viewer
- Org Manager: Allow to edit Org aliases in the table
- DevOps Pipeline: new features
  - Quick actions for contributors
  - Links to package.xml files
- Improve custom help text component so user can copy text and click on links
- Many UI/UX improvements
- Enable MegaLinter LLM Advisor with Google Gemini free tier

## [6.6.1] 2025-09-20

- Auto-collapse progress sections when they are completed.

## [6.6.0] 2025-09-19

- New command to start Salesforce CLI MCP server from VsCode SFDX Hardis
- New configuration item to auto-start Salesforce CLI MCP server when starting VsCode SFDX Hardis
- Display extension settings with tabs for better UX

## [6.5.1] 2025-09-14

- Open report folder in explorer instead of VSCode window
- Add configuration item to set minimum file size to export in Files Workbench

## [6.5.0] 2025-09-14

- Add progress action when executing a command in background mode
- New command: Files Workbench to manage multiple files export/import configurations
- Display only one button per report if it is available in CSV and XLSX
- Fix position of helper texts

## [6.4.1] 2025-09-07

- Enhance pipeline configuration
  - Allow to update branch-scoped configuration
  - Display sections in tabs for better UI
- Orgs Manager: Fix refresh issue after setting default org
- Optimize LWC performances by removing unnecessary method existence check

## [6.4.0] 2025-09-06

- Add command **Org Monitoring -> Unsecured Connected Apps**
- Detect when there is a crash at the beginning of a sf hardis command, and display error on running LWC panel

## [6.3.5] 2025-09-04

- Installed packages manager: allow to pre-input packages using org installed packages
- Use white background for branches in DevOps Pipeline UI

## [6.3.4] 2025-09-04

- Optimize org-related refreshes

## [6.3.3] 2025-09-03

- Allow user to override the check of duplicate running commands
- Orgs Manager enhancements
  - Allow to set default org or default dev hub
  - Display default org & default dev hub
- Improve refresh org handling by watching config files

## [6.3.2] 2025-09-01

- Open org using SF Cli + Adds internal command execution with progress
- Fix issue when reusing an already open panel

## [6.3.1] 2025-09-01

- Change icon of Orgs Manager

## [6.3.0] 2025-09-01

- Show combobox filter to simplify selection when there are many values
- New feature: Orgs Manager to list, manage and clean all orgs known by Salesforce CLI

## [6.2.2] 2025-08-29

- Analyze local environment to find Python executable to use to call command **Run Local HTML Doc Pages**. Display a link to install python if not found.

## [6.2.1] 2025-08-26

- Display toggles instead of checkboxes for boolean values in Pipeline Settings and Extension Settings UIs

## [6.2.0] 2025-08-25

- DevOps Pipeline
  - Installed packages Manager
  - Warning when missing encrypted certificate keys in branch configuration
  - Warning when manual actions file has not been set
- Remove declaration of welcome command that is not existing anymore
- Update Copilot instructions

## [6.1.3] 2025-08-24

- Allow hardis:project:configure:auth to call itself when necessary
- Run background commands in Git bash for Windows if available (required for openssl)

## [6.1.2] 2025-08-24

- Improves sfdx plugins version matching

## [6.1.1] 2025-08-24

- Fixes related to Code Builder integration
- Fix cache manager issue
- Handle binary file download in web context
- Wait for LWC to be ready before continuing the sfdx-hardis command

## [6.1.0] 2025-08-23

- Add Monitoring command [Unused Connected Apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps/)
- Add filtering capability to multiselect prompt
- Enhance design & forms

## [6.0.10 (pre-release)] 2025-08-17

- Add debug options for sfdx-hardis commands
- Add new sandbox refresh commands
- New UI to update VsCode SFDX-Hardis configuration
- Fix issue on MacOS with background commands
- Use VsCode Cache manager to improve performances
- Add Pipeline Settings command & LWC
- Build custom LWC helptext component to handle multiline display

## [6.0.9 (pre-release)] 2025-08-14

- Add a new mode (by default) to execute sfdx-hardis commands in background, not in terminal

## [6.0.8 (pre-release)] 2025-08-12

- Command execution: Add simple/advanced mode
- DevOps pipeline: Add warnings if `mergeTargets` is not defined in branch config.

## [6.0.6 (pre-release)] 2025-08-11

- Improve UI & Buttons
- Rename Task into User Story

## [6.0.5 (pre-release)] 2025-08-11

- Display more kind of buttons (action link, action command, url, doc)
- Display tables in command execution LWC

## [6.0.1 (pre-release)] 2025-08-10

- Improve sfdx-hardis dependency detection for pre-release mode
- Improve performance at initialization by using a single multi-threaded worker

## [6.0.0 (pre-release)] 2025-08-09

- New UI with LWC
  - Command execution
  - DevOps Pipeline view and configuration

## [5.10.1] 2025-06-27

- Add newest api version labels

## [5.10.0] 2025-06-21

- Do not display error message if sf is installed via CodeBuilder
- Debugger: perform SF related actions only if the breakpoint detected is on an Apex Class
- Improve performances when running debugger
- Add a test CI/CD workflow
- Add a copilot instructions file
- Replace deprecated vscode-test with @vscode/test-electron
- Fix issue that messed with user VsCode theme / colors customizations

## [5.9.0] 2025-06-18

- New command Doc -> [Override prompt templates](https://sfdx-hardis.cloudity.com/hardis/doc/override-prompts/)

## [5.8.0] 2025-02-27

- Add PDF generation commands
- Add another python commands combination to locally run documentation

## [5.7.0] 2025-02-14

- New command [hardis:project:generate:bypass](https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/) : Generates bypass custom permissions and permission sets for specified sObjects and automations

## [5.6.3] 2025-02-03

- Add mkdocs-exclude-search to mkdocs plugins

## [5.6.2] 2025-01-21

- Fix wrong message for Mac users when sf is installed in /usr/local/bin , which is ok :)
- Arrange documentation menu

## [5.6.1] 2025-01-10

- Update python commands so they work on any type of python installation, including Windows

## [5.6.0] 2025-01-04

- New command [hardis:doc:mkdocs-to-salesforce](https://sfdx-hardis.cloudity.com/hardis/doc/mkdocs-to-salesforce/) to upload HTML doc as static resource to your Salesforce org

## [5.5.1] 2025-01-03

- Reorder menu

## [5.5.0] 2025-01-03

- New Documentation menu section
  - [Generate SF project documentation](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) (including Visual Flows)
  - New command to [**Generate Flow Markdown Documentation**](https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/)
  - New command to [**Generate Flow Visual Git Diff**](https://sfdx-hardis.cloudity.com/hardis/project/generate/flow-git-diff/)
  - New command to run local Web Server with Documentation HTML pages

## [5.4.0] 2024-12-16

- Add context menu to Generate Package.xml documentation
- Display command in tooltip

## [5.3.0] 2024-11-22

- New command [Extract Pull Requests](https://sfdx-hardis.cloudity.com/hardis/git/pull-requests/extract/) in CI/CD (Misc) menu
- New shortcut to open reports folder

## [5.2.0] 2024-11-09

- New monitoring commands
  - [Generate Project Documentation](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)
  - [Detected Unused Apex Classes](https://sfdx-hardis.cloudity.com/salesforce-monitoring-unused-apex-classes/)

## [5.1.1] 2024-11-02

- Fix: import chalk as ES Module

## [5.1.0] 2024-11-02

- Add command **Data -> Multi-org SOQL Query & Report**
- Fix typos
- Upgrade dependencies

## [5.0.0] 2024-09-23

- Migrate all sfdx calls into SF CLI calls to match SFDX Hardis v5
- Improve panel menus loading time x10
- New configuration variables to customize appearance of SFDX Hardis panels:
  - Select icons theme: Hardis (legacy) or Visual Studio Code (new)
  - Display / Hide emojis in menu sections titles
- New contextual menu command **SFDX Hardis: Simulate Metadata deployment**, to safely check deployment errors to any target SF Org.
- Reorganize sections and menus
- Add `destructiveChanges.xml` and `package-no-overwrite.xml` in Quick Open config files menu-
- New command **Org Monitoring -> Release Updates**
- Default color is "no color", not green
- Fix: Do not update VsCode local config file with blank color if there wasn't a previous config value
- Fix: Refresh Status panel after upgrading plugins
- Fix: Do not display dependency warning if Salesforce Extension Pack (Expanded) is installed
- Remove sfdx-essentials plugin dependency
- NPM dependencies updates
  - Upgrade all package dependencies
  - Remove sort-array dependency
  - Replace portastic by get-port (better speed & maintenance)

## [2.12.1] 2024-08-22

- Accept SF folder name containing `node` in case of custom NodeJs installation folder

## [2.12.0] 2024-08-06

- Refactor menus to group Monitoring commands
- Fix warning message about Node version
- Upgrade GitHub Actions versions

## [2.11.0] 2024-08-02

- Upgrade minimum NodeJS version to v20

## [2.10.0] 2024-07-14

- Add new menu for command sfdx hardis:org:files:import

## [2.9.0] 2024-05-14

- New command to detect active users that do not use their Salesforce account :)

## [2.8.0] 2024-04-23

- Fix calls to core SF extensions pack that switched from sfdx to sf commands

## [2.7.1] 2024-04-10

- Do not add --skipauth or --websocket if a launched command contains **&&**
- Add default icon for custom commands if not defined in .sfdx-hardis.yml

## [2.7.0] 2023-12-05

- Warning icon if mismatch detected between org and sfdx project api versions

## [2.6.0] 2023-12-04

- Add new audit command [**Detect unused licenses**](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedlicenses/): Detects if there are unused licenses in the org, and offers to delete them

## [2.5.0] 2023-11-26

- Check if it might be required to merge origin parent branch into current work branch.

## [2.4.0] 2023-11-15

- Add command **Audit -> Suspicious Audit Trail Activities**
- Update URLs to doc with <https://sfdx-hardis.cloudity.com/>

## [2.3.1] 2023-10-25

- Publish extension on Open VSX
- Add menu to sfdx-hardis CI/CD Home

## [2.3.0] 2023-10-12

- Allow to send a command to run again from sfdx-hardis plugin
- Add installation tutorial in README
- Add Dreamforce presentation in README

## [2.2.0] 2023-10-09

- Update VsCode commands to call Replay Debugger, as they changed in Core VsCode extension
- Add more details in case there is an issue while calling a SF Extension pack core extension

## [2.1.0] 2023-09-06

- Display the branch name when default org is associated to a major branch

## [2.0.1] 2023-08-21

- Fix false positive warning display with @salesforce/plugin-packaging

## [2.0.0] 2023-08-18

**BREAKING CHANGE**: Only for some CI scripts, please read [sfdx-hardis v4.0.1 release notes](https://github.com/hardisgroupcom/sfdx-hardis/releases/tag/v4.0.1)

- Automatically **uninstall sfdx-cli** then **install @salesforce/cli** to follow [Salesforce recommendations](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_move_to_sf_v2.htm)
- Add @salesforce/plugin-packaging in default plugins
- Fix false positive error when nvm has been used to install @salesforce/cli (thanks @anthonygiuliano :))
- Upgrade npm dependencies
- Upgrade MegaLinter

## [1.33.1] 2023-07-10

- Fix issue when sfdx is installed in nodejs folder

## [1.33.0] 2023-06-28

- Detect when sfdx has been wrongly installed using Windows Installer instead of Node.js / NPM

## [1.32.2] 2023-04-06

- Manage bundle of worker.js with esbuild

## [1.32.1] 2023-04-06

- Revert Bundle because of worker.js crash

## [1.32.0] 2023-04-06

- Bundle extension with esbuild to improve performances
- Add [anonymous telemetry](https://github.com/hardisgroupcom/vscode-sfdx-hardis/tree/main#telemetry) respecting VsCode Extensions Guidelines
- Add colors video demo in README

## [1.31.1] 2023-05-31

- Fix git repository display in Status panel

## [1.31.0] 2023-05-30

- New command **Nerdy Stuff -> Generate org full package.xml**
- Upgrade MegaLinter to v7
- Manage CI permissions for release

## [1.30.0] 2023-05-24

- Accelerate startup of the extension by using low-level git commands instead of waiting for VsCode Git Extension

## [1.29.0] 2023-05-14

- Org API version & status in the same item than expiration date
- Direct link to open User Settings Home
- Direct link to open Setup Home
- Update icons: User, Apex tests, Simulate Deployment
- Remove `https://` from the displayed org URL, are they all are HTTPS

## [1.28.0] 2023-05-08

- Display apiVersion and release name in Status panel

## [1.27.2] 2023-04-25

- Refresh status panel when default org is changed with another way than sfdx-hardis command
- Performance optimizations by avoiding doubling WebSocket servers

## [1.27.1] 2023-04-25

- Optimization of extension startup using multithread does not work on all computers
  - Disable it by default
  - Enable it by activating setting **vsCodeSfdxHardis.enableMultithread**

## [1.27.0] 2023-04-24

- Activate extension everytime VsCode opens in a Salesforce project
- Optimize extension startup time by calling CLI commands with worker_threads
- Remove duplicate console.time and console.timeEnd
- Remove pool info from preloaded commands

## [1.26.0] 2023-04-18

- Manage VsCode Theme colors depending on selected org
  - Automated
    - Production: red
    - Sandbox of major org (where you are not supposed to deploy ^^): orange
    - Sandbox or scratch org for dev/config: green
    - Other (Dev Org, Trial org...): blue
  - Notes
    - If you don't want this feature, use `vsCodeSfdxHardis.disableVsCodeColors` VsCode setting
    - You can force the association between an org and a color using shortcut button in status panel
- Rename master branch into main

## [1.25.1] 2023-03-13

- Display hammer-wrench icon in dependencies section when a plugin is locally developed

## [1.25.0] 2023-03-12

- Remove duplicate command vscode-sfdx-hardis.debug.launch
- Refactor icons for dependencies tab (up to date, to upgrade, missing)
- Add [salesforcedevops.net](https://salesforcedevops.net/index.php/2023/03/01/sfdx-hardis-open-source-salesforce-release-management/) article in README

## [1.24.3] 2023-02-27

- New logo

## [1.24.2] 2023-02-23

- Fix issue about sfdx project detection on Linux

## [1.24.1] 2023-02-17

- [Cloudity](https://www.cloudity.com) rebranding

## [1.24.0] 2023-02-17

- Update documentation
- Fix issue when configure monitoring ([#80](https://github.com/hardisgroupcom/vscode-sfdx-hardis/issues/80))

## [1.23.0] 2022-11-30

- New command Detect missing permissions (`sfdx hardis:lint:access`)

## [1.22.0] 2022-10-21

- Remove dependency to sfpowerkit

## [1.21.2] 2022-10-19

- Add find duplicates command
- Change icons for audit commands

## [1.21.1] 2022-09-29

- Update node.js version check to 16.0 minimum

## [1.21.0] 2022-08-02

- New audit commands
  - Detect duplicate sfdx files
  - Extract API versions of sources
  - List call'in and call'outs
  - List remote sites
- New other commands
  - Retrieve analytics sources
  - Delete data using SFDMU command

## [1.20.1] 2022-06-21

- Fix multiple clicks on the Apex debugger button that caused multiple debug sessions to be started

## [1.20.0] 2022-06-12

- New command **Merge package.xml files**

## [1.19.0] 2022-05-03

- New command **Select and retrieve sfdx sources**

## [1.18.2] 2022-05-02

- Fix upgrade dependency command bug

## [1.18.1] 2022-05-01

- Reset cache when refreshing status panel

## [1.18.0] 2022-05-01

- Improve startup performances
- Do not refresh status & dependencies panels every 60mn… but every 6h :)

## [1.17.0] 2022-04-22

- New command: Display live logs in terminal

## [1.16.0] 2022-04-10

- Allow custom plugins

## [1.15.0] 2022-04-10

- Allow custom commands to be remotely defined using Vs code setting `customCommandsConfiguration`
- Fix bug when there is no help URL defined on a command

## [1.14.0] 2022-04-09

- New contextual menus
  - Commands: View command details
  - Dependencies: View dependency documentation

## [1.13.0] 2022-04-09

- Update documentation
- Contextual menus on commands to open documentation

## [1.12.0] 2022-04-08

- New configuration item **vsCodeSfdxHardis.disableDefaultOrgAuthenticationCheck**: Disable default org authentication checks by adding `--skipauth` argument to sfdx-hardis commands (improves performances for expert users)
- Improve status panel tooltips to display full org instanceUrl and username

## [1.11.1] 2022-04-04

- Status panel: Display Node.js & git versions

## [1.11.0] 2022-04-03

- Reorder menus and commands

## [1.10.0] 2022-03-15

- Allow to add custom commands in VsCode SFDX Hardis menu

## [1.9.4] 2022-01-07

- Fix: Configure org for CI does not require a sfdx project

## [1.9.3] 2022-01-03

- Check for Salesforce Extensions pack installation. If not propose to install it.

## [1.9.2] 2022-01-02

- Automatically activate debug logs when adding or updating a breakpoint

## [1.9.1] 2022-01-02

- Update labels and articles links

## [1.9.0] 2021-12-21

- Split status and plugins panel to improve UI performances
- Easy user handling for debugger commands (propose to download Apex sources if not present)
- Context menu to toggle Apex checkpoints, and automatically upload them to org when added

## [1.8.3] 2021-11-10

- sfdx-cli bugs has been solved: Remove recommended sfdx version

## [1.8.2] 2021-11-03

- Manage compatibility with repositories cloned with SSH
- Upgrade MegaLinter to v5

## [1.8.1] 2021-10-12

- Remove check for SFDX project existence for some commands that do not require it.

## [1.8.0] 2021-09-17

- Manage recommended version for sfdx-cli (can be overridden with VsCode setting `vsCodeSfdxHardis.ignoreSfdxCliRecommendedVersion`)

## [1.7.2] 2021-09-13

- Add logger Output panel
- Do not get pool info when there is none configured

## [1.7.1] 2021-08-31

- Fix crash when Node.js is installed but not sfdx-cli

## [1.7.0] 2021-08-30

- New commands to export Files from an org, and to configure such export
- Freeze / Unfreeze users management (to safely deploy in production)
- Scratch Orgs Pools management

## [1.6.1] 2021-08-22

- Fix error when checking version of Node.js on systems using nvm

## [1.6.0] 2021-08-16

- Check that minimum versions of Node.js and Git are installed at extension startup
- Refresh status section after installing updates

## [1.5.1] 2021-08-14

- Add Audit menu and command **Detect legacy API use**

## [1.5.0] 2021-07-30

- Welcome page v0
- Define outdated plugins message as warning
- Add sfdx-cli update command in the outdated plugins update command

## [1.4.0] 2021-07-05

- Update url to Hardis Customer Platform Web Site
- Update documentation
- Shortcut to config files + more config files available
- Data menu
- Handle new WebSocket event `openFile`

## [1.3.3] 2021-07-02

- Command Delete scratch org(s)

## [1.3.2] 2021-07-01

- Command "Login again to git"

## [1.3.1] 2021-06-30

- Display warning to user when a scratch org will expire soon

## [1.3.0] 2021-06-30

- Reorder menus, using new section Operations
- Fix bug: Git delta does not require a SFDX project

## [1.2.1] 2021-06-20

- Try to improve startup performances

## [1.2.0] 2021-06-17

- Workaround to decode Outlook365 SafeLink encrypted Urls

## [1.1.0] 2021-06-16

- New commands
  - Generate package.xml from git diff
  - Connect to an org (without set default username)

## [1.0.0] 2021-06-14

- Fix Git Bash terminal check
- Split extension.ts file for better code organization
- Disable commands requiring a SFDX Project
- Refresh VsCode Window when a SFDX Project is created to activate Salesforce Extensions

## [0.9.1] 2021-06-13

- Allow "Don't ask again" option for Git Bash prompt

## [0.9.0] 2021-06-12

- New command for debugger
  - Retrieve Apex sources from org
  - Purge apex logs
- Trace performances
- Shortcuts to select org & dev hub

## [0.8.0] 2021-06-03

- Add command: **Clean SFDX project from references not in org**

## [0.7.0] 2021-06-02

- Add Debugger commands

## [0.6.0] 2021-05-28

- Shortcut command to open configuration files

## [0.5.0] 2021-05-25

- Button to open new terminal, to run sfdx commands in parallel

## [0.4.2] 2021-05-23

- Do not force to use git bash as terminal
- Do not display Unknown branch menu item

## [0.4.1] 2021-05-09

- Fix Merge Request display

## [0.4.0] 2021-05-08

- Get random port for sfdx-hardis WebSocket server and send it to CLI commands

## [0.3.1] 2021-04-26

- Quickfix display PR in status

## [0.3.0] 2021-04-21

- Reorganize commands: assisted mode and expert mode

## [0.2.6] 2021-04-20

- Display devHub org info in status TreeView
- Add command hardis:project:create in menu
- Display merge request info in status (beta)

## [0.2.5] 2021-04-06

- Hyperlink to git repository in Status TreeView
- Async start of WebSocket server
- Add command to Simulate SFDX Deployment

## [0.2.4] 2021-04-01

- Add packaging commands

## [0.2.3] 2021-03-31

- Automatically refresh Status TreeView every 30 minutes
- Shorten long messages in UI prompts
- Display plugins versions
- Add refresh button for Commands TreeView

## [0.2.2] 2021-03-29

- Fix WebSocket on Windows

## [0.2.0] 2021-03-29

- WebSocket Server to communicate with sfdx-hardis CLI with VsCode UI
- VsCode Setting **vsCodeSfdxHardis.userInput**: select if user input is with VsCode ui (default) or console input
- Send statusRefresh event to VsCode SFDX Hardis when context is changing (select, new scratch org…)

## [0.1.3] 2021-03-28

- Clean sfdx project from unwanted references

## [0.1.2] 2021-03-27

- More commands in menu
  - Export scratch org data
  - import scratch org data
- Add sfdmu dependency

## [0.1.0] 2021-03-26

- More commands in menu
- Add texei-sfdx-plugin dependency

## [0.0.8] 2021-03-21

- Display a message to upgrade sfdx plugins when necessary
- Fix tooltips

## [0.0.6] 2021-03-17

- Reorganize commands menu + icons
  - New command **Generate new password**
- New view **Status**, with refresh button
  - Scratch org info
  - Git info
  - Plugins info (allows to upgrade if updated)
- Remove install prompt at launch (replaced by Status -> Plugins)

## [0.0.5] 2021-03-17

- Better terminal management

## [0.0.4] 2021-03-16

- Add Open command in Work menu
- Scrolldown terminal when running a command

## [0.0.3] 2021-03-14

- Reorganize commands tree and add icons & descriptions
- Add Mega-Linter on project

## [0.0.2] 2021-03-13

- Add commands to configure org monitoring
- Add descriptions on commands
- Use git bash terminal shell, and propose to install if necessary
- Propose user to upgrade SFDX Hardis dependent tools

## [0.0.1] 2021-03-09

- Initial release
