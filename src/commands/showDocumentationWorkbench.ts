import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import axios from "axios";
import { LwcPanelManager } from "../lwc-panel-manager";
import { Commands } from "../commands";
import {
  getWorkspaceRoot,
  readSfdxHardisConfig,
  writeSfdxHardisConfig,
} from "../utils";
import { Logger } from "../logger";

/**
 * AI & documentation-related fields from the sfdx-hardis JSON schema
 * that we want to expose for editing in the Documentation Workbench.
 */
const DOC_CONFIG_KEYS = [
  "promptsLanguage",
  "promptsParallelCallNumber",
  "useLangchainLlm",
  "langchainLlmProvider",
  "langchainLlmModel",
  "langchainLlmTemperature",
  "langchainLlmMaxTokens",
  "langchainLlmMaxRetries",
  "langchainLlmTimeout",
  "langchainLlmBaseUrl",
  "useOpenaiDirect",
  "openaiModel",
  "useAgentforce",
  "genericAgentforcePromptTemplate",
  "genericAgentforcePromptUrl",
  "docDeployToCloudflare",
  "docDeployToOrg",
];

const REMOTE_SCHEMA_URL =
  "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/main/config/sfdx-hardis.jsonschema.json";

const PROMPT_TEMPLATES_RELATIVE_PATH = path.join("config", "prompt-templates");

/**
 * Load the JSON schema for sfdx-hardis configuration.
 * Tries remote first, falls back to local bundled copy.
 */
async function loadJsonSchema(): Promise<any> {
  try {
    const response = await axios.get(REMOTE_SCHEMA_URL, { timeout: 8000 });
    return response.data;
  } catch (e: any) {
    Logger.log(
      `Failed to fetch remote JSON schema, falling back to local: ${e.message}`,
    );
  }
  // Fallback: local bundled schema
  const localPath = path.resolve(
    __dirname,
    "./resources/sfdx-hardis.jsonschema.json",
  );
  if (fs.existsSync(localPath)) {
    return fs.readJSONSync(localPath);
  }
  return {};
}

/**
 * Extract the schema definitions for the doc-related config keys only.
 */
function extractDocSchema(fullSchema: any): Record<string, any> {
  const props = fullSchema?.properties || {};
  const result: Record<string, any> = {};
  for (const key of DOC_CONFIG_KEYS) {
    if (props[key]) {
      result[key] = props[key];
    }
  }
  return result;
}

function getPromptTemplatesInfo(): {
  hasLocalPromptTemplates: boolean;
  promptTemplatesPath: string;
} {
  const workspaceRoot = getWorkspaceRoot();
  const promptTemplatesPath = path.join(
    workspaceRoot,
    PROMPT_TEMPLATES_RELATIVE_PATH,
  );
  let hasLocalPromptTemplates = false;

  try {
    if (
      fs.existsSync(promptTemplatesPath) &&
      fs.statSync(promptTemplatesPath).isDirectory()
    ) {
      const entries = fs.readdirSync(promptTemplatesPath);
      hasLocalPromptTemplates = entries.some((entry) =>
        entry.toLowerCase().endsWith(".txt"),
      );
    }
  } catch (e: any) {
    Logger.log(`Error checking prompt templates: ${e.message}`);
  }

  return {
    hasLocalPromptTemplates,
    promptTemplatesPath,
  };
}

function buildDocConfigPayload(config: any, schema: Record<string, any>) {
  return {
    config: config || {},
    schema: schema,
    ...getPromptTemplatesInfo(),
  };
}

