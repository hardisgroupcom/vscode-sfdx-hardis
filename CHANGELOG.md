# Change Log

## [Unreleased]

## [1.7.1] 2020-08-31

- Fix crash when Node.js is installed but not sfdx-cli

## [1.7.0] 2020-08-30

- New commands to export Files from an org, and to configure such export
- Freeze / Unfreeze users management (to safely deploy in production)
- Scratch Orgs Pools management

## [1.6.1] 2020-08-22

- Fix error when checking version of Node.js on systems using nvm

## [1.6.0] 2020-08-16

- Check that minimum versions of Node.js and Git are installed at extension startup
- Refresh status section after installing updates

## [1.5.1] 2020-08-14

- Add Audit menu and command **Detect legacy API use**

## [1.5.0] 2020-07-30

- Welcome page v0
- Define outdated plugins message as warning
- Add sfdx-cli update command in the outdated plugins update command

## [1.4.0] 2020-07-05

- Update url to Hardis Customer Platform Web Site
- Update documentation
- Shortcut to config files + more config files available
- Data menu
- Handle new WebSocket event `openFile`

## [1.3.3] 2020-07-02

- Command Delete scratch org(s)

## [1.3.2] 2020-07-01

- Command "Login again to git"

## [1.3.1] 2020-06-30

- Display warning to user when a scratch org will expire soon

## [1.3.0] 2020-06-30

- Reorder menus, using new section Operations
- Fix bug: Git delta does not require a SFDX project

## [1.2.1] 2020-06-20

- Try to improve startup performances

## [1.2.0] 2020-06-17

- Workaround to decode Outlook365 SafeLink encrypted Urls

## [1.1.0] 2020-06-16

- New commands
  - Generate package.xml from git diff
  - Connect to an org (without set default username)

## [1.0.0] 2020-06-14

- Fix Git Bash terminal check
- Split extension.ts file for better code organization
- Disable commands requiring a SFDX Project
- Refresh VsCode Window when a SFDX Project is created to activate Salesforce Extensions

## [0.9.1] 2020-06-13

- Allow "Don't ask again" option for Git Bash prompt

## [0.9.0] 2020-06-12

- New command for debugger
  - Retrieve Apex sources from org
  - Purge apex logs
- Trace performances
- Shortcuts to select org & dev hub

## [0.8.0] 2020-06-03

- Add command: **Clean SFDX project from references not in org**

## [0.7.0] 2020-06-02

- Add Debugger commands

## [0.6.0] 2020-05-28

- Shortcut command to open configuration files

## [0.5.0] 2020-05-25

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
- Send statusRefresh event to VsCode SFDX Hardis when context is changing (select, new scratch org...)

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