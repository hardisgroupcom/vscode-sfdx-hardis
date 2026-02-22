import * as vscode from "vscode";
import {
  execCommand,
  execCommandWithProgress,
  getNpmLatestVersion,
  getWorkspaceRoot,
  NODE_JS_MINIMUM_VERSION,
  RECOMMENDED_SFDX_CLI_VERSION,
  RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
} from "../utils";
import which from "which";
import { isMergeDriverEnabled } from "./gitMergeDriverUtils";

export type DependencyInfo = {
  explanation: string;
  installable: boolean;
  label: string;
  iconName?: string;
  prerequisites?: string[];
  helpUrl?: string;
  checkMethod?: () => Promise<DependencyCheckResult>;
  installMethod?: () => Promise<{ success: boolean; message?: string }>;
};

export type DependencyCheckResult = {
  id: string;
  label: string;
  installed: boolean;
  version?: string | null;
  recommended?: string | null;
  status?: "ok" | "outdated" | "missing" | "error";
  helpUrl?: string;
  message?: string;
  messageLinkLabel?: string;
  installCommand?: string;
  upgradeAvailable?: boolean;
};

export class SetupHelper {
  workspaceRoot: string;
  private static instance: SetupHelper | null = null;
  private updatesInProgress: string[] = [];

  constructor(workspaceRoot: string = ".") {
    this.workspaceRoot = workspaceRoot;
  }

  public static getInstance(workspaceRoot: string = "."): SetupHelper {
    if (!this.instance) {
      this.instance = new SetupHelper(workspaceRoot);
    }
    return this.instance;
  }

  public hasUpdatesInProgress(): boolean {
    return this.updatesInProgress.length > 0;
  }

  public setUpdateInProgress(inProgress: boolean, id: string) {
    if (inProgress) {
      if (!this.updatesInProgress.includes(id)) {
        this.updatesInProgress.push(id);
      }
    } else {
      this.updatesInProgress = this.updatesInProgress.filter((p) => p !== id);
    }
  }

