import { execCommand, getNpmLatestVersion, NODE_JS_MINIMUM_VERSION, RECOMMENDED_SFDX_CLI_VERSION, RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION } from "../utils";

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
  installCommand?: string;
  upgradeAvailable?: boolean;
};

export class SetupHelper {
  workspaceRoot: string;
  private static instance: SetupHelper | null = null;

  constructor(workspaceRoot: string = ".") {
    this.workspaceRoot = workspaceRoot;
  }

  public static getInstance(workspaceRoot: string = "."): SetupHelper {
    if (!this.instance) {
      this.instance = new SetupHelper(workspaceRoot);
    }
    return this.instance;
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
            checkMethod: this.checkSfPlugin.bind(this, "@salesforce/plugin-packaging"),
            installMethod: this.installSfPlugin.bind(this, "@salesforce/plugin-packaging"),
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
        const major = parseInt((version.split(".")[0]) || "0", 10);
        const minMajor = Math.floor(Number(NODE_JS_MINIMUM_VERSION) || 0);
        if (!Number.isNaN(major) && major < minMajor) {
          return {
            id: "node",
            label: "Node.js",
            installed: true,
            version,
            recommended: String(NODE_JS_MINIMUM_VERSION),
            status: "outdated",
            helpUrl: "https://nodejs.org/",
            message: `Installed Node.js major version ${major} is older than the required ${minMajor}`,
            installCommand: "https://nodejs.org/",
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
          helpUrl:
            "https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm",
          message:
            "Legacy sfdx-cli detected. Please upgrade to @salesforce/cli.",
          installCommand:
            "npm uninstall sfdx-cli --global && npm install @salesforce/cli --global",
          upgradeAvailable: true,
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
    try {
      // Use npm to install @salesforce/cli globally via npx (no global install required)
      await execCommand("npm i -g @salesforce/cli", { fail: false, output: true });
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  async installSfPlugin(pluginName: string): Promise<{ success: boolean; message?: string }> {
    try {
      // Prefer a spawn-based approach so we can run cross-platform and write to stdin
      // This avoids relying on a shell pipe like `echo y | ...` which can fail on Windows.
      const { spawn } = await import("child_process");

      return await new Promise((resolve) => {
        try {
          const child = spawn("sf", ["plugins", "install", pluginName], {
            stdio: ["pipe", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";

          const onData = (chunk: Buffer) => {
            stdout += chunk.toString();
          };
          const onErr = (chunk: Buffer) => {
            stderr += chunk.toString();
          };

          if (child.stdout) { child.stdout.on("data", onData); }
          if (child.stderr) { child.stderr.on("data", onErr); }

          // Some versions of the CLI may prompt for confirmation; proactively send 'y' then EOF.
          // Write twice (y\n) and end stdin so the process receives EOF.
          if (child.stdin) {
            try { child.stdin.write("y\n"); } catch { /* ignore write errors */ }
            try { child.stdin.end(); } catch { /* ignore */ }
          }

          // Safety timeout in case the process hangs (30s)
          const timeout = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            resolve({ success: false, message: `Timeout installing plugin ${pluginName}` });
          }, 30_000);

          child.on("error", (_err: any) => {
            clearTimeout(timeout);
            // Fallback to execCommand for environments where spawn fails
            execCommand(`sf plugins install ${pluginName}`, { fail: false, output: true })
              .then(() => resolve({ success: true }))
              .catch((e: any) => resolve({ success: false, message: e?.message || String(e) }));
          });

          child.on("close", (code: number | null) => {
            clearTimeout(timeout);
            const exitCode = typeof code === "number" ? code : -1;
            if (exitCode === 0) {
              resolve({ success: true });
            } else {
              const msg = stderr || stdout || `sf plugins install exited with code ${exitCode}`;
              resolve({ success: false, message: msg });
            }
          });
        } catch {
          // If anything unexpected happens, fallback to execCommand
          execCommand(`sf plugins install ${pluginName}`, { fail: false, output: true })
            .then(() => resolve({ success: true }))
            .catch((e: any) => resolve({ success: false, message: e?.message || String(e) }));
        }
      });
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }

  async checkSfPlugin(pluginName: string): Promise<DependencyCheckResult> {
    try {
      const res: any = await execCommand("sf plugins", { fail: false, output: true, spinner: false });
      let stdout = (res && res.stdout && res.stdout.toString()) || "";
      // Remove trailing Uninstalled JIT section if present
      const uninstalledJitIndex = stdout.indexOf("Uninstalled JIT");
      if (uninstalledJitIndex > -1) {
        stdout = stdout.substring(0, uninstalledJitIndex).trim();
      }
      // Try to find a line with the plugin name and version, e.g. 'sfdx-hardis 1.2.3'
      const escapedName = pluginName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      if (installed && latestPluginVersion && latestPluginVersion !== installedVersion) {
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

  async installNpmPackage(packageName: string): Promise<{ success: boolean; message?: string }> {
    try {
      await execCommand(`npm i -g ${packageName}`, { fail: false, output: true });
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message || String(err) };
    }
  }
}
