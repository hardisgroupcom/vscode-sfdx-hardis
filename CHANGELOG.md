# Changelog

## [Unreleased]

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