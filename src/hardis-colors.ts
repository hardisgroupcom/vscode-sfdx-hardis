import * as vscode from "vscode";
import * as fs from "fs";
import {
  execSfdxJson,
  getUsernameInstanceUrl,
  hasSfdxProjectJson,
  listLocalSfConfigFilePaths,
  listLocalSfConfigFiles,
} from "./utils";
import { HardisStatusProvider } from "./hardis-status-provider";
import { t } from "./i18n/i18n";
import { Logger } from "./logger";
import {
  loadFromLocalConfigFile,
  readSfdxHardisConfig,
  writeSfdxHardisConfig,
} from "./utils/sfdx-hardis-config-utils";
import {
  buildOrgColorCustomizations,
  isValidHexColor,
  LEGACY_COLOR_KEYS,
  LEGACY_ORG_COLORS,
  MANAGED_COLOR_KEYS,
  matchCustomOrgColor,
  ORG_HUES,
  OrgColorKind,
  OrgColorMode,
  resolveOrgHue,
  shortenOrgHost,
  ThemeVariant,
} from "./utils/orgColorUtils";

const PRODUCTION_EDITIONS = [
  "Team Edition",
  "Professional Edition",
  "Enterprise Edition",
  "Personal Edition",
  "Unlimited Edition",
  "Contact Manager Edition",
  "Base Edition",
];

type ColorUpdateLocation = "Workspace" | "User";

/** What we wrote, where, and what was there before: kept out of user settings. */
interface AppliedColorsState {
  target: ColorUpdateLocation;
  keys: string[];
  previous: Record<string, string>;
}

const APPLIED_COLORS_STATE_KEY = "sfdxHardis.orgColors.applied";
const LEGACY_CLEANUP_STATE_KEY = "sfdxHardis.orgColors.legacyCleanupDone";

/**
 * Status bar badge per org type. The badge carries the org type as *text*, so
 * the information does not rely on color alone (red production vs orange major
 * org is exactly the pair color-blind users cannot separate), and the two
 * `statusBarItem.*Background` theme colors are rendered correctly by every
 * theme, including high contrast ones.
 */
const ORG_BADGES: Record<
  OrgColorKind,
  { icon: string; labelKey: string; severity?: "error" | "warning" }
> = {
  production: {
    icon: "shield",
    labelKey: "orgBadgeProduction",
    severity: "error",
  },
  major: { icon: "law", labelKey: "orgBadgeMajor", severity: "warning" },
  sandbox: { icon: "beaker", labelKey: "orgBadgeSandbox" },
  scratch: { icon: "rocket", labelKey: "orgBadgeScratch" },
  dev: { icon: "cloud", labelKey: "orgBadgeDev" },
};

export class HardisColors {
  context: vscode.ExtensionContext;
  disposables: vscode.Disposable[] = [];
  majorOrgInstanceUrls: any[] = [];
  currentDefaultOrg: string | undefined = undefined;
  currentDefaultOrgDomain: string | undefined | null = undefined;
  currentOrgColorKind: OrgColorKind | null = null;
  currentCustomColor: string | null = null;
  initializing: boolean = true;
  majorOrgBranch: string | undefined = undefined;
  invalidCustomOrgColorWarningShown: boolean = false;
  warnedOrgs: Set<string> = new Set();
  statusBarItem: vscode.StatusBarItem | undefined = undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async init() {
    this.initializing = true;
    await this.migrateDeprecatedSettings();
    await this.migrateLegacyOrgColors();
    await this.reset();
    // Manage colors only in a sfdx project context
    if (hasSfdxProjectJson() && vscode.workspace.workspaceFolders) {
      this.registerFileSystemWatchers();
      this.registerColorPickerCommand();
      this.registerThemeListener();
      await this.initColor();
      this.initializing = false;
    }
  }

