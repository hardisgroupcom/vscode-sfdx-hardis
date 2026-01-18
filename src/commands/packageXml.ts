import * as vscode from "vscode";
import * as fs from "fs-extra";
import path from "path";
import { LwcPanelManager } from "../lwc-panel-manager";
import { getWorkspaceRoot } from "../utils";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { openMetadataFile } from "../utils/projectUtils";
import { Commands } from "../commands";

export function registerShowPackageXml(commandThis: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPackageXml",
    async (packageXml) => {
      // get relative path if uri is absolute
      const packageXmlRelativePath = packageXml?.fsPath
        ? path.relative(getWorkspaceRoot(), packageXml.fsPath)
        : undefined;
      const packageConfig = {
        filePath: packageXmlRelativePath,
      };
      await showPackageXmlPanel(packageConfig);
    },
  );
  commandThis.disposables.push(disposable);
}

export async function showPackageXmlPanel(
  packageConfig: any = {},
): Promise<void> {
  const lwcManager = LwcPanelManager.getInstance();

  // Default to skip items if no config provided (backward compatibility)
  const config = {
    packageType: packageConfig.packageType || "",
    filePath: packageConfig.filePath || "",
    fallbackFilePath: packageConfig.fallbackFilePath || null,
    title: packageConfig.title || "Package Configuration",
  };

  try {
    let packageData;
    let actualFilePath = config.filePath;

    const showLoadError = (err: any) => {
      vscode.window.showErrorMessage(
        `Unable to load package XML: ${err.message}`,
      );
    };

    try {
      packageData = await loadPackageXmlData(config.filePath);
    } catch (error) {
      // Try fallback file if specified and main file fails
      if (config.fallbackFilePath) {
        try {
          packageData = await loadPackageXmlData(config.fallbackFilePath);
          actualFilePath = config.fallbackFilePath; // Update to show the actual loaded file
        } catch {
          showLoadError(error);
          return;
        }
      } else {
        showLoadError(error);
        return;
      }
    }

    const panel = lwcManager.getOrCreatePanel("s-package-xml", {
      packageData: packageData,
      config: { ...config, filePath: actualFilePath },
    });
    panel.updateTitle(config.title);

    // Handle messages from the Package XML panel
    panel.onMessage(async (type: string, data: any) => {
      switch (type) {
        case "refreshPackageConfig": {
          await refreshPackageData(data, config, panel);
          break;
        }
        case "addMetadataType": {
          await handleAddMetadataType(data, config, panel);
          break;
        }
        case "addMetadataMember": {
          await handleAddMetadataMember(data, config, panel);
          break;
        }
        case "removeMetadataType": {
          await handleRemoveMetadataType(data, config, panel);
          break;
        }
        case "removeMetadataMember": {
          await handleRemoveMetadataMember(data, config, panel);
          break;
        }
        case "editPackageFile": {
          await openPackageFile(data, config);
          break;
        }
        case "backToMonitoring": {
          vscode.commands.executeCommand(
            "vscode-sfdx-hardis.showOrgMonitoring",
          );
          break;
        }
        case "openMetadataMember": {
          await handleOpenMetadataMember(data);
          break;
        }
        default:
          break;
      }
    });
  } catch (error: any) {
    const panel = lwcManager.getOrCreatePanel("s-package-xml", {
      error: error.message,
    });
    panel.updateTitle("Package Configuration - Error");
  }
}

async function handleAddMetadataType(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
) {
  await mutateWithType(data, config, panel, (packageData, typeName) => {
    const typeExists = packageData.types.some((t: any) => t.name === typeName);
    if (typeExists) {
      return packageData;
    }
    return {
      ...packageData,
      types: [...packageData.types, { name: typeName, members: [] }],
    };
  });
}

