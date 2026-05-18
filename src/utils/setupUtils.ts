import * as vscode from "vscode";
import {
  execCommand,
  execCommandWithProgress,
  getNpmLatestVersion,
  getSfdxHardisInstallTag,
  getWorkspaceRoot,
  isExtensionPreRelease,
} from "../utils";
import which from "which";
import { isMergeDriverEnabled } from "./gitMergeDriverUtils";
import { t } from "../i18n/i18n";
import {
  NODE_JS_MINIMUM_VERSION,
  RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION,
  RECOMMENDED_SFDX_CLI_VERSION,
} from "../constants";
import { listPluginsProvidingHardisCommands } from "./sfdx-hardis-config-utils";

/**
 * Returns true when the `sf` binary path looks like a native installer (Windows
 * MSI, macOS pkg, Linux apt/rpm). Returns false when it lives in an npm/node/nvm/fnm
 * tree, or when the binary cannot be located at all.
 */
export function isNativeSfCliInstall(sfdxPath: string | null | undefined): boolean {
  if (!sfdxPath || sfdxPath === "missing") {
    return false;
  }
  if (
    sfdxPath.includes("npm") ||
    sfdxPath.includes("node") ||
    sfdxPath.includes("nvm") ||
    sfdxPath.includes("fnm") ||
    sfdxPath.includes("/home/codebuilder/") ||
    // macOS: /usr/local/bin is the typical npm global install location, not a
    // native Salesforce installer.
    (process.platform === "darwin" && sfdxPath.includes("/usr/local/bin"))
  ) {
    return false;
  }
  return true;
}

/**
 * Builds the shell command that upgrades the Salesforce CLI to {@link recommended}.
 * - Native installer (Windows MSI / macOS pkg / Linux apt/rpm): `sf update`
 * - npm/node/nvm/fnm install: `npm install @salesforce/cli@<recommended> -g`
 */
export function buildSfCliUpgradeCommand(
  sfdxPath: string | null | undefined,
  recommended?: string | null,
): string {
  if (isNativeSfCliInstall(sfdxPath)) {
    return "sf update";
  }
  return `npm install @salesforce/cli@${recommended || "latest"} -g`;
}

/**
 * Resolves the `sf` binary path via `which`, swallowing the error and returning
 * the sentinel `"missing"` if it cannot be located.
 */
export async function resolveSfCliPath(): Promise<string> {
  try {
    return await which("sf");
  } catch {
    return "missing";
  }
}

