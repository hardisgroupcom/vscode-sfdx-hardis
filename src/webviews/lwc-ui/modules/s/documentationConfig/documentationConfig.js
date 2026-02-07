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

  _schema = {};

  connectedCallback() {
    // Request config data from extension
    window.sendMessageToVSCode({ type: "requestDocConfig" });
  }

  @api
  initialize(data) {
    if (data) {
      // Build config UI
      if (data.config) {
        this._buildConfigUI(data.config, data.schema);
        this.configLoading = false;
      }
    }
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    }
    else if (type === "configLoaded") {
      this._buildConfigUI(data.config, data.schema);
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
    this._buildSections();
  }

  _extractLlmProviderOptions() {
    const langchainProviderDef = this._schema && this._schema.langchainLlmProvider;
    if (langchainProviderDef && langchainProviderDef.enum) {
      this.providerOptions = langchainProviderDef.enum.map((v, i) => ({
        label: (langchainProviderDef.enumNames && langchainProviderDef.enumNames[i]) || v,
        value: v,
      }));
      // Prepend empty option if not already present
      if (this.providerOptions.length > 0 && this.providerOptions[0].value !== "") {
        this.providerOptions = [{ label: "-- None --", value: "" }, ...this.providerOptions];
      }
    }
    else {
      // Fallback to default options if schema doesn't have enums
      this.providerOptions = [
        { label: "-- None --", value: "" }
      ];
    }
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
    return "";
  }

  _buildSections() {
    const sections = [];

    sections.push(
      this._buildSection(
        "Langchain Settings",
        "Configure Langchain provider and model settings.",
        [
          "langchainLlmProvider",
          "langchainLlmModel",
          "langchainLlmTemperature",
          "langchainLlmMaxTokens",
          "langchainLlmMaxRetries",
          "langchainLlmTimeout",
          "langchainLlmBaseUrl",
        ],
        this.providerSelection === "langchain",
      ),
    );

    sections.push(
      this._buildSection(
        "OpenAI Direct",
        "Configure OpenAI model settings for direct API usage.",
        ["openaiModel"],
        this.providerSelection === "openai",
      ),
    );

    sections.push(
      this._buildSection(
        "Agentforce",
        "Configure Agentforce prompt settings.",
        ["genericAgentforcePromptTemplate", "genericAgentforcePromptUrl"],
        this.providerSelection === "agentforce",
      ),
    );

    sections.push(
      this._buildSection(
        "Org Monitoring & Documentation Deployment",
        "Configure automatic deployment of generated HTML documentation during sfdx-hardis Org Monitoring metadata backup command.",
        ["docDeployToCloudflare", "docDeployToOrg"],
        true,
      ),
    );

    this.configSections = sections;
  }

  _buildSection(label, description, keys, visible) {
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
    this.configValues = {
      ...this.configValues,
      useLangchainLlm: selection === "langchain",
      useAgentforce: selection === "agentforce",
      useOpenaiDirect: selection === "openai",
    };
    this._buildSections();
    this._saveConfig();
  }

  handleOverridePrompts() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: "sf hardis:doc:override-prompts",
    });
  }

  handleOverridePromptsOverwrite() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: "sf hardis:doc:override-prompts --overwrite",
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
      data: { config: this.configValues },
    });
  }
}
