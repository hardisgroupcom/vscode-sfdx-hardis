import { LightningElement, api, track } from "lwc";

/**
 * Documentation Configuration LWC Component
 *
 * Provides configuration UI for documentation generation:
 * - Prompt template override
 * - AI provider & doc deployment settings
 */
export default class DocumentationConfig extends LightningElement {
  // Config
  @track configLoading = true;
  @track configSections = [];
  @track configValues = {};
  @track providerSelection = "";
  @track providerOptions = [];
  @track promptsLanguageField = null;
  @track hasLocalPromptTemplates = false;
  @track promptTemplatesPath = "";
  @track overwriteLocalTemplates = false;

  _schema = {};

  connectedCallback() {
    // Request config data from extension
    window.sendMessageToVSCode({ type: "requestDocConfig" });
  }

  @api
  initialize(data) {
    if (data) {
      this._applyPromptTemplatesInfo(data);
      // Build config UI
      this._buildConfigUI(data.config || {}, data.schema || {});
      this.configLoading = false;
    }
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    }
    else if (type === "configLoaded") {
      this._applyPromptTemplatesInfo(data);
      this._buildConfigUI(data?.config || {}, data?.schema || {});
      this.configLoading = false;
    }
  }

  // ─── Config UI builder ───────────────────────────────────────────────

  _buildConfigUI(config, schema) {
    this.configValues = { ...(config || {}) };
    this._schema = schema || {};
    
    // Extract LLM provider options from schema if available
    this._extractLlmProviderOptions();
    
    this.providerSelection = this._detectProviderSelection();
    this.promptsLanguageField = this._buildFieldDef(
      "promptsLanguage",
      (this._schema && this._schema.promptsLanguage) || {},
      this.configValues,
    );
    this._buildSections();
  }

  _applyPromptTemplatesInfo(data) {
    if (!data) {
      return;
    }
    this.hasLocalPromptTemplates = !!data.hasLocalPromptTemplates;
    this.promptTemplatesPath = data.promptTemplatesPath || "";
    if (!this.hasLocalPromptTemplates) {
      this.overwriteLocalTemplates = false;
    }
  }

  _extractLlmProviderOptions() {
    // Provider options are fixed based on provider type, not schema
    this.providerOptions = [
      { label: "-- None --", value: "" },
      { label: "Langchain LLMs", value: "langchain" },
      { label: "Agentforce", value: "agentforce" },
      { label: "OpenAI Direct", value: "openai" },
    ];
  }

  _hasAnyValue(keys) {
    return keys.some((key) => {
      const value = this.configValues[key];
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === "string") {
        return value.trim() !== "";
      }
      return value !== false;
    });
  }

  _detectProviderSelection() {
    if (this.configValues.useLangchainLlm) {
      return "langchain";
    }
    if (this.configValues.useAgentforce) {
      return "agentforce";
    }
    if (this.configValues.useOpenaiDirect) {
      return "openai";
    }
    if (
      this._hasAnyValue([
        "langchainLlmProvider",
        "langchainLlmModel",
        "langchainLlmTemperature",
        "langchainLlmMaxTokens",
        "langchainLlmMaxRetries",
        "langchainLlmTimeout",
        "langchainLlmBaseUrl",
      ])
    ) {
      return "langchain";
    }
    if (
      this._hasAnyValue([
        "genericAgentforcePromptTemplate",
        "genericAgentforcePromptUrl",
      ])
    ) {
      return "agentforce";
    }
    if (this._hasAnyValue(["openaiModel"])) {
      return "openai";
    }
    return "";
  }

  _buildSections() {
    const sections = [];

    const providerFields = [
      {
        key: "providerSelection",
        title: "Provider",
        description: "",
        value: this.providerSelection,
        isBoolean: false,
        isEnum: false,
        isNumber: false,
        isText: false,
        isProviderSelect: true,
        options: this.providerOptions,
      },
    ];

    if (this.providerSelection !== "" && this.promptsLanguageField) {
      providerFields.push({ ...this.promptsLanguageField });
    }

    let providerKeys = [];
    if (this.providerSelection === "langchain") {
      providerKeys = [
        "langchainLlmProvider",
        "langchainLlmModel",
        "langchainLlmTemperature",
        "langchainLlmMaxTokens",
        "langchainLlmMaxRetries",
        "langchainLlmTimeout",
        "langchainLlmBaseUrl",
      ];
    }
    else if (this.providerSelection === "openai") {
      providerKeys = ["openaiModel"];
    }
    else if (this.providerSelection === "agentforce") {
      providerKeys = [
        "genericAgentforcePromptTemplate",
        "genericAgentforcePromptUrl",
      ];
    }

    const providerSpecificFields = providerKeys.map((key) =>
      this._buildFieldDef(
        key,
        (this._schema && this._schema[key]) || {},
        this.configValues,
      ),
    );

    sections.push(
      this._buildSectionFromFields(
        "AI Provider & Settings",
        "Select the AI provider, prompts language, and configure provider-specific settings.",
        [...providerFields, ...providerSpecificFields],
        true,
        false,
      ),
    );

    sections.push(
      this._buildSection(
        "Org Monitoring & Documentation Deployment",
        "Configure automatic deployment of generated HTML documentation during sfdx-hardis Org Monitoring metadata backup command.",
        ["docDeployToCloudflare", "docDeployToOrg"],
        true,
        true, // Show inline descriptions instead of help icons
      ),
    );

    this.configSections = sections;
  }

  _buildSection(label, description, keys, visible, showInlineDescriptions = false) {
    const fields = [];
    for (const key of keys) {
      const schemaDef = (this._schema && this._schema[key]) || {};
      const field = this._buildFieldDef(key, schemaDef, this.configValues);
      fields.push(field);
    }
    return {
      label,
      description,
      fields,
      visible,
      showInlineDescriptions,
    };
  }

  _buildSectionFromFields(label, description, fields, visible, showInlineDescriptions = false) {
    return {
      label,
      description,
      fields,
      visible,
      showInlineDescriptions,
    };
  }

  _buildFieldDef(key, schemaDef, config) {
    const value = config && config[key] !== undefined ? config[key] : (schemaDef.default !== undefined ? schemaDef.default : "");
    const type = schemaDef.type || "string";
    const title = schemaDef.title || this._prettifyKey(key);
    const description = schemaDef.description || "";

    const isBoolean = type === "boolean";
    const isEnum = !!schemaDef.enum;
    const isNumber = type === "number";
    const isText = !isBoolean && !isEnum && !isNumber;

    let options = [];
    if (isEnum && schemaDef.enum) {
      options = schemaDef.enum.map((v, i) => ({
        label: (schemaDef.enumNames && schemaDef.enumNames[i]) || v,
        value: v,
      }));
      // prepend empty option
      options = [{ label: "-- None --", value: "" }, ...options];
    }

    return {
      key,
      title,
      description,
      value: isBoolean ? !!value : (value ?? ""),
      isBoolean,
      isEnum,
      isNumber,
      isText,
      options,
    };
  }

  _prettifyKey(key) {
    // camelCase → Title Case
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }

  // ─── Event handlers ──────────────────────────────────────────────────

  handleProviderChange(event) {
    const selection = event.detail ? event.detail.value : event.target.value;
    this.providerSelection = selection;
    // Update provider flags: explicitly set each one based on selection
    this.configValues = {
      ...this.configValues,
      useLangchainLlm: selection === "langchain",
      useAgentforce: selection === "agentforce",
      useOpenaiDirect: selection === "openai",
    };
    // Rebuild sections to show/hide provider-specific fields
    this._buildSections();
    // Save the provider selection to config
    this._saveConfig();
  }

  handleOverridePrompts() {
    const command = this.overwriteLocalTemplates
      ? "sf hardis:doc:override-prompts --overwrite"
      : "sf hardis:doc:override-prompts";
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command: command },
    });
  }

  handleOverwriteLocalTemplatesChange(event) {
    this.overwriteLocalTemplates = !!event.target.checked;
  }

  handleShowPromptTemplates() {
    if (!this.promptTemplatesPath) {
      return;
    }
    window.sendMessageToVSCode({
      type: "openFolder",
      data: { folderPath: this.promptTemplatesPath },
    });
  }

  handleConfigFieldChange(event) {
    const key = event.target.dataset.key || event.target.name;
    let value;
    if (event.target.type === "checkbox") {
      value = event.target.checked;
    }
    else if (event.target.type === "number") {
      value = event.detail ? event.detail.value : event.target.value;
      value = value !== "" && value !== null ? Number(value) : undefined;
    }
    else {
      value = event.detail ? event.detail.value : event.target.value;
    }
    this.configValues = { ...this.configValues, [key]: value };

    if (key === "promptsLanguage" && this.promptsLanguageField) {
      this.promptsLanguageField = {
        ...this.promptsLanguageField,
        value: value ?? "",
      };
    }

    // Update the field value in sections for reactivity
    this.configSections = this.configSections.map((sect) => ({
      ...sect,
      fields: sect.fields.map((f) =>
        f.key === key
          ? { ...f, value: f.isBoolean ? !!value : (value ?? "") }
          : f
      ),
    }));

    // Auto-save configuration
    this._saveConfig();
  }

  _saveConfig() {
    window.sendMessageToVSCode({
      type: "saveDocConfig",
      data: { config: JSON.parse(JSON.stringify(this.configValues)) },
    });
  }
}