async function handleAddMetadataMember(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
) {
  await mutateWithTypeAndMember(
    data,
    config,
    panel,
    (packageData, typeName, memberName) => {
      const updatedTypes = [...packageData.types];
      let type = updatedTypes.find((t: any) => t.name === typeName);
      if (!type) {
        type = { name: typeName, members: [] };
        updatedTypes.push(type);
      }

      if (!type.members.includes(memberName)) {
        type.members = [...type.members, memberName];
      }

      return { ...packageData, types: updatedTypes };
    },
  );
}

async function handleRemoveMetadataType(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
) {
  await mutateWithType(data, config, panel, (packageData, typeName) => ({
    ...packageData,
    types: packageData.types.filter((t: any) => t.name !== typeName),
  }));
}

async function handleRemoveMetadataMember(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
) {
  await mutateWithTypeAndMember(
    data,
    config,
    panel,
    (packageData, typeName, memberName) => {
      const updatedTypes = packageData.types
        .map((t: any) => {
          if (t.name !== typeName) {
            return t;
          }
          const remainingMembers = t.members.filter((m: string) => m !== memberName);
          if (remainingMembers.length === 0) {
            return null;
          }
          return { ...t, members: remainingMembers };
        })
        .filter((t: any) => t !== null);

      return { ...packageData, types: updatedTypes };
    },
  );
}

async function mutatePackageXml(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
  mutator: (pkg: any) => any,
) {
  try {
    const relativeFilePath = data?.filePath || config.filePath;
    const currentData = await loadPackageXmlData(relativeFilePath);
    const mutatedData = mutator(currentData);
    const sortedData = sortPackageData(mutatedData);

    await savePackageXmlData(relativeFilePath, sortedData);

    panel.sendMessage({
      type: "packageDataUpdated",
      data: {
        packageData: sortedData,
        config: { ...config, filePath: relativeFilePath },
      },
    });
  } catch (error: any) {
    panel.sendMessage({
      type: "packageDataUpdated",
      data: {
        error: error.message,
        config: config,
      },
    });
    vscode.window.showErrorMessage(`Unable to update package.xml: ${error.message}`);
  }
}

async function mutateWithRequiredFields(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
  requiredFields: Array<"metadataType" | "memberName">,
  mutator: (pkg: any, values: { metadataType?: string; memberName?: string }) => any,
) {
  const values: { metadataType?: string; memberName?: string } = {};
  for (const field of requiredFields) {
    const value = data?.[field];
    if (!value) {
      return;
    }
    values[field] = value;
  }

  await mutatePackageXml(data, config, panel, (packageData) =>
    mutator(packageData, values),
  );
}

async function mutateWithType(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
  mutator: (pkg: any, typeName: string) => any,
) {
  await mutateWithRequiredFields(
    data,
    config,
    panel,
    ["metadataType"],
    (packageData, values) => mutator(packageData, values.metadataType as string),
  );
}

async function mutateWithTypeAndMember(
  data: any,
  config: { packageType: any; filePath: any; fallbackFilePath: any; title: any },
  panel: LwcUiPanel,
  mutator: (pkg: any, typeName: string, memberName: string) => any,
) {
  await mutateWithRequiredFields(
    data,
    config,
    panel,
    ["metadataType", "memberName"],
    (packageData, values) =>
      mutator(
        packageData,
        values.metadataType as string,
        values.memberName as string,
      ),
  );
}

