import * as fs from "fs-extra";
import * as path from "path";
import yaml from "js-yaml";
import axios from "axios";

export interface SfdxHardisConfig {
  [key: string]: any;
}

export interface SfdxHardisConfigSchemaEntry {
  type: "text" | "enum" | "array";
  itemType?: "text" | "enum";
  options?: any[];
  default?: any;
  description?: string;
  branchAllowed?: boolean;
  globalAllowed?: boolean;
}

export interface SfdxHardisConfigSchema {
  [key: string]: SfdxHardisConfigSchemaEntry;
}

export interface SfdxHardisConfigEditorInput {
  config: SfdxHardisConfig;
  branchConfig: SfdxHardisConfig | null;
  globalConfig: SfdxHardisConfig;
  isBranch: boolean;
  branchName: string;
  configSchema: SfdxHardisConfigSchema;
  sections: Array<{ label: string; description: string; keys: string[] }>;
}

export interface SfdxHardisConfigEditorSaveData {
  config: SfdxHardisConfig;
  isBranch: boolean;
  branchName: string;
}

export class SfdxHardisConfigHelper {
  private workspaceRoot: string;
  private static _instance: SfdxHardisConfigHelper | null = null;
  static allConfigFields: Array<{
    key: string;
    schema: SfdxHardisConfigSchemaEntry;
  }> = [];
  static schemaLoaded = false;
  static readonly CONFIGURABLE_FIELDS = [
    { name: "instanceUrl", scopes: ["branch"] },
    { name: "username", scopes: ["branch"] },
    { name: "packageNoOverwritePath", scope: ["branch"] },
    { name: "useDeltaDeployment", scopes: ["global", "branch"] },
    { name: "useSmartDeploymentTests", scopes: ["global", "branch"] },
    { name: "manualActionsFileUrl", scopes: ["global"] },
    { name: "developmentBranch", scopes: ["global"] },
    { name: "allowedOrgTypes", scopes: ["global"] },
    { name: "availableProjects", scopes: ["global"] },
    { name: "availableTargetBranches", scopes: ["global"] },
    { name: "sharedDevSandboxes", scopes: ["global"] },
    { name: "newTaskNameRegex", scopes: ["global"] },
    { name: "newTaskNameRegexExample", scopes: "global" },
    { name: "installPackagesDuringCheckDeploy", scopes: ["global"] },
    { name: "autoCleanTypes", scopes: ["global"] },
    { name: "autoRetrieveWhenPull", scopes: ["global"] },
    { name: "autoRemoveUserPermissions", scopes: ["global"] },
    { name: "apexTestsMinCoverageOrgWide", scopes: ["global"] },
    { name: "extends", scopes: ["global"] },
  ];
  static readonly SECTIONS = [
    {
      label: "Salesforce Org",
      description: "",
      keys: ["instanceUrl", "username"],
    },
    {
      label: "Deployment",
      description: "",
      keys: [
        "useDeltaDeployment",
        "useSmartDeploymentTests",
        "installPackagesDuringCheckDeploy",
        "apexTestsMinCoverageOrgWide",
        "manualActionsFileUrl",
        "packageNoOverwritePath",
      ],
    },
    {
      label: "User Stories",
      description: "",
      keys: [
        "developmentBranch",
        "availableTargetBranches",
        "availableProjects",
        "allowedOrgTypes",
        "sharedDevSandboxes",
        "newTaskNameRegex",
        "newTaskNameRegexExample",
      ],
    },
    {
      label: "Salesforce Project",
      description: "",
      keys: [
        "autoCleanTypes",
        "autoRetrieveWhenPull",
        "autoRemoveUserPermissions",
      ],
    },
    {
      label: "Other",
      description: "",
      keys: ["extends"],
    },
  ];
  static readonly REMOTE_SCHEMA_URL =
    "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/main/config/sfdx-hardis.jsonschema.json";
  // Always resolve to the resources directory, compatible with both Node and Webpack
  static readonly LOCAL_SCHEMA_PATH = (() => {
    // Try to resolve in out/resources (webpacked/prod) first
    let candidate = path.resolve(
      __dirname,
      "./resources/sfdx-hardis.jsonschema.json",
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    // Fallback: try require.resolve (may work in some node/webpack setups)
    try {
      // @ts-ignore
      return require.resolve("resources/sfdx-hardis.jsonschema.json");
    } catch {
      // Not found
      return null;
    }
  })();

  /**
   * Returns the singleton instance of SfdxHardisConfigHelper for the current workspaceRoot
   */
  static getInstance(workspaceRoot: string): SfdxHardisConfigHelper {
    if (!this._instance) {
      this._instance = new SfdxHardisConfigHelper(workspaceRoot);
    } else if (this._instance.workspaceRoot !== workspaceRoot) {
      // If called with a different workspaceRoot, replace the instance
      this._instance = new SfdxHardisConfigHelper(workspaceRoot);
    }
    return this._instance;
  }

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Loads the config schema from remote or local cache, and populates allConfigFields
   */
  static async loadSchema(): Promise<void> {
    if (this.schemaLoaded) {
      return;
    }
    let schema: any = null;
    // Try remote first
    try {
      const res = await axios.get(this.REMOTE_SCHEMA_URL, { timeout: 5000 });
      if (res.status === 200 && res.data) {
        schema = res.data;
      }
    } catch (e) {
      console.warn("Failed to load remote schema, falling back to local", e);
    }
    if (!schema && this.LOCAL_SCHEMA_PATH) {
      try {
        if (await fs.pathExists(this.LOCAL_SCHEMA_PATH)) {
          schema = JSON.parse(
            await fs.readFile(this.LOCAL_SCHEMA_PATH, "utf8"),
          );
        }
      } catch (e) {
        console.warn("Failed to load local schema", e);
      }
    }
    if (schema && schema.properties) {
      this.allConfigFields = Object.entries(schema.properties)
        .filter(([key, _value]) => {
          // Filter out fields that are not in the configurable fields list
          return this.CONFIGURABLE_FIELDS.some((field) => field.name === key);
        })
        .map(([key, value]: [string, any]) => ({
          key,
          schema: {
            type: value.type,
            title: value.title,
            items: value.items,
            default: value.default,
            description: value.description,
            examples: value.examples || [],
            docUrl: value.docUrl || null,
            globalAllowed:
              this.CONFIGURABLE_FIELDS.find(
                (field) => field.name === key,
              )?.scopes?.includes("global") || false,
            branchAllowed:
              this.CONFIGURABLE_FIELDS.find(
                (field) => field.name === key,
              )?.scopes?.includes("branch") || false,
          },
        }));
      this.schemaLoaded = true;
    }
  }

  /**
   * Loads and merges global and branch config, returns data for LWC
   */
  async getEditorInput(
    branchName: string | null,
  ): Promise<SfdxHardisConfigEditorInput> {
    await SfdxHardisConfigHelper.loadSchema();
    const globalPath = path.join(this.workspaceRoot, "config/.sfdx-hardis.yml");
    const branchPath = branchName
      ? path.join(
          this.workspaceRoot,
          `config/branches/.sfdx-hardis.${branchName}.yml`,
        )
      : null;
    let globalConfig: SfdxHardisConfig = {};
    let branchConfig: SfdxHardisConfig = {};
    let config: SfdxHardisConfig = {};
    if (await fs.pathExists(globalPath)) {
      globalConfig =
        (yaml.load(
          await fs.readFile(globalPath, "utf8"),
        ) as SfdxHardisConfig) || {};
    }
    if (branchPath && (await fs.pathExists(branchPath))) {
      branchConfig =
        (yaml.load(
          await fs.readFile(branchPath, "utf8"),
        ) as SfdxHardisConfig) || {};
    }
    // Only include allowed fields for the current scope
    const isBranch = !!branchName;
    const allowedFields = SfdxHardisConfigHelper.allConfigFields
      .filter((f) =>
        isBranch ? f.schema.branchAllowed : f.schema.globalAllowed,
      )
      .map((f) => f.key);
    config = {};
    /* jscpd:ignore-start */
    for (const key of allowedFields) {
      if (isBranch) {
        if (branchConfig[key] !== undefined) {
          config[key] = branchConfig[key];
        } else if (globalConfig[key] !== undefined) {
          config[key] = globalConfig[key];
        } else {
          // Use schema default if present
          const schemaEntry = SfdxHardisConfigHelper.allConfigFields.find(
            (f) => f.key === key,
          )?.schema;
          if (schemaEntry && schemaEntry.default !== undefined) {
            config[key] = schemaEntry.default;
          }
        }
      } else {
        if (globalConfig[key] !== undefined) {
          config[key] = globalConfig[key];
        } else {
          // Use schema default if present
          const schemaEntry = SfdxHardisConfigHelper.allConfigFields.find(
            (f) => f.key === key,
          )?.schema;
          if (schemaEntry && schemaEntry.default !== undefined) {
            config[key] = schemaEntry.default;
          }
        }
      }
    }
    /* jscpd:ignore-end */
    // Build configSchema from allowed fields
    const configSchema: SfdxHardisConfigSchema = {};
    for (const field of SfdxHardisConfigHelper.allConfigFields) {
      if (
        (isBranch && field.schema.branchAllowed) ||
        (!isBranch && field.schema.globalAllowed)
      ) {
        configSchema[field.key] = field.schema;
      }
    }
    return {
      config,
      branchConfig: Object.keys(branchConfig).length ? branchConfig : null,
      globalConfig,
      isBranch,
      branchName: branchName || "",
      configSchema,
      sections: SfdxHardisConfigHelper.SECTIONS,
    };
  }

  /**
   * Saves config data from LWC (global or branch)
   */
  async saveConfigFromEditor(
    data: SfdxHardisConfigEditorSaveData,
  ): Promise<void> {
    const globalPath = path.join(this.workspaceRoot, "config/.sfdx-hardis.yml");
    if (data.isBranch && data.branchName) {
      const branchPath = path.join(
        this.workspaceRoot,
        `config/branches/.sfdx-hardis.${data.branchName}.yml`,
      );
      // Save only branch-allowed keys (diff from global)
      const globalConfig: SfdxHardisConfig = (await fs.pathExists(globalPath))
        ? (yaml.load(
            await fs.readFile(globalPath, "utf8"),
          ) as SfdxHardisConfig) || {}
        : {};
      const branchOnly: SfdxHardisConfig = {};
      await SfdxHardisConfigHelper.loadSchema();
      const branchAllowedKeys = SfdxHardisConfigHelper.allConfigFields
        .filter((f) => f.schema.branchAllowed)
        .map((f) => f.key);
      for (const key of Object.keys(data.config)) {
        if (
          branchAllowedKeys.includes(key) &&
          globalConfig[key] !== data.config[key]
        ) {
          branchOnly[key] = data.config[key];
        }
      }
      await fs.ensureDir(path.dirname(branchPath));
      // Merge with existing branch config
      if (await fs.pathExists(branchPath)) {
        const existingBranchConfig: SfdxHardisConfig =
          (yaml.load(
            await fs.readFile(branchPath, "utf8"),
          ) as SfdxHardisConfig) || {};
        Object.assign(existingBranchConfig, branchOnly);
        await fs.writeFile(branchPath, yaml.dump(existingBranchConfig), "utf8");
      } else {
        await fs.writeFile(branchPath, yaml.dump(branchOnly), "utf8");
      }
    } else {
      // Save only global-allowed keys
      await SfdxHardisConfigHelper.loadSchema();
      const globalAllowedKeys = SfdxHardisConfigHelper.allConfigFields
        .filter((f) => f.schema.globalAllowed)
        .map((f) => f.key);
      const globalOnly: SfdxHardisConfig = {};
      for (const key of Object.keys(data.config)) {
        if (globalAllowedKeys.includes(key)) {
          globalOnly[key] = data.config[key];
        }
      }
      await fs.ensureDir(path.dirname(globalPath));
      // Merge with existing global config
      if (await fs.pathExists(globalPath)) {
        const existingGlobalConfig: SfdxHardisConfig =
          (yaml.load(
            await fs.readFile(globalPath, "utf8"),
          ) as SfdxHardisConfig) || {};
        Object.assign(existingGlobalConfig, globalOnly);
        await fs.writeFile(globalPath, yaml.dump(existingGlobalConfig), "utf8");
      } else {
        // If no existing global config, just write the new one
        await fs.writeFile(globalPath, yaml.dump(globalOnly), "utf8");
      }
    }
  }
}