  // Simple semver-ish compare helper used by several checks
  private compareVersions(a: string, b: string): number {
    if (!a || !b) {
      return 0;
    }
    const pa = a.split(".").map((v) => Number(v.replace(/[^0-9].*$/, "")));
    const pb = b.split(".").map((v) => Number(v.replace(/[^0-9].*$/, "")));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na < nb) {
        return -1;
      }
      if (na > nb) {
        return 1;
      }
    }
    return 0;
  }

  listDependencies(): Record<string, DependencyInfo> {
    const dependencies: Record<string, DependencyInfo> = {
      node: {
        label: "Node.js",
        explanation:
          "Node.js is required to run Salesforce CLI and its plugins.",
        installable: false,
        iconName: "utility:platform",
        prerequisites: [],
        helpUrl: "https://nodejs.org/",
        checkMethod: this.checkNode.bind(this),
        installMethod: undefined,
      },
      git: {
        label: "Git",
        explanation:
          "Git is the VCS (Version Control System) used to handle your Salesforce project sources. It also provides Git Bash for Windows.",
        installable: false,
        iconName: "utility:git_branch",
        prerequisites: [],
        helpUrl: "https://git-scm.com/",
        checkMethod: this.checkGit.bind(this),
        installMethod: undefined,
      },
      sf: {
        label: "Salesforce CLI (sf)",
        explanation:
          "The modern Salesforce CLI (sf) is required to run Salesforce commands used by the extension.",
        installable: true,
        iconName: "utility:terminal",
        prerequisites: ["node"],
        helpUrl:
          "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
        checkMethod: this.checkSfCli.bind(this),
        installMethod: this.installSfCliWithNpm.bind(this),
      },
      "sfplugin:sfdx-hardis": {
        label: "sfdx-hardis",
        explanation:
          "sfdx-hardis is the main plugin this extension integrates with. Keep it up to date for features and bugfixes.",
        installable: true,
        iconName: "utility:package",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/hardisgroupcom/sfdx-hardis",
        checkMethod: this.checkSfPlugin.bind(this, "sfdx-hardis"),
        installMethod: this.installSfPlugin.bind(this, "sfdx-hardis"),
      },
      "sfplugin:@salesforce/plugin-packaging": {
        label: "@salesforce/plugin-packaging",
        explanation:
          "@salesforce/plugin-packaging provides packaging commands used for package creation and versioning.",
        installable: true,
        iconName: "utility:package",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/salesforcecli/plugin-packaging",
        checkMethod: this.checkSfPlugin.bind(
          this,
          "@salesforce/plugin-packaging",
        ),
        installMethod: this.installSfPlugin.bind(
          this,
          "@salesforce/plugin-packaging",
        ),
      },
      "sfplugin:sfdmu": {
        label: "SFDMU",
        explanation:
          "SFDMU (Salesforce Data Move Utility) is used for data import/export workflows integrated in the extension.",
        installable: true,
        iconName: "utility:data_collection",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/forcedotcom/SFDX-Data-Move-Utility",
        checkMethod: this.checkSfPlugin.bind(this, "sfdmu"),
        installMethod: this.installSfPlugin.bind(this, "sfdmu"),
      },
      "sfplugin:sfdx-git-delta": {
        label: "sfdx-git-delta",
        explanation:
          "sfdx-git-delta helps to generate package.xml/diff based on your git changes.",
        installable: true,
        iconName: "utility:git_branch",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/scolladon/sfdx-git-delta",
        checkMethod: this.checkSfPlugin.bind(this, "sfdx-git-delta"),
        installMethod: this.installSfPlugin.bind(this, "sfdx-git-delta"),
      },
      "sfplugin:sf-git-merge-driver": {
        label: "sf-git-merge-driver",
        explanation:
          "sf-git-merge-driver is a Git merge driver for Salesforce metadata files to reduce merge conflicts.",
        installable: true,
        iconName: "utility:git_branch",
        prerequisites: ["sf"],
        helpUrl:
          "https://github.com/scolladon/sf-git-merge-driver?tab=readme-ov-file",
        checkMethod: this.checkSfPlugin.bind(this, "sf-git-merge-driver"),
        installMethod: this.installSfPlugin.bind(this, "sf-git-merge-driver"),
      },
    };
    return dependencies;
  }

  async checkNode(): Promise<DependencyCheckResult> {
    try {
      const res: any = await execCommand("node --version", {
        fail: false,
        output: false,
        spinner: false,
      });
      const v = (res && res.stdout && res.stdout.toString().trim()) || null;
      const version = v ? v.replace(/^v/, "") : null;
      const ok = version !== null;
      // If installed, check minimal major version
      if (ok) {
        const major = parseInt(version.split(".")[0] || "0", 10);
        const minMajor = Math.floor(Number(NODE_JS_MINIMUM_VERSION) || 0);
        if (
          !Number.isNaN(major) &&
          major < minMajor &&
          !process.env.PATH?.includes("/home/codebuilder/")
        ) {
          const platformLabel =
            process.platform === "win32"
              ? "Windows Installer"
              : "the official installer";
          return {
            id: "node",
            label: "Node.js",
            installed: true,
            version,
            recommended: String(NODE_JS_MINIMUM_VERSION),
            status: "outdated",
            helpUrl: "https://nodejs.org/",
            message: `Installed NodeJS major version ${major} is older than the recommended one ${minMajor}.\nIt is recommended to install NodeJS ${minMajor}, then restart VsCode.`,
            installCommand: "https://nodejs.org/",
            messageLinkLabel: `Download & install NodeJS (use ${platformLabel})`,
            upgradeAvailable: true,
          };
        }
      }
      return {
        id: "node",
        label: "Node.js",
        installed: ok,
        version,
        recommended: ok ? null : String(NODE_JS_MINIMUM_VERSION),
        status: ok ? "ok" : "missing",
        helpUrl: "https://nodejs.org/",
        message: ok
          ? undefined
          : `Node.js is not installed or not found in PATH (required minimum version: ${NODE_JS_MINIMUM_VERSION})`,
        messageLinkLabel:
          "Download and install Node.js (use Windows Installer)",
      };
    } catch {
      return {
        id: "node",
        label: "Node.js",
        installed: false,
        version: null,
        recommended: null,
        status: "error",
        helpUrl: "https://nodejs.org/",
        message: `Node.js is not installed or not found in PATH (required minimum version: ${NODE_JS_MINIMUM_VERSION})`,
        messageLinkLabel:
          "Download and install Node.js (use Windows Installer)",
      };
    }
  }

  async checkGit(): Promise<DependencyCheckResult> {
    try {
      const res: any = await execCommand("git --version", {
        fail: false,
        output: false,
        spinner: false,
      });
      const out = (res && res.stdout && res.stdout.toString().trim()) || null;
      const match = out ? /git version ([0-9.]+)/.exec(out) : null;
      const version = match ? match[1] : null;
      const ok = version !== null;
      return {
        id: "git",
        label: "Git",
        installed: ok,
        version,
        recommended: null,
        status: ok ? "ok" : "missing",
        helpUrl: "https://git-scm.com/",
        message: ok ? undefined : "Git is not installed or not found in PATH",
        messageLinkLabel: "Download and install Git (with Git Bash)",
      };
    } catch {
      return {
        id: "git",
        label: "Git",
        installed: false,
        version: null,
        recommended: null,
        status: "error",
        helpUrl: "https://git-scm.com/",
        message: "Git is not installed or not found in PATH",
        messageLinkLabel: "Download and install Git (with Git Bash)",
      };
    }
  }

  async checkSfCli(): Promise<DependencyCheckResult> {
    try {
      const res: any = await execCommand("sf --version", {
        fail: false,
        output: true,
        spinner: false,
      });
      const out = (res && res.stdout && res.stdout.toString().trim()) || null;
      // try to detect @salesforce/cli or sfdx-cli
      const match = out
        ? /@salesforce\/cli\/(\S+)|sfdx-cli\/(\S+)/.exec(out)
        : null;
      const version = match ? match[1] || match[2] : null;
      const ok = version !== null;

      // Determine recommended version (either configured or latest on npm)
      let latest: string | null = null;
      try {
        latest = await getNpmLatestVersion("@salesforce/cli");
      } catch {
        latest = null;
      }
      const recommended = RECOMMENDED_SFDX_CLI_VERSION || latest || null;

      // Handle legacy sfdx-cli detection
      const legacyMatch = out ? /sfdx-cli\/(\S+)/.exec(out) : null;
      if (legacyMatch) {
        return {
          id: "sf",
          label: "Salesforce CLI (sf)",
          installed: true,
          version: legacyMatch[1],
          recommended,
          status: "error",
          message:
            "Legacy sfdx-cli detected. Please uninstall it using `npm uninstall sfdx-cli -g` then upgrade to @salesforce/cli.",
          messageLinkLabel: "Uninstall sfdx-cli then install sf",
          installCommand:
            "npm uninstall sfdx-cli --global && npm install @salesforce/cli --global",
          upgradeAvailable: true,
        };
      }

      let sfdxPath = "";
      try {
        sfdxPath = await which("sf");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_e) {
        sfdxPath = "missing";
      }

      if (
        !sfdxPath.includes("npm") &&
        !sfdxPath.includes("node") &&
        !sfdxPath.includes("nvm") &&
        !sfdxPath.includes("fnm") &&
        !sfdxPath.includes("/home/codebuilder/") &&
        !(
          sfdxPath.includes("/usr/local/bin") && process.platform === "darwin"
        ) &&
        sfdxPath !== "missing"
      ) {
        return {
          id: "sf",
          label: "Salesforce CLI (sf)",
          installed: true,
          version,
          recommended,
          status: "error",
          message: `Non-npm installation detected at ${sfdxPath} (bad installation using Salesforce website executable installer).\nPlease uninstall Salesforce CLI in "Windows -> Uninstall program" (or the equivalent on Mac), then re-install using sfdx-hardis Wizard (NPM-based).`,
          installCommand: `npm install @salesforce/cli@${recommended || "latest"} -g`,
          upgradeAvailable: false,
        };
      }

      // If installed but not the recommended version
      if (ok && recommended && version !== recommended) {
        return {
          id: "sf",
          label: "Salesforce CLI (sf)",
          installed: true,
          version,
          recommended,
          status: "outdated",
          helpUrl:
            "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
          message: `Your sf CLI version ${version} differs from recommended ${recommended}`,
          installCommand: `npm install @salesforce/cli@${recommended} -g`,
          upgradeAvailable: true,
        };
      }

      return {
        id: "sf",
        label: "Salesforce CLI (sf)",
        installed: ok,
        version,
        recommended,
        status: ok ? "ok" : "missing",
        helpUrl:
          "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
      };
    } catch {
      return {
        id: "sf",
        label: "Salesforce CLI (sf)",
        installed: false,
        version: null,
        recommended: null,
        status: "error",
        helpUrl:
          "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
      };
    }
  }

  async checkSfPlugin(pluginName: string): Promise<DependencyCheckResult> {
    try {
      const res: any = await execCommand("sf plugins", {
        fail: false,
        output: true,
        spinner: false,
      });
      let stdout = (res && res.stdout && res.stdout.toString()) || "";
      // Remove trailing Uninstalled JIT section if present
      const uninstalledJitIndex = stdout.indexOf("Uninstalled JIT");
      if (uninstalledJitIndex > -1) {
        stdout = stdout.substring(0, uninstalledJitIndex).trim();
      }
      // Try to find a line with the plugin name and version, e.g. 'sfdx-hardis 1.2.3'
      const escapedName = pluginName.startsWith("@salesforce/plugin-")
        ? pluginName.replace("@salesforce/plugin-", "")
        : pluginName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escapedName + "\\s+([-0-9A-Za-z.()]+)", "gm");
      const match = regex.exec(stdout);
      const installedVersion = match && match[1] ? match[1].trim() : null;
      const installed = !!installedVersion;
      // Get latest from npm to detect upgrades
      let latestPluginVersion: string | null = null;
      try {
        latestPluginVersion = await getNpmLatestVersion(pluginName);
      } catch {
        latestPluginVersion = null;
      }

      // Special treatment for sfdx-hardis minimal version requirement
      if (pluginName === "sfdx-hardis" && installedVersion) {
        const minimal = RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION || null;
        if (
          minimal &&
          minimal !== "beta" &&
          this.compareVersions(installedVersion, minimal) < 0
        ) {
          const versionToInstall = minimal === "beta" ? "beta" : "latest";
          return {
            id: `sfplugin:${pluginName}`,
            label: pluginName,
            installed: true,
            version: installedVersion,
            recommended: minimal,
            status: "error",
            helpUrl: `https://github.com/hardisgroupcom/sfdx-hardis`,
            message: `Your sfdx-hardis plugin version (${installedVersion}) is older than the recommended ${minimal}`,
            installCommand: `sf plugins install ${pluginName}@${versionToInstall}`,
            upgradeAvailable: true,
          };
        }
      }

      // If installed and latest is known and differs -> outdated
      if (
        installed &&
        latestPluginVersion &&
        latestPluginVersion !== installedVersion
      ) {
        return {
          id: `sfplugin:${pluginName}`,
          label: pluginName,
          installed: true,
          version: installedVersion,
          recommended: latestPluginVersion,
          status: "outdated",
          helpUrl: `https://www.npmjs.com/package/${pluginName}`,
          message: `A newer version (${latestPluginVersion}) of ${pluginName} is available`,
          installCommand: `sf plugins install ${pluginName}`,
          upgradeAvailable: true,
        };
      }

      return {
        id: `sfplugin:${pluginName}`,
        label: pluginName,
        installed: installed,
        version: installedVersion,
        recommended: latestPluginVersion,
        status: installed ? "ok" : "missing",
        helpUrl: `https://www.npmjs.com/package/${pluginName}`,
      };
    } catch {
      return {
        id: `sfplugin:${pluginName}`,
        label: pluginName,
        installed: false,
        version: null,
        recommended: null,
        status: "error",
        helpUrl: `https://www.npmjs.com/package/${pluginName}`,
      };
    }
  }

  async checkNpmPackage(packageName: string): Promise<DependencyCheckResult> {
    try {
      const latest = await getNpmLatestVersion(packageName);
      // We're only checking remote latest here; whether it's installed can be checked elsewhere
      return {
        id: `npm:${packageName}`,
        label: packageName,
        installed: true,
        version: latest,
        recommended: latest,
        status: "ok",
        helpUrl: `https://www.npmjs.com/package/${packageName}`,
      };
    } catch {
      return {
        id: `npm:${packageName}`,
        label: packageName,
        installed: false,
        version: null,
        recommended: null,
        status: "error",
        helpUrl: `https://www.npmjs.com/package/${packageName}`,
      };
    }
  }

  async installSfCliWithNpm(): Promise<{ success: boolean; message?: string }> {
    if (this.hasUpdatesInProgress()) {
      return {
        success: false,
        message: "An installation is already in progress",
      };
    }
    this.setUpdateInProgress(true, "sf");
    try {
      await execCommandWithProgress(
        "npm install @salesforce/cli" +
          (RECOMMENDED_SFDX_CLI_VERSION
            ? "@" + RECOMMENDED_SFDX_CLI_VERSION
            : "") +
          " -g",
        { fail: true, output: true },
        "Installing Salesforce CLI...",
      );
      this.setUpdateInProgress(false, "sf");
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
      return { success: true };
    } catch (err: any) {
      this.setUpdateInProgress(false, "sf");
      return { success: false, message: err?.message || String(err) };
    }
  }

  async installSfPlugin(
    pluginName: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (this.hasUpdatesInProgress()) {
      return {
        success: false,
        message: `An installation is already in progress`,
      };
    }
    this.setUpdateInProgress(true, pluginName);
    try {
      const isMergeDriver = pluginName === "sf-git-merge-driver";
      let mergeDriverWasEnabled = false;
      if (isMergeDriver) {
        const mergeDriverStatus =
          await isMergeDriverEnabled(getWorkspaceRoot());
        mergeDriverWasEnabled = mergeDriverStatus === true;
        if (mergeDriverWasEnabled) {
          await execCommandWithProgress(
            "sf git merge driver disable",
            { fail: false, output: true },
            "Disabling Salesforce Git Merge Driver before upgrade...",
          );
        }
      }
      await execCommandWithProgress(
        `echo y | sf plugins install ${pluginName}@latest`,
        { fail: true, output: true },
        `Running install command for ${pluginName}...`,
      );
      if (mergeDriverWasEnabled) {
        await execCommandWithProgress(
          "sf git merge driver enable",
          { fail: false, output: true },
          "Re-enabling Salesforce Git Merge Driver after upgrade...",
        );
      }
      this.setUpdateInProgress(false, pluginName);
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
      return { success: true };
    } catch (err: any) {
      this.setUpdateInProgress(false, pluginName);
      return { success: false, message: err?.message || String(err) };
    }
  }

  async installNpmPackage(
    packageName: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (this.hasUpdatesInProgress()) {
      return {
        success: false,
        message: `An installation is already in progress`,
      };
    }
    this.setUpdateInProgress(true, packageName);
    try {
      await execCommand(`npm i -g ${packageName}`, {
        fail: false,
        output: true,
      });
      this.setUpdateInProgress(false, packageName);
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
      return { success: true };
    } catch (err: any) {
      this.setUpdateInProgress(false, packageName);
      return { success: false, message: err?.message || String(err) };
    }
  }
}