function sortPackageData(packageData: {
  apiVersion?: string;
  types: Array<{ name: string; members: string[] }>;
}) {
  const sortedTypes = [...(packageData.types || [])]
    .map((type) => ({
      ...type,
      members: [...(type.members || [])].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...packageData,
    types: sortedTypes,
  };
}

async function handleOpenMetadataMember(data: any) {
  const metadataType = data?.metadataType;
  const metadataName = data?.metadataName;
  await openMetadataFile(metadataType, metadataName);
}

async function openPackageFile(
  data: any,
  config: {
    packageType: any;
    filePath: any;
    fallbackFilePath: any;
    title: any;
  },
) {
  const workspaceRoot = getWorkspaceRoot();
  const editFilePath = data?.filePath || config.filePath;
  const packagePath = path.join(workspaceRoot, editFilePath);
  try {
    const document = await vscode.workspace.openTextDocument(packagePath);
    await vscode.window.showTextDocument(document);
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to open package file: ${error.message}`,
    );
  }
}

async function refreshPackageData(
  data: any,
  config: {
    packageType: any;
    filePath: any;
    fallbackFilePath: any;
    title: any;
  },
  panel: LwcUiPanel,
) {
  try {
    const refreshFilePath = data?.filePath || config.filePath;
    const newPackageData = await loadPackageXmlData(refreshFilePath);
    panel.sendMessage({
      type: "packageDataUpdated",
      data: {
        packageData: sortPackageData(newPackageData),
        config: { ...config, filePath: refreshFilePath },
      },
    });
  } catch (error: any) {
    panel.sendMessage({
      type: "packageDataUpdated",
      data: {
        error: error.message,
        config: config,
      },
    });
  }
}

async function loadPackageXmlData(
  relativeFilePath: string = "manifest/package-skip-items.xml",
): Promise<any> {
  const workspaceRoot = getWorkspaceRoot();
  const packagePath = path.join(workspaceRoot, relativeFilePath);

  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package file not found: ${relativeFilePath}`);
  }

  try {
    const xmlContent = await fs.readFile(packagePath, "utf8");
    return await parsePackageXml(xmlContent);
  } catch (error: any) {
    throw new Error(`Failed to read package-skip-items.xml: ${error.message}`);
  }
}

export async function parsePackageXml(xmlContent: string): Promise<any> {
  // Simple XML parsing for package.xml structure
  try {
    // Extract API version
    const apiVersionMatch = xmlContent.match(/<version>([^<]+)<\/version>/);
    const apiVersion = apiVersionMatch ? apiVersionMatch[1] : "Unknown";

    // Extract types
    const typesRegex = /<types>([\s\S]*?)<\/types>/g;
    const types: any[] = [];
    let typeMatch;

    while ((typeMatch = typesRegex.exec(xmlContent)) !== null) {
      const typeContent = typeMatch[1];

      // Extract type name
      const nameMatch = typeContent.match(/<name>([^<]+)<\/name>/);
      const typeName = nameMatch ? nameMatch[1] : "Unknown";

      // Extract members
      const membersRegex = /<members>([^<]+)<\/members>/g;
      const members: string[] = [];
      let memberMatch;

      while ((memberMatch = membersRegex.exec(typeContent)) !== null) {
        members.push(memberMatch[1]);
      }

      if (typeName !== "Unknown") {
        types.push({
          name: typeName,
          members: members,
        });
      }
    }

    return {
      apiVersion: apiVersion,
      types: types,
    };
  } catch (error: any) {
    throw new Error(`Failed to parse XML content: ${error.message}`);
  }
}

async function savePackageXmlData(
  relativeFilePath: string,
  packageData: { apiVersion?: string; types: Array<{ name: string; members: string[] }> },
) {
  const workspaceRoot = getWorkspaceRoot();
  const packagePath = path.join(workspaceRoot, relativeFilePath);

  const apiVersion = packageData.apiVersion || "65.0";

  const metadataList: Array<{ memberType: string; memberName: string }> = [];
  for (const type of packageData.types || []) {
    for (const member of type.members || []) {
      metadataList.push({ memberType: type.name, memberName: member });
    }
    if (!type.members || type.members.length === 0) {
      // Allow empty type: keep the type with no members only if explicitly desired?
      // Here we skip writing empty types to keep package lean.
    }
  }

  // Sort types and members for deterministic output
  metadataList.sort((a, b) => {
    if (a.memberType === b.memberType) {
      return a.memberName.localeCompare(b.memberName);
    }
    return a.memberType.localeCompare(b.memberType);
  });

  const xmlContent = generatePackageXml(metadataList, apiVersion);
  await fs.ensureDir(path.dirname(packagePath));
  await fs.writeFile(packagePath, xmlContent, { encoding: "utf8" });
}

/**
 * Generate package.xml content from metadata list
 * @param metadataList Array of {memberType, memberName} objects
 * @param apiVersion API version to use (defaults to project version)
 * @returns Package XML string
 */
export function generatePackageXml(
  metadataList: Array<{ memberType: string; memberName: string }>,
  apiVersion: string = "65.0",
): string {
  // Group metadata by type
  const metadataByType = new Map<string, Set<string>>();

  for (const item of metadataList) {
    if (!metadataByType.has(item.memberType)) {
      metadataByType.set(item.memberType, new Set<string>());
    }
    metadataByType.get(item.memberType)!.add(item.memberName);
  }

  // Build package.xml content with grouped types (sorted alphabetically)
  const sortedTypes = Array.from(metadataByType.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  const typesBlocks = sortedTypes
    .map(([memberType, memberNames]) => {
      const sortedMembers = Array.from(memberNames).sort();
      return `  <types>\n${sortedMembers.map((name) => `    <members>${name}</members>`).join("\n")}\n    <name>${memberType}</name>\n  </types>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${typesBlocks}
  <version>${apiVersion}</version>
</Package>`;
}

/**
 * Merge new metadata into an existing package.xml file
 * Creates the file if it doesn't exist
 * @param packageXmlPath Path to the package.xml file
 * @param metadataList Array of {memberType, memberName} objects to merge
 * @param apiVersion API version to use for new files
 */
export async function mergeIntoPackageXml(
  packageXmlPath: string,
  metadataList: Array<{ memberType: string; memberName: string }>,
  apiVersion: string = "65.0",
): Promise<void> {
  try {
    // Group new metadata by type
    const newMetadataByType = new Map<string, Set<string>>();
    for (const item of metadataList) {
      if (!newMetadataByType.has(item.memberType)) {
        newMetadataByType.set(item.memberType, new Set<string>());
      }
      newMetadataByType.get(item.memberType)!.add(item.memberName);
    }

    let existingPackageData: any = null;
    let existingApiVersion = apiVersion;

    // Try to load existing package.xml
    if (await fs.pathExists(packageXmlPath)) {
      try {
        const xmlContent = await fs.readFile(packageXmlPath, "utf8");
        existingPackageData = await parsePackageXml(xmlContent);
        existingApiVersion = existingPackageData.apiVersion || apiVersion;
      } catch {
        // If parsing fails, we'll create a new file
      }
    }

    // Merge existing and new metadata
    const mergedMetadataByType = new Map<string, Set<string>>();

    // Add existing metadata
    if (existingPackageData && existingPackageData.types) {
      for (const type of existingPackageData.types) {
        if (!mergedMetadataByType.has(type.name)) {
          mergedMetadataByType.set(type.name, new Set<string>());
        }
        for (const member of type.members) {
          mergedMetadataByType.get(type.name)!.add(member);
        }
      }
    }

    // Add new metadata (will deduplicate automatically)
    for (const [memberType, members] of newMetadataByType) {
      if (!mergedMetadataByType.has(memberType)) {
        mergedMetadataByType.set(memberType, new Set<string>());
      }
      for (const member of members) {
        mergedMetadataByType.get(memberType)!.add(member);
      }
    }

    // Generate merged package.xml
    const mergedMetadataList: Array<{
      memberType: string;
      memberName: string;
    }> = [];
    for (const [memberType, members] of mergedMetadataByType) {
      for (const memberName of members) {
        mergedMetadataList.push({ memberType, memberName });
      }
    }

    const packageXmlContent = generatePackageXml(
      mergedMetadataList,
      existingApiVersion,
    );

    // Ensure directory exists
    await fs.ensureDir(path.dirname(packageXmlPath));

    // Write the merged package.xml
    await fs.writeFile(packageXmlPath, packageXmlContent, { encoding: "utf8" });
  } catch (error: any) {
    throw new Error(
      `Failed to merge package.xml at ${packageXmlPath}: ${error.message}`,
    );
  }
}
