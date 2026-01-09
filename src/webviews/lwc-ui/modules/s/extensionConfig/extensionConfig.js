import { LightningElement, track, api } from "lwc";
import { ColorThemeMixin } from "s/colorThemeMixin";

export default class ExtensionConfig extends ColorThemeMixin(LightningElement) {
  @track sections = [];
  @track loading = true;
  @track error = null;
  @track activeTabValue = null;

  @api
  initialize(data) {
    this.loading = false;
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
        let optionsLwc = [];
        // Precompute type flags for template
        const isBoolean = entry.type === "boolean";
        const isEnum =
          Array.isArray(entry.enum) && entry.enum.length > 0 && !isBoolean;
        const isArray = entry.type === "array";
        const isString = entry.type === "string" && !isEnum;
        if (isString) {
          valueString = entry.value ?? "";
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
          optionsLwc,
          isString,
          isBoolean,
          isEnum,
          isArray,
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

  @api
  handleMessage(type, data) {
    if (type === "updateSuccess") {
      this.error = null;
    } 
    else if (type === "updateError") {
      this.error = data;
    }
  }

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the mixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }
}
