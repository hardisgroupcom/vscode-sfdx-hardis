[![Hardis Group Logo](docs/assets/images/hardis-banner.jpg)](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

# VsCode SFDX Hardis

[![Version](https://vsmarketplacebadge.apphb.com/version/NicolasVuillamy.vscode-sfdx-hardis.svg)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)
[![Installs](https://vsmarketplacebadge.apphb.com/installs/NicolasVuillamy.vscode-sfdx-hardis.svg)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)
[![Mega-Linter](https://github.com/hardisgroupcom/vscode-sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=master)](https://github.com/nvuillam/mega-linter#readme)
[![License](https://img.shields.io/github/license/hardisgroupcom/vscode-sfdx-hardis.png)](https://github.com/nvuillam/vscode-sfdx-hardis/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/vscode-sfdx-hardis.png?label=Star&maxAge=2592000)](https://github.com/nvuillam/vscode-sfdx-hardis/stargazers/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.png?style=flat-square)](http://makeapullrequest.com)

## Easy Salesforce DX projects management, even if you don't know Salesforce DX or git

Salesforce DX is great.

But there are so many base commands and so many useful plugins that it's easy to get lost.

VsCode SFDX-Hardis aims to simplify the use of Salesforce DX with an intuitive UI and ready to use pre-integrated commands.

![screenshot](resources/extension-screenshot.jpg)

## Assisted UI

Integration between VsCode SFDX Hardis UI and sfdx-hardis CLI, so you don't need to know the commands or their arguments

### Work on a task (simple)

Base commands allowing to a consulting profile to work on a SFDX project without knowing SFDX or Git

- Git branch & Scratch org initialization
- Assisted git add
- Automated generation of package.xml and destructiveChanges.xml
- Merge request management

![screenshot](resources/menu-assisted.jpg)

### Work on a task (Expert)

Advanced commands allowing a technical profile to work on a sfdx project without knowing SFDX or Git

- Initialization of SFDX project from an org (including packages installation)
- Cleaning of sfdx sources to prevent deployment errors

![screenshot](resources/menu-expert.jpg)

### Data Import & Export

Manage data import / export using [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)

- Configure data import / export
- Perform data import / export

![screenshot](resources/menu-data.jpg)

### Debugger

Ease sources execution debugging of any type of org

![screenshot](resources/menu-debugger.jpg)

### Configuration

Configuration helpers

- Configure deployment for CI
- Configure DevHub for CI
- Shortcut to configuration files

![screenshot](resources/menu-configuration.jpg)

### Operations

General sfdx operations

- Initialize sfdx project
- Generate package.xml from delta between 2 commits, using [sfdx-git-delta](https://github.com/scolladon/sfdx-git-delta)
- Metadata / sfdx sources operations

![screenshot](resources/menu-operations.jpg)

### Packaging

Simplify creation and maintenance of packaging V2 packages (unlocked or managed)

- Create packaging V2 packages
- Manage package versions

![screenshot](resources/menu-packaging.jpg)

### Production

Production operations

- Purge production elements

![screenshot](resources/menu-production.jpg)

## Dependencies

[**sfdx-hardis**](https://github.com/hardisgroupcom/sfdx-hardis) partially relies on the following SFDX Open-Source packages

- [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)
- [SFDX Essentials](https://github.com/nvuillam/sfdx-essentials)
- [SFDX Git Delta](https://github.com/scolladon/sfdx-git-delta)
- [SfPowerkit](https://github.com/Accenture/sfpowerkit)
- [Texei Sfdx Plugin](https://github.com/texei/texei-sfdx-plugin)

## Who we are

Powered by [Hardis Group](https://www.customer-platform.com/)