export function registerShowDocumentationWorkbench(commands: Commands) {
  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showDocumentationWorkbench",
    async () => {
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading Documentation Workbench...",
          cancellable: false,
        },
        async () => {
          const lwcManager = LwcPanelManager.getInstance();

          // Load config and schema in parallel
          const [config, fullSchema] = await Promise.all([
            readSfdxHardisConfig(),
            loadJsonSchema(),
          ]);

          const schema = extractDocSchema(fullSchema);

          const panel = lwcManager.getOrCreatePanel(
            "s-documentation-workbench",
            buildDocConfigPayload(config, schema),
          );

          panel.onMessage(async (type: string, data: any) => {
            switch (type) {
              case "requestDocConfig": {
                try {
                  const freshConfig = await readSfdxHardisConfig();
                  const freshSchema = extractDocSchema(await loadJsonSchema());
                  panel.sendMessage({
                    type: "configLoaded",
                    data: buildDocConfigPayload(freshConfig, freshSchema),
                  });
                } catch (e: any) {
                  Logger.log(`Error loading doc config: ${e.message}`);
                }
                break;
              }

              case "openDocConfig": {
                try {
                  const freshConfig = await readSfdxHardisConfig();
                  const freshSchema = extractDocSchema(await loadJsonSchema());
                  const configPanel = lwcManager.getOrCreatePanel(
                    "s-documentation-config",
                    {
                      ...buildDocConfigPayload(freshConfig, freshSchema),
                      generatePdf: data?.generatePdf || false,
                      withHistory: data?.withHistory !== false,
                    },
                  );

                  configPanel.onMessage(
                    async (configType: string, configData: any) => {
                      if (configType === "requestDocConfig") {
                        try {
                          const cfg = await readSfdxHardisConfig();
                          const sch = extractDocSchema(await loadJsonSchema());
                          configPanel.sendMessage({
                            type: "configLoaded",
                            data: buildDocConfigPayload(cfg, sch),
                          });
                        } catch (e: any) {
                          Logger.log(`Error loading doc config: ${e.message}`);
                        }
                      } else if (configType === "saveDocConfig") {
                        try {
                          const configToSave = configData?.config || {};
                          for (const key of DOC_CONFIG_KEYS) {
                            if (
                              configToSave[key] !== undefined &&
                              (typeof configToSave[key] === "boolean" ||
                                configToSave[key] !== "")
                            ) {
                              await writeSfdxHardisConfig(
                                key,
                                configToSave[key],
                              );
                            }
                          }
                          configPanel.sendMessage({
                            type: "configSaved",
                            data: {},
                          });
                        } catch (e: any) {
                          Logger.log(`Error saving doc config: ${e.message}`);
                          configPanel.sendMessage({
                            type: "configSaveError",
                            data: { message: e.message },
                          });
                          vscode.window.showErrorMessage(
                            `Error saving configuration: ${e.message}`,
                          );
                        }
                      } else if (configType === "updateGenerationOptions") {
                        panel.sendMessage({
                          type: "updateGenerationOptions",
                          data: configData,
                        });
                      }
                    },
                  );
                } catch (e: any) {
                  Logger.log(`Error opening doc config panel: ${e.message}`);
                }
                break;
              }

              case "saveDocConfig": {
                try {
                  const configToSave = data?.config || {};
                  for (const key of DOC_CONFIG_KEYS) {
                    // Allow booleans (including false) and non-empty string values
                    if (
                      configToSave[key] !== undefined &&
                      (typeof configToSave[key] === "boolean" ||
                        configToSave[key] !== "")
                    ) {
                      await writeSfdxHardisConfig(key, configToSave[key]);
                    }
                  }
                  panel.sendMessage({ type: "configSaved", data: {} });
                  vscode.window.showInformationMessage(
                    "Documentation configuration saved successfully.",
                  );
                } catch (e: any) {
                  Logger.log(`Error saving doc config: ${e.message}`);
                  panel.sendMessage({
                    type: "configSaveError",
                    data: { message: e.message },
                  });
                  vscode.window.showErrorMessage(
                    `Error saving configuration: ${e.message}`,
                  );
                }
                break;
              }

              default:
                break;
            }
          });
        },
      );
    },
  );
  commands.disposables.push(disposable);
}
