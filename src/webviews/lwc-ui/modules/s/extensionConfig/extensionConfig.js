import { LightningElement, track, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";

export default class ExtensionConfig extends SharedMixin(LightningElement) {
  @track sections = [];
  @track loading = true;
  @track loadError = null;
  @track error = null;
  @track activeTabValue = null;

  @api
  initialize(data) {
    data = data || {};
    this.applyLoadingState(data);
    if (!Object.prototype.hasOwnProperty.call(data, "sections")) {
      return;
    }
    this.error = null;
    this.activeTabValue = data.activeTabValue || null;

    // Precompute all values for Lightning base components
    this.sections = (data.sections || []).map((section) => ({
      ...section,
      entries: (section.entries || []).map((entry) => {
        let valueString = "";
        let valueBoolean = false;
        let valueEnum = "";
        let valueArray = "";
        let valueNumber = null;
        let optionsLwc = [];
        // Precompute type flags for template
        const isBoolean = entry.type === "boolean";
        const isEnum =
          Array.isArray(entry.enum) && entry.enum.length > 0 && !isBoolean;
        const isArray = entry.type === "array";
        const isNumber =
          (entry.type === "integer" || entry.type === "number") && !isEnum;
        const isString = entry.type === "string" && !isEnum && !isNumber;
        if (isString) {
          valueString = entry.value ?? "";
        }
        if (isNumber) {
          valueNumber = entry.value ?? entry.default ?? null;
        }
        if (isBoolean) {
          valueBoolean = !!entry.value;
        }
        if (isEnum) {
          valueEnum = entry.value ?? entry.enum[0];
          optionsLwc = entry.enum.map((v, i) => ({
            value: v,
            label: entry.enumDescriptions
              ? entry.enumDescriptions[i]
              : String(v),
          }));
        }
        if (isArray) {
          // Convert array to newline-separated string for textarea
          const arrayValue = Array.isArray(entry.value) ? entry.value : [];
          valueArray = arrayValue.join("\n");
        }
        return {
          ...entry,
          valueString,
          valueBoolean,
          valueEnum,
          valueArray,
          valueNumber,
          optionsLwc,
          isString,
          isBoolean,
          isEnum,
          isArray,
          isNumber,
        };
      }),
    }));
  }

  handleTextChange(event) {
    const key = event.target.name;
    const value = event.detail.value;
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: { configKey: key, value },
    });
  }

  handleNumberChange(event) {
    const key = event.target.name;
    const raw = event.detail.value;
    // Ignore empty / invalid input so we never store NaN
    if (raw === "" || raw === null || raw === undefined) {
      return;
    }
    const value = Number(raw);
    if (Number.isNaN(value)) {
      return;
    }
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: { configKey: key, value },
    });
  }

  handleCheckboxChange(event) {
    const key = event.target.name;
    const value = event.target.checked;
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: { configKey: key, value },
    });
  }

  handleSelectChange(event) {
    const key = event.target.name;
    const value = event.detail.value;
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: { configKey: key, value },
    });
  }

  handleTextareaChange(event) {
    const key = event.target.name;
    const textValue = event.detail.value || "";
    // Convert newline-separated string to array, filtering out empty lines
    const value = textValue
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: { configKey: key, value },
    });
  }

  handleRefresh() {
    window.sendMessageToVSCode({ type: "refresh" });
  }

  handleRetry() {
    this.loadError = null;
    this.loading = true;
    window.sendMessageToVSCode({ type: "retryInit" });
  }

  @api
  handleMessage(type, data) {
    if (type === "updateSuccess") {
      this.error = null;
    } else if (type === "updateError") {
      this.error = data;
    }
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the SharedMixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }
}