  // Set color at initialization by reading sfdx local file(s)
  async initColor() {
    if (vscode.workspace.workspaceFolders) {
      const sfdxConfigPaths = await listLocalSfConfigFiles();
      for (const sfdxConfigPath of sfdxConfigPaths) {
        if (fs.existsSync(sfdxConfigPath)) {
          await this.manageColor(sfdxConfigPath);
          break;
        }
      }
    }
  }

  // Watch sfdx config files in order to detect changes of default org
  registerFileSystemWatchers() {
    if (vscode.workspace.workspaceFolders) {
      let prevValues: any = {};
      const sfdxConfigPaths = listLocalSfConfigFilePaths();
      for (const sfdxConfigPath of sfdxConfigPaths) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            vscode.workspace.workspaceFolders[0],
            `**/${sfdxConfigPath}`,
          ),
        );
        watcher.onDidCreate(async (uri) => {
          const fileContent = JSON.parse(
            await fs.promises.readFile(uri.fsPath, "utf8"),
          );
          prevValues[uri.fsPath] = JSON.stringify(fileContent);
          await this.manageColor(uri.fsPath);
          HardisStatusProvider.refreshOrgRelatedUis();
        });
        watcher.onDidChange(async (uri) => {
          const fileContent = JSON.parse(
            await fs.promises.readFile(uri.fsPath, "utf8"),
          );
          if (prevValues[uri.fsPath] !== JSON.stringify(fileContent)) {
            prevValues[uri.fsPath] = JSON.stringify(fileContent);
            await this.manageColor(uri.fsPath);
            HardisStatusProvider.refreshOrgRelatedUis();
          }
        });
        this.disposables.push(watcher);
      }
    }
  }

  /**
   * Re-apply the decoration when the user switches between a light and a dark
   * theme: the palette is a function of (org type, theme kind), so the shell
   * tint has to follow.
   */
  registerThemeListener() {
    const disposable = vscode.window.onDidChangeActiveColorTheme(async () => {
      await this.refreshDecoration();
    });
    this.disposables.push(disposable);
  }

  registerColorPickerCommand() {
    const disposable = vscode.commands.registerCommand(
      "vscode-sfdx-hardis.selectColorForOrg",
      async () => {
        if (!this.currentDefaultOrgDomain) {
          vscode.window.showWarningMessage(
            t("needToSelectDefaultOrg"),
            t("close"),
          );
          return;
        }
        const choice = await this.promptColor(this.currentDefaultOrgDomain);
        if (choice === null) {
          // Cancelled: restore the decoration that was previewed away
          await this.refreshDecoration();
          return;
        }
        const sfdxHardisConfig = await readSfdxHardisConfig();
        const customOrgColors = sfdxHardisConfig.customOrgColors || {};
        if (choice === "automatic") {
          delete customOrgColors[this.currentDefaultOrgDomain];
        } else {
          customOrgColors[this.currentDefaultOrgDomain] = choice;
        }
        await writeSfdxHardisConfig("customOrgColors", customOrgColors);
        await this.refreshCustomColor();
        await this.refreshDecoration();
      },
    );
    this.disposables.push(disposable);
  }

  /**
   * Let the user pick a color from the palette of the extension design system,
   * previewing each one live, rather than typing a raw hexadecimal code.
   * Returns a hex color, "automatic" to drop the override, or null if cancelled.
   */
  async promptColor(org: string): Promise<string | null> {
    const paletteItems: (vscode.QuickPickItem & { value: string })[] = [
      { label: t("orgColorNameRed"), value: ORG_HUES.production.strong },
      { label: t("orgColorNameOrange"), value: ORG_HUES.major.strong },
      { label: t("orgColorNameGreen"), value: ORG_HUES.sandbox.strong },
      { label: t("orgColorNameCyan"), value: ORG_HUES.scratch.strong },
      { label: t("orgColorNameBlue"), value: ORG_HUES.dev.strong },
    ].map((item) => {
      return { ...item, description: item.value };
    });
    const customItem: vscode.QuickPickItem & { value: string } = {
      label: `$(edit) ${t("orgColorCustom")}`,
      value: "custom",
    };
    const automaticItem: vscode.QuickPickItem & { value: string } = {
      label: `$(discard) ${t("orgColorAutomatic")}`,
      value: "automatic",
    };
    const quickPick = vscode.window.createQuickPick<
      vscode.QuickPickItem & { value: string }
    >();
    quickPick.title = t("orgColorPickTitle", { org });
    quickPick.placeholder = t("orgColorPickPlaceholder");
    quickPick.ignoreFocusOut = true;
    quickPick.items = [...paletteItems, customItem, automaticItem];
    let previewedValue: string | null = null;
    quickPick.onDidChangeActive(async (active) => {
      const value = active?.[0]?.value;
      if (!value || value === previewedValue || !isValidHexColor(value)) {
        return;
      }
      previewedValue = value;
      await this.previewColor(value);
    });
    const picked = await new Promise<
      (vscode.QuickPickItem & { value: string }) | null
    >((resolve) => {
      quickPick.onDidAccept(() => {
        resolve(quickPick.selectedItems[0] || null);
        quickPick.hide();
      });
      quickPick.onDidHide(() => {
        resolve(null);
        quickPick.dispose();
      });
      quickPick.show();
    });
    if (!picked) {
      return null;
    }
    if (picked.value === "custom") {
      return await this.promptCustomHexColor(org);
    }
    return picked.value;
  }

  // Free hexadecimal input, kept as an escape hatch behind the palette
  async promptCustomHexColor(org: string): Promise<string | null> {
    const inputBoxOptions: vscode.InputBoxOptions = {
      prompt: t("enterColorPrompt", { org }),
      placeHolder: t("enterColorPlaceholder"),
      ignoreFocusOut: true,
      validateInput: (text) => {
        return isValidHexColor(text)
          ? null
          : "This is not a valid color code ! (ex: #0335fc)";
      },
    };
    try {
      const color = await vscode.window.showInputBox(inputBoxOptions);
      return color || null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return null;
    }
  }

  // Read file and check if it has to be colored
  async manageColor(file: string) {
    const fileContent = JSON.parse(await fs.promises.readFile(file, "utf8"));
    const fileDefaultOrg =
      fileContent["target-org"] || fileContent["defaultusername"];
    if (fileDefaultOrg !== this.currentDefaultOrg) {
      this.currentDefaultOrg = fileDefaultOrg;
      // Pass the username UNQUOTED so it hits the shared "orgs" cache populated
      // by the status panel (a pre-quoted value missed the cache → cold 25-40s
      // `sf org display` every startup). Low priority: org coloring is cosmetic
      // background work and must never block an interactive panel command.
      this.currentDefaultOrgDomain = this.currentDefaultOrg
        ? await getUsernameInstanceUrl(this.currentDefaultOrg, {
            lowPriority: true,
          })
        : null;
      this.currentOrgColorKind = await this.computeOrgColorKind();
      await this.refreshCustomColor();
      await this.refreshDecoration();
      this.warnAboutSensitiveOrg();
      // Refresh status panel when colors is changed except at initialization
      if (this.initializing === false) {
        vscode.commands.executeCommand(
          "vscode-sfdx-hardis.refreshStatusView",
          true,
        );
      }
    }
  }

  /**
   * Match a domain against customOrgColors keys, supporting wildcard (`*`)
   * patterns. Exact matches take priority over wildcard matches.
   */
  getCustomOrgColor(
    domain: string,
    customOrgColors: Record<string, string>,
  ): string | null {
    const { color, hasInvalidPattern } = matchCustomOrgColor(
      domain,
      customOrgColors,
    );
    if (hasInvalidPattern && this.invalidCustomOrgColorWarningShown === false) {
      this.invalidCustomOrgColorWarningShown = true;
      vscode.window.showWarningMessage(t("invalidOrgColorUrls"), t("close"));
    }
    return color;
  }

  async refreshCustomColor() {
    const sfdxHardisConfig = await readSfdxHardisConfig();
    const customOrgColors = sfdxHardisConfig.customOrgColors || {};
    this.currentCustomColor = this.getCustomOrgColor(
      this.currentDefaultOrgDomain || "",
      customOrgColors,
    );
  }

  /** Identify what kind of org the current default org is. */
  async computeOrgColorKind(): Promise<OrgColorKind | null> {
    if (!this.currentDefaultOrgDomain) {
      return null;
    }
    const isSandboxOrScratch =
      this.currentDefaultOrgDomain.includes(".sandbox.") ||
      this.currentDefaultOrgDomain.includes(".scratch.");
    if (isSandboxOrScratch) {
      // A sandbox deployed by the CI/CD server (UAT, integration...) is a major org
      if (await this.isMajorOrg(this.currentDefaultOrgDomain)) {
        return "major";
      }
      if (this.currentDefaultOrgDomain.includes(".scratch.")) {
        return "scratch";
      }
      return "sandbox";
    }
    // Production or dev org: production always wins, even when the org is also
    // declared in a .sfdx-hardis config file as a CI/CD deployment target
    const orgRes = await execSfdxJson(
      `sf data query --query "SELECT OrganizationType FROM Organization LIMIT 1" --target-org "${this.currentDefaultOrg}"`,
      {
        fail: false,
        output: true,
        cacheSection: "orgs",
        cacheExpiration: 1000 * 60 * 60 * 24 * 90 * 30, // 90 days
        // Cosmetic org-color detection — must yield to interactive panel-feature
        // commands so it never blocks opening a panel (the cold query can take
        // tens of seconds on a slow org).
        lowPriority: true,
      },
    );
    if (orgRes?.result?.records?.length === 1) {
      const org = orgRes.result.records[0];
      if (PRODUCTION_EDITIONS.includes(org.OrganizationType)) {
        return "production";
      }
      // A developer org can still be a CI/CD deployment target
      if (await this.isMajorOrg(this.currentDefaultOrgDomain)) {
        return "major";
      }
      return "dev";
    }
    return null;
  }

  /** Warn once per org and per session, not on every config file change. */
  warnAboutSensitiveOrg() {
    const orgKey = this.currentDefaultOrgDomain || this.currentDefaultOrg || "";
    if (!orgKey || this.warnedOrgs.has(orgKey)) {
      return;
    }
    if (this.currentOrgColorKind === "production") {
      this.warnedOrgs.add(orgKey);
      vscode.window.showWarningMessage(t("productionOrgWarning"), t("close"));
    } else if (this.currentOrgColorKind === "major") {
      this.warnedOrgs.add(orgKey);
      vscode.window.showWarningMessage(
        t("majorOrgWarning", { branch: this.majorOrgBranch }),
        t("close"),
      );
    }
  }

  getColorMode(): OrgColorMode {
    const mode = vscode.workspace
      .getConfiguration("vsCodeSfdxHardis")
      .get<OrgColorMode>("orgColorMode");
    if (mode === "off" || mode === "tinted" || mode === "full") {
      return mode;
    }
    return "accent";
  }

  /**
   * One-shot upgrade of the deprecated `disableVsCodeColors` boolean into
   * `orgColorMode`, so nothing in the runtime has to keep reading the old
   * setting. Self-clearing: once the deprecated key is gone, this does nothing.
   */
  async migrateDeprecatedSettings() {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const deprecated = config.inspect<boolean>("disableVsCodeColors");
    const targets: [any, ColorUpdateLocation][] = [
      [deprecated?.globalValue, "User"],
      [deprecated?.workspaceValue, "Workspace"],
    ];
    for (const [deprecatedValue, target] of targets) {
      if (deprecatedValue === undefined) {
        continue;
      }
      const configurationTarget = this.getConfigurationTarget(target);
      try {
        if (deprecatedValue === true) {
          const mode = config.inspect<OrgColorMode>("orgColorMode");
          const alreadySet =
            target === "User" ? mode?.globalValue : mode?.workspaceValue;
          if (!alreadySet) {
            await config.update("orgColorMode", "off", configurationTarget);
          }
        }
        await config.update(
          "disableVsCodeColors",
          undefined,
          configurationTarget,
        );
        Logger.log(
          `Migrated deprecated setting disableVsCodeColors to orgColorMode (${target})`,
        );
      } catch (error: any) {
        Logger.log(
          `Unable to migrate deprecated setting disableVsCodeColors: ${error.message}`,
        );
      }
    }
  }

  /**
   * One-shot cleanup of what previous versions left in the user settings: the
   * invalid `*Previous` color ids, and the hardcoded org colors they wrote.
   * Without it, those leftovers would be recorded as "the color the user had
   * before" and restored later when the feature is turned off.
   */
  async migrateLegacyOrgColors() {
    const knownOrgColors = await this.listKnownOrgColors();
    for (const target of ["Workspace", "User"] as ColorUpdateLocation[]) {
      const memento = this.getStateMemento(target);
      if (memento.get(LEGACY_CLEANUP_STATE_KEY) === true) {
        continue;
      }
      const currentColors = this.getColorCustomizationsOfTarget(target);
      const initialContent = JSON.stringify(currentColors);
      // Restore the color the user had before, then drop the invalid key
      for (const legacyKey of LEGACY_COLOR_KEYS) {
        if (currentColors[legacyKey] === undefined) {
          continue;
        }
        const originalKey = legacyKey.replace(/Previous$/, "");
        if (
          currentColors[originalKey] === undefined ||
          knownOrgColors.includes(currentColors[originalKey])
        ) {
          currentColors[originalKey] = currentColors[legacyKey];
        }
        delete currentColors[legacyKey];
      }
      // Drop any leftover org color written by a previous version
      for (const key of MANAGED_COLOR_KEYS) {
        if (knownOrgColors.includes(currentColors[key])) {
          delete currentColors[key];
        }
      }
      if (JSON.stringify(currentColors) !== initialContent) {
        await this.updateColorCustomizationsOfTarget(target, currentColors);
      }
      await memento.update(LEGACY_CLEANUP_STATE_KEY, true);
    }
  }

  getColorUpdateLocation(): ColorUpdateLocation {
    const config = vscode.workspace.getConfiguration();
    return config.get("vsCodeSfdxHardis.colorUpdateLocation") === "User"
      ? "User"
      : "Workspace";
  }

  getThemeVariant(): ThemeVariant {
    const kind = vscode.window.activeColorTheme.kind;
    if (
      kind === vscode.ColorThemeKind.Light ||
      kind === vscode.ColorThemeKind.HighContrastLight
    ) {
      return "light";
    }
    return "dark";
  }

  /**
   * High contrast themes are carefully tuned for accessibility: overriding
   * their workbench colors does more harm than good, so only the status bar
   * badge is kept there.
   */
  isHighContrastTheme(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return (
      kind === vscode.ColorThemeKind.HighContrast ||
      kind === vscode.ColorThemeKind.HighContrastLight
    );
  }

  /** Recompute and apply the shell colors and the status bar badge. */
  async refreshDecoration() {
    const mode = this.getColorMode();
    const hue = resolveOrgHue(this.currentOrgColorKind, this.currentCustomColor);
    const colors =
      mode === "off" || this.isHighContrastTheme()
        ? {}
        : buildOrgColorCustomizations(hue, mode, this.getThemeVariant());
    await this.writeColorCustomizations(colors);
    this.updateStatusBarItem();
  }

  /** Apply a color without persisting it in the sfdx-hardis configuration. */
  async previewColor(hexColor: string) {
    const mode = this.getColorMode();
    if (mode === "off" || this.isHighContrastTheme()) {
      return;
    }
    const hue = resolveOrgHue(this.currentOrgColorKind, hexColor);
    await this.writeColorCustomizations(
      buildOrgColorCustomizations(hue, mode, this.getThemeVariant()),
    );
  }

  getStateMemento(target: ColorUpdateLocation): vscode.Memento {
    return target === "User"
      ? this.context.globalState
      : this.context.workspaceState;
  }

  getConfigurationTarget(
    target: ColorUpdateLocation,
  ): vscode.ConfigurationTarget {
    return target === "User"
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;
  }

  /**
   * Read `workbench.colorCustomizations` for a single target: `get()` returns
   * the merged value, and writing that back would copy the user settings into
   * the workspace ones.
   */
  getColorCustomizationsOfTarget(
    target: ColorUpdateLocation,
  ): Record<string, string> {
    const inspected = vscode.workspace
      .getConfiguration()
      .inspect<Record<string, string>>("workbench.colorCustomizations");
    const value =
      target === "User" ? inspected?.globalValue : inspected?.workspaceValue;
    return { ...(value || {}) };
  }

  async updateColorCustomizationsOfTarget(
    target: ColorUpdateLocation,
    colors: Record<string, string>,
  ) {
    try {
      await vscode.workspace
        .getConfiguration()
        .update(
          "workbench.colorCustomizations",
          Object.keys(colors).length > 0 ? colors : undefined,
          this.getConfigurationTarget(target),
        );
    } catch (error: any) {
      Logger.log(`Unable to update VS Code org colors: ${error.message}`);
    }
  }

  /**
   * Single entry point for every settings write.
   *
   * For each target it restores what the extension had written before (using
   * the bookkeeping stored in the extension state, never in the user settings),
   * then applies the new color set on the configured target. One settings write
   * per target, so the workbench never flickers through an intermediate state.
   */
  async writeColorCustomizations(colors: Record<string, string>) {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }
    const targetToApply =
      Object.keys(colors).length > 0 ? this.getColorUpdateLocation() : null;
    for (const target of ["Workspace", "User"] as ColorUpdateLocation[]) {
      const memento = this.getStateMemento(target);
      const state = memento.get<AppliedColorsState>(APPLIED_COLORS_STATE_KEY);
      const currentColors = this.getColorCustomizationsOfTarget(target);
      const initialContent = JSON.stringify(currentColors);
      // Restore what we replaced
      for (const key of state?.keys || []) {
        if (state?.previous?.[key] !== undefined) {
          currentColors[key] = state.previous[key];
        } else {
          delete currentColors[key];
        }
      }
      // Apply the new color set on the configured target
      let newState: AppliedColorsState | undefined = undefined;
      if (target === targetToApply) {
        const previous: Record<string, string> = {};
        for (const [key, value] of Object.entries(colors)) {
          if (currentColors[key] !== undefined) {
            previous[key] = currentColors[key];
          }
          currentColors[key] = value;
        }
        newState = {
          target: target,
          keys: Object.keys(colors),
          previous: previous,
        };
      }
      if (JSON.stringify(currentColors) !== initialContent) {
        await this.updateColorCustomizationsOfTarget(target, currentColors);
      }
      if (state !== undefined || newState !== undefined) {
        await memento.update(APPLIED_COLORS_STATE_KEY, newState);
      }
    }
  }

  /**
   * Every color value that could have been written as an org color by this
   * extension, current or previous versions. Only used by the one-shot legacy
   * cleanup, to tell our own leftovers from a color the user picked.
   */
  async listKnownOrgColors(): Promise<string[]> {
    const colors = [...LEGACY_ORG_COLORS];
    for (const hue of Object.values(ORG_HUES)) {
      colors.push(hue.strong);
    }
    try {
      const sfdxHardisConfig = await readSfdxHardisConfig();
      const customOrgColors: Record<string, string> =
        sfdxHardisConfig.customOrgColors || {};
      colors.push(...Object.values(customOrgColors));
    } catch (error: any) {
      Logger.log(`Unable to read custom org colors: ${error.message}`);
    }
    return colors;
  }

  /**
   * The org type badge: the primary, always readable signal. VS Code renders
   * `statusBarItem.errorBackground` and `statusBarItem.warningBackground`
   * correctly in every theme, so no color math is needed here.
   */
  updateStatusBarItem() {
    const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
    const kind = this.currentOrgColorKind;
    if (config.get("showOrgStatusBarItem") === false || !kind) {
      this.statusBarItem?.hide();
      return;
    }
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(
        "sfdxHardis.defaultOrg",
        vscode.StatusBarAlignment.Left,
        200,
      );
      this.statusBarItem.name = "SFDX Hardis: Default Org";
      this.statusBarItem.command = "vscode-sfdx-hardis.openOrgsManager";
      this.disposables.push(this.statusBarItem);
    }
    const badge = ORG_BADGES[kind];
    const badgeLabel = t(badge.labelKey);
    const host = this.getOrgHostLabel();
    this.statusBarItem.text = host
      ? `$(${badge.icon}) ${badgeLabel} · ${host}`
      : `$(${badge.icon}) ${badgeLabel}`;
    this.statusBarItem.tooltip = t("orgBadgeTooltip", {
      type: badgeLabel,
      org: this.currentDefaultOrg || this.currentDefaultOrgDomain || host,
    });
    if (badge.severity === "error") {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
    } else if (badge.severity === "warning") {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else {
      this.statusBarItem.backgroundColor = undefined;
    }
    this.statusBarItem.show();
  }

  /** Short org name for the status bar, e.g. `wecheck--devmercury` */
  getOrgHostLabel(): string {
    return shortenOrgHost(this.currentDefaultOrgDomain || "");
  }

  async isMajorOrg(orgInstanceUrl: string) {
    this.majorOrgBranch = undefined;
    const majorOrgInstanceUrls = await this.listMajorOrgsInstanceUrls();
    const matchOrgs = majorOrgInstanceUrls.filter(
      (org) => org.instanceUrl === orgInstanceUrl,
    );
    if (matchOrgs.length > 0) {
      this.majorOrgBranch = matchOrgs[0].branch;
      return true;
    }
    return false;
  }

  // Use instanceUrl list where deployments are made by CI server, not manually (their auth config is in .sfdx-hardis config)
  async listMajorOrgsInstanceUrls() {
    // Use cache
    if (this.majorOrgInstanceUrls.length > 0) {
      return this.majorOrgInstanceUrls;
    }
    // Read config files
    if (vscode.workspace.workspaceFolders) {
      const sfdxHardisConfigFilesPattern = new vscode.RelativePattern(
        vscode.workspace.workspaceFolders[0],
        `**/.sfdx-hardis*.yml`,
      );
      const fileUris = await vscode.workspace.findFiles(
        sfdxHardisConfigFilesPattern,
      );
      const orgInstanceUrls = [];
      for (const fileUri of fileUris) {
        const sfdxHardisConfig = await loadFromLocalConfigFile(fileUri.fsPath);
        if (sfdxHardisConfig.instanceUrl) {
          let branch = "";
          const m = /.*\.sfdx-hardis\.(.*)\.yml/gm.exec(fileUri.fsPath);
          if (m && m[1]) {
            branch = m[1];
          }
          orgInstanceUrls.push({
            branch: branch,
            instanceUrl: sfdxHardisConfig.instanceUrl.replace(/\/$/, ""),
          }); // remove trailing slash if here
        }
      }
      this.majorOrgInstanceUrls = orgInstanceUrls;
      return this.majorOrgInstanceUrls;
    }
    return [];
  }

  async reset() {
    this.currentDefaultOrg = undefined;
    this.currentDefaultOrgDomain = undefined;
    this.currentOrgColorKind = null;
    this.currentCustomColor = null;
    this.majorOrgInstanceUrls = [];
    this.disposables.map((disposable) => disposable.dispose());
    this.disposables = [];
    this.statusBarItem = undefined;
    // Always clean up: leaving colors behind when the feature is switched off
    // used to strand the workspace in the color of the last selected org.
    await this.writeColorCustomizations({});
  }

  // Remove custom colors when quitting the extension or VsCode
  dispose() {
    this.reset();
  }
}
