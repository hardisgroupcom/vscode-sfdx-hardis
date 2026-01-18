import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";

export const sectionDefs = [
  {
    label: "User Input",
    value: "user-input",
    iconName: "utility:user",
    description: "How user input is handled in the extension.",
    keys: [
      "vsCodeSfdxHardis.userInput",
      "vsCodeSfdxHardis.userInputCommandLineIfLWC",
      "vsCodeSfdxHardis.showCommandsDetails",
      "vsCodeSfdxHardis.customCommandsConfiguration",
    ],
  },
  {
    label: "Theme",
    value: "theme",
    iconName: "utility:brush",
    description: "UI and theming options.",
    keys: [
      "vsCodeSfdxHardis.showWelcomeAtStartup",
      "vsCodeSfdxHardis.theme.colorTheme",
      "vsCodeSfdxHardis.theme.menuIconType",
      "vsCodeSfdxHardis.theme.emojisInSections",
      "vsCodeSfdxHardis.disableVsCodeColors",
    ],
  },
  {
    label: "Performance",
    value: "performance",
    iconName: "utility:indicator_performance_period",
    description: "Performance and optimization settings.",
    keys: [
      "vsCodeSfdxHardis.autoUpdateDependencies",
      "vsCodeSfdxHardis.enableMultithread",
      "vsCodeSfdxHardis.disableDefaultOrgAuthenticationCheck",
    ],
  },
  {
    label: "MCP",
    value: "mcp",
    iconName: "utility:lightning_extension",
    description: "MCP Server settings.",
    keys: ["vsCodeSfdxHardis.mcp.autoStartSalesforceCliMcp"],
  },
  {
    label: "Other",
    value: "other",
    iconName: "utility:settings",
    description: "Other settings related to the extension.",
    keys: [
      "vsCodeSfdxHardis.debugSfdxHardisCommands",
      "vsCodeSfdxHardis.debugVsCodeSfdxHardis",
      "vsCodeSfdxHardis.disableTlsRejectUnauthorized",
      "vsCodeSfdxHardis.disableGitBashCheck",
      "vsCodeSfdxHardis.disableGitMergeRequiredCheck",
      "vsCodeSfdxHardis.ignoreSfdxCliRecommendedVersion",
      "vsCodeSfdxHardis.autocloseCommands",
    ],
  },
];

export async function getExtensionConfigSections(
  extensionUri: vscode.Uri,
): Promise<any[]> {
  // Load config schema from extension package.json
  const packageJsonPath = path.join(extensionUri.fsPath, "package.json");
  let configProps: Record<string, any> = {};
  try {
    const pkg = await fs.readJson(packageJsonPath);
    configProps = pkg.contributes?.configuration?.properties || {};
  } catch {
    // fallback: no config
  }

  // Build sections with merged config info
  const sections = sectionDefs.map((section) => ({
    label: section.label,
    value: section.value,
    iconName: section.iconName,
    description: section.description,
    entries: section.keys.map((key) => {
      const prop = configProps[key] || {};
      const afterLastDot = key.lastIndexOf(".");
      const keyWithoutPrefix =
        afterLastDot >= 0 ? key.substring(afterLastDot + 1) : key;
      const label =
        prop.title ||
        keyWithoutPrefix
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (s: string) => s.toUpperCase());
      return {
        key,
        label: label,
        description: prop.description || "",
        type: prop.type || "string",
        enum: prop.enum,
        enumDescriptions: prop.enumDescriptions,
        value: vscode.workspace.getConfiguration().get(key),
        default: prop.default,
        options: prop.enum
          ? prop.enum.map((v: any, i: number) => ({
              value: v,
              label: prop.enumDescriptions
                ? prop.enumDescriptions[i]
                : String(v),
            }))
          : undefined,
      };
    }),
  }));
  return sections;
}
