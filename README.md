<!-- markdownlint-disable-next-line MD041 -->
[![sfdx-hardis by Cloudity Banner](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfdx-hardis-banner.png)](https://sfdx-hardis.cloudity.com)

# SFDX Hardis for Visual Studio Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/NicolasVuillamy.vscode-sfdx-hardis?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/NicolasVuillamy.vscode-sfdx-hardis?label=VS%20Code%20installs)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/NicolasVuillamy/vscode-sfdx-hardis?label=Open%20VSX%20installs)](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis)
[![Mega-Linter](https://github.com/hardisgroupcom/vscode-sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=main)](https://github.com/nvuillam/mega-linter#readme)
[![License](https://img.shields.io/github/license/hardisgroupcom/vscode-sfdx-hardis.png)](https://github.com/hardisgroupcom/vscode-sfdx-hardis/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/vscode-sfdx-hardis.png?label=Star&maxAge=2592000)](https://github.com/hardisgroupcom/vscode-sfdx-hardis/stargazers/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.png?style=flat-square)](http://makeapullrequest.com)

> **The complete Salesforce DX toolkit - for everyone.**
> A click-driven UI on top of the [sfdx-hardis](https://sfdx-hardis.cloudity.com/) CLI: deliver Salesforce projects with a state-of-the-art DevOps pipeline, monitor your orgs, generate AI-assisted documentation, and run hundreds of productivity commands - **without having to learn Salesforce DX or Git first**.

Built and maintained by [**Cloudity**](https://cloudity.com/?ref=sfdxhardis) and the Trailblazer Community. Free, Open Source (AGPL-3.0), and **commercial use allowed**.

![Extension demo](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/extension-demo.gif)

[▶ Watch the **sfdx-hardis v7 walkthrough**](https://www.youtube.com/watch?v=t8jT6IPd9n4) · [▶ Watch the **Dreamforce session**](https://www.youtube.com/watch?v=o0Mm9F07UFs) · [📖 Online documentation](https://sfdx-hardis.cloudity.com/)

---

## Table of contents

- [Why VS Code SFDX Hardis?](#why-vs-code-sfdx-hardis)
- [Who is it for?](#who-is-it-for)
- [Installation](#installation)
- [Feature tour](#feature-tour)
  - [Unified Welcome panel](#unified-welcome-panel)
  - [Orgs Manager](#orgs-manager)
  - [DevOps Pipeline (CI/CD)](#devops-pipeline-cicd)
  - [User Story workflow](#user-story-workflow)
  - [Metadata Retriever](#metadata-retriever)
  - [Data Workbench (SFDMU)](#data-workbench-sfdmu)
  - [Files Workbench](#files-workbench)
  - [Documentation Workbench](#documentation-workbench)
  - [Org Monitoring](#org-monitoring)
  - [Monitoring Config Workbench](#monitoring-config-workbench)
  - [Pipeline Settings](#pipeline-settings)
  - [Installed Packages Manager](#installed-packages-manager)
  - [Run Anonymous Apex & Apex Debugger](#run-anonymous-apex--apex-debugger)
  - [Flow Visual Git Diff](#flow-visual-git-diff)
  - [Productivity commands](#productivity-commands)
  - [AI assistance](#ai-assistance)
- [Commands tree & status panels](#commands-tree--status-panels)
- [Per-org VS Code colors](#per-org-vs-code-colors)
- [Multi-language UI](#multi-language-ui)
- [Customize the extension](#customize-the-extension)
  - [Custom commands](#custom-commands)
  - [Custom plugins](#custom-plugins)
- [Articles & talks](#articles--talks)
- [Open Source dependencies](#open-source-dependencies)
- [Telemetry & privacy](#telemetry--privacy)
- [Who we are](#who-we-are)

---

## Why VS Code SFDX Hardis?

Salesforce DX is powerful, but you have to glue together dozens of `sf` commands, plugins, YAML files, and Git operations to ship a project safely. **VS Code SFDX Hardis turns that toolbox into an integrated workspace:**

- 🖱️ **Click, don't memorize** - every operation is a button with sensible defaults, tooltips, and contextual help.
- 🚦 **CI/CD-ready from day one** - set up a complete [Salesforce CI/CD pipeline](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/) and visualize it inside VS Code.
- 🩺 **Watch your orgs** - [monitor production and sandbox health](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/), security, and limits, with notifications to Slack, MS Teams, email, Jira, Grafana…
- 📚 **AI-generated documentation** - turn your metadata into a browsable, diagram-rich knowledge base.
- 🤝 **Native integrations** - GitHub, GitLab, Azure DevOps, Bitbucket, Gitea · Jira, Azure Boards · Slack, MS Teams, Email · OpenAI, Anthropic, Agentforce, Ollama…

![Native integrations](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/integrations.png)

---

## Who is it for?

| Role                                | What you get                                                                                                                             |
|-------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| **Salesforce Consultants / Admins** | A guided, Git-free UI to build user stories, pull changes, and publish work without touching the command line.                           |
| **Developers**                      | Power-user shortcuts: anonymous Apex runner, debugger, delta deployment simulation, project cleaning, Flow git diff, package management. |
| **Release Managers / Architects**   | A visual pipeline, deployment simulation, branch-strategy diagrams, and full org monitoring with notifications.                          |
| **CTOs / Project sponsors**         | Open-Source tooling that standardizes DevOps across teams and makes Salesforce delivery auditable.                                       |

---

## Installation

1. Install [Visual Studio Code](https://code.visualstudio.com/).
2. Install the [**SFDX Hardis** extension](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis) (or from [Open VSX](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis)).
3. Click the **Hardis** icon in the VS Code Activity Bar, then **Install dependencies** - the extension installs and updates everything for you (`@salesforce/cli`, `sfdx-hardis`, SFDMU, sfdx-git-delta…).

![Install dependencies](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-highlight.png)

[![Installation tutorial](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-install-tuto.png)](https://www.youtube.com/watch?v=LA8m-t7CjHA)

---

## Feature tour

### Unified Welcome panel

A single dashboard that gives one-click access to every workbench, with localized labels, light/dark theme switching, and your favorite custom menus pinned alongside the built-ins.

![VS Code SFDX Hardis Welcome panel](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/welcome.png)

### Orgs Manager

Connect to new orgs, switch between sandboxes, scratch orgs and Dev Hubs, clean up stale authentications - all from one panel. Token and URL handling is performed safely by the sfdx-hardis CLI; nothing sensitive is ever displayed or logged.

![Orgs Manager](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/orgs-manager.gif)

### DevOps Pipeline (CI/CD)

Visualize and manage your entire CI/CD pipeline inside VS Code: branches, environments, automated deployments, merge checks, delta deployment - everything in one screen.

![DevOps Pipeline UI](https://sfdx-hardis.cloudity.com/assets/images/sfdx-hardis-pipeline-view.gif)

The pipeline supports the major Git platforms out of the box: **GitHub, GitLab, Azure DevOps, Bitbucket, Gitea** - with [merge-request comments](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-handle-merge-request-results/), [Jira / Azure Boards integration](https://sfdx-hardis.cloudity.com/), and notifications to **Slack, MS Teams and Email**.

### User Story workflow

Designed for consultant profiles: **start a user story → work in the org → save & publish** without ever opening a terminal.

| New user story                                                                                                       | Retrieve & commit                                                                                                              | Save & publish                                                                                                          |
|----------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| ![New user story](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/new-user-story-2026.gif) | ![Retrieve and commit](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/retrieve-and-commit-2026.gif) | ![Save and publish](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/save-publish-pr-2026.gif) |

- [Start a new user story](https://sfdx-hardis.cloudity.com/hardis/work/new/) - branches and configures everything for you.
- [Pull from org](https://sfdx-hardis.cloudity.com/hardis/scratch/pull/) - retrieves only what you actually changed.
- [Save / publish](https://sfdx-hardis.cloudity.com/hardis/work/save/) - cleans sources, commits, and opens the merge request.

### Metadata Retriever

A modern replacement for the standard Org Browser. Filter by **type, name, last modified by, last modified date, managed package**, multi-select and retrieve in a single click.

![Metadata Retriever](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/metadata-retriever.gif)

#### Metadata presets

Instead of searching one metadata type at a time, select a **preset** to query a whole group of types at once.
Two presets are available out of the box:

- **Developer Metadata**: ApexClass, ApexTrigger, AuraDefinitionBundle, CustomLabel, CustomMetadata, Flow, LightningComponentBundle, StaticResource.
- **General Metadata**: ApexClass, ApexTrigger, AuraDefinitionBundle, CustomField, CustomLabel, CustomMetadata, CustomObject, FlexiPage, Flow, GlobalValueSet, Layout, LightningComponentBundle, ListView, PermissionSet, PermissionSetGroup, QuickAction, RecordType, StaticResource, ValidationRule,

Presets are configurable in your project `.sfdx-hardis.yml` (root or `config/` folder). Click **Manage Presets** in the
panel to open the file: if it does not define any preset yet, the default ones are written into it, ready to be edited.
Presets are reloaded as soon as you save the file.

```yaml
metadataRetrieverPresets:
  - id: developerMetadata # a preset reusing a default id overrides that default preset
    label: Developer Metadata
    description: Apex, Flows and Lightning components
    types:
      - ApexClass
      - ApexTrigger
      - Flow
      - LightningComponentBundle
  - id: securityMetadata
    label: Security Metadata
    types:
      - PermissionSet
      - PermissionSetGroup
      - Profile
      - SharingRules

# Set to true to hide the presets shipped with the extension
metadataRetrieverPresetsOverrideDefaults: false
```

### Data Workbench (SFDMU)

Import and export records between orgs using the [Salesforce Data Move Utility (SFDMU)](https://github.com/forcedotcom/SFDX-Data-Move-Utility), with full visual configuration support.

![Data Workbench](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/data-workbench.png)

- [Create export/import configurations](https://sfdx-hardis.cloudity.com/hardis/org/configure/data/)
- [Export](https://sfdx-hardis.cloudity.com/hardis/org/data/export/) / [Import](https://sfdx-hardis.cloudity.com/hardis/org/data/import/) data with one click

### Files Workbench

Mass-download or upload **files and attachments** between orgs from a guided UI - no scripting required.

![Files Workbench](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/files-workbench.png)

- [Configure files export](https://sfdx-hardis.cloudity.com/hardis/org/configure/files/)
- [Export files from org](https://sfdx-hardis.cloudity.com/hardis/org/files/export/)

### Documentation Workbench

Generate a complete, AI-enriched **knowledge base** of your Salesforce project: Apex, Flows, profiles, permission sets, custom objects, with relationship diagrams.

![Documentation Workbench](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/documentation-workbench.png)

![Project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/project-documentation.gif)

![Object diagram](https://sfdx-hardis.cloudity.com/assets/images/screenshot-object-diagram.jpg)

Deploy the docs to **GitHub Pages, Cloudflare Pages, Salesforce, or Confluence** - straight from the workbench.

### Org Monitoring

Set up scheduled monitoring jobs to track your Salesforce orgs over time: **metadata backup, legacy API usage, unused metadata / licenses / Apex, audit trail anomalies, inactive users, missing attributes, release updates, health checks, limits…**

![Monitoring with Grafana](https://sfdx-hardis.cloudity.com/assets/images/grafana-screenshot.jpg)

Results can be pushed to **Slack, MS Teams, Email, Jira, Grafana / Prometheus**, or browsed as Excel reports.

### Data Dictionary

Generate a **Data Dictionary** documenting all your org objects and fields as a navigable Excel workbook: an index sheet listing every object with its label, field count, validation rules, record types and key prefix, plus one detailed sheet per object describing each field (type, required, unique, references, picklist values, default value, formula…).

![Data Dictionary index](https://github.com/hardisgroupcom/vscode-sfdx-hardis/raw/main/docs/assets/images/data-dictionary-index.png)

![Data Dictionary object fields](https://github.com/hardisgroupcom/vscode-sfdx-hardis/raw/main/docs/assets/images/data-dictionary-object-fields.png)

### Monitoring Config Workbench

Edit triggers, frequency, and notification channels for every monitoring command in a single visual editor - no YAML editing required.

![Monitoring config workbench](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/monitoring-config-2026.gif)

### Pipeline Settings

A dedicated workbench to configure your CI/CD pipeline behavior: **manual deployment actions, org authentication modes, branch strategies, deployment overrides, cleaning rules** - all backed by the JSON-schema-validated `.sfdx-hardis.yml`.

### Installed Packages Manager

List, install, update, and **register installed packages into your CI/CD pipeline** so every environment stays in sync.

### Run Anonymous Apex & Apex Debugger

- **Run Anonymous Apex** directly in VS Code, like the Developer Console.
- **Apex Debugger shortcuts**: activate replay debug, toggle checkpoints, tail logs, and display only debug log lines.

### Flow Visual Git Diff

Compare two versions of a Salesforce Flow as a **side-by-side visual diagram** - see what changed at a glance, instead of squinting at XML.

![Flow visual git diff](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/flow-visual-git-diff.jpg)

### Productivity commands

Hundreds of ready-to-use commands organized in themed menus - *Operations, Audit, Configuration, Packaging, Nerdy stuff* - each with a help button that opens the official documentation.

![Productivity commands](https://sfdx-hardis.cloudity.com/assets/images/ProductivityCommands.png)

A few favorites:

- [Freeze / unfreeze users](https://sfdx-hardis.cloudity.com/hardis/org/user/freeze/) during a deployment
- [Purge obsolete Flow versions](https://sfdx-hardis.cloudity.com/hardis/org/purge/flow/)
- [Reactivate `.invalid` user emails in a sandbox](https://sfdx-hardis.cloudity.com/hardis/org/user/activateinvalid/)
- [Detect legacy API usage](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/)
- [Simulate a deployment](https://sfdx-hardis.cloudity.com/hardis/project/deploy/sources/dx/)
- [Clean SFDX project](https://sfdx-hardis.cloudity.com/hardis/project/clean/references/) from unwanted references
- [Create and manage Package V2](https://sfdx-hardis.cloudity.com/) (managed & unlocked)
- Generate `package.xml` from Git diff with [sfdx-git-delta](https://github.com/scolladon/sfdx-git-delta)

### AI assistance

sfdx-hardis ships with an **AI assistant** that explains deployment errors, suggests fixes, and helps you understand legacy metadata. Bring your own provider: **OpenAI, Anthropic, Salesforce Agentforce, Ollama** - full control on which traffic leaves your machine.

![AI Assistant](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/AI-Assistant.gif)

See: [AI setup](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/) · [AI prompts](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/)

---

## Commands tree & status panels

In addition to the workbenches, the extension contributes three classic tree views in the side bar:

- **Commands** - every sfdx-hardis command, organized by menu, with help links and shortcut buttons (refresh, debugger, configuration files).
- **Status** - current default org, Dev Hub, Git repo, branch, and org expiration date.
- **Plugins** - checks that all CLI dependencies are present and up to date, and offers a one-click upgrade if not.

---

## Per-org VS Code colors

The status panel automatically tints VS Code based on the selected default org, so you never confuse Production with a sandbox:

- 🔴 **Production** - red
- 🟠 **Major sandbox** (UAT, integration…) - orange
- 🟢 **Dev sandbox / scratch org** - green
- 🔵 **Other** (Dev org, trial…) - blue

You can override a color per org, or per URL pattern (e.g. `https://*.scratch.my.salesforce.com`), and choose whether the change applies to your workspace or user settings via `vsCodeSfdxHardis.colorUpdateLocation`. Disable entirely with `vsCodeSfdxHardis.disableVsCodeColors`.

[![Colors video](https://img.youtube.com/vi/6WU4rezC2GM/0.jpg)](https://www.youtube.com/watch?v=6WU4rezC2GM)

---

## Multi-language UI

The whole extension UI is translated into **English, French, Spanish, German, Italian, Dutch, Polish, Japanese, and Brazilian Portuguese**. Switch language from the Welcome panel - VS Code auto-detection is also supported.

---

## Customize the extension

### Custom commands

Add your own menus and buttons to the Commands panel and Welcome dashboard via `.sfdx-hardis.yml`:

```yaml
customCommandsPosition: first   # or "last" (default)
customCommands:
  - id: custom-menu
    label: My custom commands
    description: Shortcuts used by my team
    vscodeIcon: symbol-misc     # any VS Code ThemeIcon id
    sldsIcon: utility:apps      # any SLDS icon "category:name"
    commands:
      - id: generate-manifest-xml
        label: Generate manifest
        icon: file.svg          # any SVG in /resources
        vscodeIcon: file
        sldsIcon: utility:file
        tooltip: Generates a manifest package.xml from local sources
        command: sf project generate manifest --source-dir force-app --name myNewManifest
        helpUrl: https://sfdx-hardis.cloudity.com/
      - id: list-all-orgs
        label: List all orgs
        icon: salesforce.svg
        tooltip: List all authenticated orgs
        command: sf org list --all
```

Configurations can live in `config/.sfdx-hardis.yml`, in an absolute local path, or behind an HTTPS URL - perfect for sharing a common toolkit across your team.

### Custom plugins

Make the Plugins panel monitor extra Salesforce CLI plugins:

```yaml
plugins:
  - name: mo-dx-plugin
    helpUrl: https://github.com/msrivastav13/mo-dx-plugin
  - name: shane-sfdx-plugins
    helpUrl: https://github.com/mshanemc/shane-sfdx-plugins
```

---

## Articles & talks

- [sfdx-hardis: A release management tool for open-source](https://salesforcedevops.net/index.php/2023/03/01/sfdx-hardis-open-source-salesforce-release-management/)
- [What DevOps experts want to know about Salesforce CI/CD](https://nicolas.vuillamy.fr/what-devops-experts-want-to-know-about-salesforce-ci-cd-with-sfdx-hardis-q-a-1f412db34476)
- [Handle Salesforce API versions deprecation like a pro](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)
- [Mass-download notes & attachments from a Salesforce org](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
- [Freeze / unfreeze users during a deployment](https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3)
- [Detect bad words in Salesforce records](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
- [Reactivate sandbox users with `.invalid` emails in 3 clicks](https://nicolas.vuillamy.fr/reactivate-all-the-sandbox-users-with-invalid-emails-in-3-clicks-2265af4e3a3d)

**Français**

- [Versions d'API Salesforce décommissionnées : que faire ?](https://leblog.hardis-group.com/portfolio/versions-dapi-salesforce-decommissionnees-que-faire/)
- [Exporter en masse les fichiers d'une org Salesforce](https://leblog.hardis-group.com/portfolio/exporter-en-masse-les-fichiers-dune-org-salesforce/)
- [Suspendre l'accès aux utilisateurs lors d'une mise en production](https://leblog.hardis-group.com/portfolio/suspendre-lacces-aux-utilisateurs-lors-dune-mise-en-production-salesforce/)

---

## Open Source dependencies

[**sfdx-hardis**](https://github.com/hardisgroupcom/sfdx-hardis) builds on top of these excellent Open Source projects:

- [Salesforce Data Move Utility (SFDMU)](https://github.com/forcedotcom/SFDX-Data-Move-Utility)
- [sfdx-git-delta](https://github.com/scolladon/sfdx-git-delta)
- [Texei SFDX Plugin](https://github.com/texei/texei-sfdx-plugin)

---

## Telemetry & privacy

To help prioritize features, anonymous usage statistics are sent to Azure Application Insights via [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry), strictly following the [VS Code Telemetry Guidelines](https://code.visualstudio.com/api/extension-guides/telemetry).

We collect only:

- Extension startup time
- Command names invoked, **limited to the first two segments** (e.g. `sf hardis:work:new`, `sf plugins:install`)

We **never** collect command arguments, output, org URLs, tokens, usernames, or any business data. You can [opt out at any time in VS Code settings](https://code.visualstudio.com/docs/getstarted/telemetry#_disable-telemetry-reporting).

---

## Who we are

VS Code SFDX Hardis is graciously provided by [**Cloudity**](https://cloudity.com/?ref=sfdxhardis), an international Salesforce consulting partner, and developed with the help of the Trailblazer Community.

If you need expert guidance to roll out Salesforce DevOps, monitoring, or AI-assisted documentation at your organization, [**get in touch with Cloudity**](https://cloudity.com/contact-us/) - our multi-cloud business and technical experts can help.

[![Cloudity](https://sfdx-hardis.cloudity.com/assets/images/cloudity-banner.png)](https://cloudity.com/contact-us/)

**Contributions are welcome!** Open an issue, suggest a feature, or send a pull request - see the [contributors guide](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/docs/contributing.md).