export type DependencyInfo = {
  explanation: string;
  installable: boolean;
  /** When true, the LWC shows an "Uninstall" button next to the main one. */
  uninstallable?: boolean;
  label: string;
  iconName?: string;
  prerequisites?: string[];
  helpUrl?: string;
  checkMethod?: () => Promise<DependencyCheckResult>;
  installMethod?: () => Promise<{
    success: boolean;
    message?: string;
    command?: string;
  }>;
  uninstallMethod?: () => Promise<{
    success: boolean;
    message?: string;
    command?: string;
  }>;
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
  note?: string;
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

  async listDependencies(): Promise<Record<string, DependencyInfo>> {
    const dependencies: Record<string, DependencyInfo> = {
      node: {
        label: "Node.js",
        explanation: t("depNodeExplanation"),
        installable: false,
        iconName: "utility:platform",
        prerequisites: [],
        helpUrl: "https://nodejs.org/",
        checkMethod: this.checkNode.bind(this),
        installMethod: undefined,
      },
      git: {
        label: "Git",
        explanation: t("depGitExplanation"),
        installable: false,
        iconName: "utility:git_branch",
        prerequisites: [],
        helpUrl: "https://git-scm.com/",
        checkMethod: this.checkGit.bind(this),
        installMethod: undefined,
      },
      sf: {
        label: "Salesforce CLI (sf)",
        explanation: t("depSfCliExplanation"),
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
        explanation: t("depSfdxHardisExplanation"),
        installable: true,
        iconName: "utility:package",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/hardisgroupcom/sfdx-hardis",
        checkMethod: this.checkSfPlugin.bind(this, "sfdx-hardis"),
        installMethod: this.installSfPlugin.bind(this, "sfdx-hardis"),
      },
      "sfplugin:@salesforce/plugin-packaging": {
        label: "@salesforce/plugin-packaging",
        explanation: t("depSfPackagingExplanation"),
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
        explanation: t("depSfdmuExplanation"),
        installable: true,
        iconName: "utility:data_collection",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/forcedotcom/SFDX-Data-Move-Utility",
        checkMethod: this.checkSfPlugin.bind(this, "sfdmu"),
        installMethod: this.installSfPlugin.bind(this, "sfdmu"),
      },
      "sfplugin:sfdx-git-delta": {
        label: "sfdx-git-delta",
        explanation: t("depGitDeltaExplanation"),
        installable: true,
        iconName: "utility:git_branch",
        prerequisites: ["sf"],
        helpUrl: "https://github.com/scolladon/sfdx-git-delta",
        checkMethod: this.checkSfPlugin.bind(this, "sfdx-git-delta"),
        installMethod: this.installSfPlugin.bind(this, "sfdx-git-delta"),
      },
      "sfplugin:sf-git-merge-driver": {
        label: "sf-git-merge-driver",
        explanation: t("depGitMergeDriverExplanation"),
        installable: true,
        iconName: "utility:git_branch",
        prerequisites: ["sf"],
        helpUrl:
          "https://github.com/scolladon/sf-git-merge-driver?tab=readme-ov-file",
        checkMethod: this.checkSfPlugin.bind(this, "sf-git-merge-driver"),
        installMethod: this.installSfPlugin.bind(this, "sf-git-merge-driver"),
      },
      // VS Code extension entry sits between recommended sfdx-hardis plugins
      // (above) and community/non-recommended plugins (added below). Order
      // matters: the LWC renders cards in this object's insertion order.
      "vscode:salesforce-extension-pack": {
        label: "Salesforce Extension Pack",
        explanation: t("depSalesforceExtensionPackExplanation"),
        installable: true,
        iconName: "utility:apps",
        prerequisites: [],
        helpUrl:
          "https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode",
        checkMethod: this.checkSalesforceExtensionPack.bind(this),
        installMethod: this.installSalesforceExtensionPack.bind(this),
      },
    };
    const hardisCommandsPlugins = await listPluginsProvidingHardisCommands();
    // Pre-warm npm version cache for community plugins in parallel so checkSfPlugin hits cache
    for (const plugin of hardisCommandsPlugins) {
      getNpmLatestVersion(plugin.name).catch(() => {});
    }
    for (const plugin of hardisCommandsPlugins) {
      const dependencyId = `sfplugin:${plugin.name}`;
      if (!dependencies[dependencyId]) {
        // Community plugins are not part of the sfdx-hardis recommended set:
        // expose an Uninstall action so users can remove them if undesired.
        dependencies[dependencyId] = {
          label: `${plugin.name} ${t("communityPluginLabel")}`,
          explanation: t("communityPluginTrustExplanation"),
          installable: true,
          uninstallable: true,
          iconName: "utility:package",
          prerequisites: ["sf"],
          helpUrl: plugin.helpUrl,
          checkMethod: this.checkSfPlugin.bind(this, plugin.name),
          installMethod: this.installSfPlugin.bind(this, plugin.name),
          uninstallMethod: this.uninstallSfPlugin.bind(this, plugin.name),
        };
      }
    }
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
            message: t("depNodeOutdatedMessage", {
              major: String(major),
              minMajor: String(minMajor),
            }),
            installCommand: "https://nodejs.org/",
            messageLinkLabel: t("depNodeInstallLink", { platformLabel }),
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
          : t("depNodeMissingMessage", {
              version: String(NODE_JS_MINIMUM_VERSION),
            }),
        messageLinkLabel: t("depNodeDownloadLink"),
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
        message: t("depNodeMissingMessage", {
          version: String(NODE_JS_MINIMUM_VERSION),
        }),
        messageLinkLabel: t("depNodeDownloadLink"),
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
        message: ok ? undefined : t("depGitMissingMessage"),
        messageLinkLabel: t("depGitDownloadLink"),
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
        message: t("depGitMissingMessage"),
        messageLinkLabel: t("depGitDownloadLink"),
      };
    }
  }

  async checkSalesforceExtensionPack(): Promise<DependencyCheckResult> {
    const id = "vscode:salesforce-extension-pack";
    const normalId = "salesforce.salesforcedx-vscode";
    const extendedId = "salesforce.salesforcedx-vscode-expanded";
    const normal = vscode.extensions.getExtension(normalId);
    const extended = vscode.extensions.getExtension(extendedId);
    const found = normal || extended;
    const installed = !!found;
    return {
      id,
      label: "Salesforce Extension Pack",
      installed,
      version: found?.packageJSON?.version ?? null,
      recommended: null,
      status: installed ? "ok" : "missing",
      helpUrl:
        "https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode",
      message: installed ? undefined : t("depSalesforceExtensionPackMissing"),
    };
  }

  async installSalesforceExtensionPack(): Promise<{
    success: boolean;
    message?: string;
  }> {
    try {
      // Open the extension page in VS Code's Extensions panel so the user can
      // click "Install". We use the normal pack (not the extended one) per the
      // sfdx-hardis recommendation.
      await vscode.commands.executeCommand(
        "extension.open",
        "salesforce.salesforcedx-vscode",
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
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

      // Run npm version lookup and path detection in parallel (both independent of each other)
      const [latestResult, sfdxPathResult] = await Promise.allSettled([
        getNpmLatestVersion("@salesforce/cli"),
        which("sf"),
      ]);
      const latest: string | null =
        latestResult.status === "fulfilled" ? latestResult.value : null;
      const sfdxPath: string =
        sfdxPathResult.status === "fulfilled"
          ? sfdxPathResult.value
          : "missing";
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
          message: t("depSfCliLegacyMessage"),
          messageLinkLabel: t("depSfCliLegacyLink"),
          installCommand:
            "npm uninstall sfdx-cli --global && npm install @salesforce/cli --global",
          upgradeAvailable: true,
        };
      }

      const nativeInstall = isNativeSfCliInstall(sfdxPath);
      const upgradeCommand = buildSfCliUpgradeCommand(sfdxPath, recommended);
      const nativeInstallNote = nativeInstall
        ? t("depSfCliNativeInstallNote")
        : undefined;

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
          message: t("depSfCliOutdatedMessage", {
            version: version ?? "",
            recommended: recommended ?? "",
          }),
          installCommand: upgradeCommand,
          upgradeAvailable: true,
          note: nativeInstallNote,
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
        note: nativeInstallNote,
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
        const sfdxHardisTag = getSfdxHardisInstallTag();
        // When running a pre-release extension, require alpha version
        if (isExtensionPreRelease() && !installedVersion.includes("alpha")) {
          return {
            id: `sfplugin:${pluginName}`,
            label: pluginName,
            installed: true,
            version: installedVersion,
            recommended: "alpha",
            status: "error",
            helpUrl: `https://github.com/hardisgroupcom/sfdx-hardis`,
            message: t("sfdxHardisPreReleaseAlphaMessage"),
            installCommand: `sf plugins install ${pluginName}@alpha`,
            upgradeAvailable: true,
          };
        }
        if (
          minimal &&
          minimal !== "beta" &&
          !isExtensionPreRelease() &&
          this.compareVersions(installedVersion, minimal) < 0
        ) {
          return {
            id: `sfplugin:${pluginName}`,
            label: pluginName,
            installed: true,
            version: installedVersion,
            recommended: minimal,
            status: "error",
            helpUrl: `https://github.com/hardisgroupcom/sfdx-hardis`,
            message: t("depSfdxHardisOldMessage", {
              version: installedVersion,
              minimal,
            }),
            installCommand: `sf plugins install ${pluginName}@${sfdxHardisTag}`,
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
          message: t("depSfPluginOutdatedMessage", {
            latest: latestPluginVersion ?? "",
            plugin: pluginName,
          }),
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

  // Shared lifecycle wrapper for install/uninstall operations: short-circuits when
  // another update is running, toggles in-progress state around `action`, refreshes
  // the plugins view on success, and normalizes failures.
  private async runUpdateOperation(
    name: string,
    action: () => Promise<void>,
    command?: string,
  ): Promise<{ success: boolean; message?: string; command?: string }> {
    if (this.hasUpdatesInProgress()) {
      return {
        success: false,
        message: t("installInProgress"),
        ...(command !== undefined ? { command } : {}),
      };
    }
    this.setUpdateInProgress(true, name);
    try {
      await action();
      this.setUpdateInProgress(false, name);
      vscode.commands.executeCommand("vscode-sfdx-hardis.refreshPluginsView");
      return { success: true };
    } catch (err: any) {
      this.setUpdateInProgress(false, name);
      return {
        success: false,
        message: err?.message || String(err),
        ...(command !== undefined ? { command } : {}),
      };
    }
  }

  async installSfCliWithNpm(): Promise<{
    success: boolean;
    message?: string;
    command?: string;
  }> {
    // Detect whether the existing sf binary comes from a native installer
    // (Windows MSI, macOS pkg, Linux apt/rpm). If so, use `sf update` to upgrade
    // in place — running `npm install -g` on top of a native install causes
    // duplicate binaries and broken PATH resolution.
    const sfdxPath = await resolveSfCliPath();
    const command = buildSfCliUpgradeCommand(
      sfdxPath,
      RECOMMENDED_SFDX_CLI_VERSION,
    );
    return this.runUpdateOperation(
      "sf",
      async () => {
        await execCommandWithProgress(
          command,
          { fail: true, output: true },
          t("installingSalesforceCli"),
        );
      },
      command,
    );
  }

  async installSfPlugin(
    pluginName: string,
  ): Promise<{ success: boolean; message?: string; command?: string }> {
    const installTag =
      pluginName === "sfdx-hardis" ? getSfdxHardisInstallTag() : "latest";
    const command = `echo y | sf plugins install ${pluginName}@${installTag}`;
    return this.runUpdateOperation(
      pluginName,
      async () => {
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
              t("gitMergeDriverDisablingBeforeUpgrade"),
            );
          }
        }
        await execCommandWithProgress(
          command,
          { fail: true, output: true },
          t("runningInstallCommandFor", { plugin: pluginName }),
        );
        if (mergeDriverWasEnabled) {
          await execCommandWithProgress(
            "sf git merge driver enable",
            { fail: false, output: true },
            t("gitMergeDriverReenablingAfterUpgrade"),
          );
        }
      },
      command,
    );
  }

  async uninstallSfPlugin(
    pluginName: string,
  ): Promise<{ success: boolean; message?: string; command?: string }> {
    const command = `sf plugins uninstall ${pluginName}`;
    return this.runUpdateOperation(
      pluginName,
      async () => {
        await execCommandWithProgress(
          command,
          { fail: true, output: true },
          t("runningUninstallCommandFor", { plugin: pluginName }),
        );
      },
      command,
    );
  }

  async installNpmPackage(
    packageName: string,
  ): Promise<{ success: boolean; message?: string }> {
    return this.runUpdateOperation(packageName, async () => {
      await execCommand(`npm i -g ${packageName}`, {
        fail: false,
        output: true,
      });
    });
  }
}
