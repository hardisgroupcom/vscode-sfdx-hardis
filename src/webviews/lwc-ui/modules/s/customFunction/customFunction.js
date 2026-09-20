/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

/**
 * Editor of one custom function: the script, the runtime, and the input / output contract.
 *
 * It only edits and emits a definition. Saving goes through the extension, which runs
 * `sf hardis:project:function:create|update`: the CLI stays the engine, and every field here
 * maps to a flag of those commands.
 */
export default class CustomFunction extends SharedMixin(LightningElement) {
  @api isCreate = false;
  @track editedFunction = {};
  @track validationError = "";

  @api
  set customFunction(val) {
    this.editedFunction = val
      ? JSON.parse(JSON.stringify(val))
      : { id: "", label: "", runtime: "node", script: "", inputs: [], outputs: [] };
    this.editedFunction.inputs = this.editedFunction.inputs || [];
    this.editedFunction.outputs = this.editedFunction.outputs || [];
  }
  get customFunction() {
    return this.editedFunction;
  }

  @api
  set parentTranslations(val) {
    if (val) {
      this.translations = val;
    }
  }
  get parentTranslations() {
    return this.translations;
  }

  get modalTitle() {
    return this.isCreate
      ? this.t("addCustomFunction")
      : this.t("editCustomFunction");
  }

  // The id is the deployment action type, and actions reference it, so it is fixed after creation
  get isIdReadOnly() {
    return !this.isCreate;
  }

  get runtimeOptions() {
    return [
      { label: "Node.js", value: "node" },
      { label: "Python", value: "python" },
      { label: "Bash", value: "bash" },
    ];
  }

  get whenOptions() {
    return [
      { label: this.t("customFunctionWhenAny"), value: "" },
      { label: this.t("preDeploy"), value: "pre-deploy" },
      { label: this.t("postDeploy"), value: "post-deploy" },
    ];
  }

  get inputTypeOptions() {
    return [
      { label: this.t("customFunctionInputTypeString"), value: "string" },
      { label: this.t("customFunctionInputTypeNumber"), value: "number" },
      { label: this.t("customFunctionInputTypeBoolean"), value: "boolean" },
      { label: this.t("customFunctionInputTypeSelect"), value: "select" },
      { label: this.t("customFunctionInputTypeMultiline"), value: "multiline" },
      { label: this.t("customFunctionInputTypeSecret"), value: "secret" },
    ];
  }

  /**
   * Render descriptors of the declared inputs. LWC templates cannot evaluate expressions, so
   * the options list and the "is a select" flag are computed here.
   */
  get inputRows() {
    return (this.editedFunction.inputs || []).map((input, index) => ({
      key: `input-${index}`,
      index: index,
      name: input.name || "",
      label: input.label || "",
      type: input.type || "string",
      required: input.required === true,
      default: input.default === undefined ? "" : String(input.default),
      optionsText: (input.options || []).join(", "),
      isSelect: (input.type || "string") === "select",
      // A secret holds the NAME of a CI/CD variable, so a default value would be misleading
      showDefault: (input.type || "string") !== "secret",
    }));
  }

  get outputRows() {
    return (this.editedFunction.outputs || []).map((output, index) => ({
      key: `output-${index}`,
      index: index,
      name: output.name || "",
      label: output.label || "",
    }));
  }

  get hasInputs() {
    return (this.editedFunction.inputs || []).length > 0;
  }

  get hasOutputs() {
    return (this.editedFunction.outputs || []).length > 0;
  }

  get hasValidationError() {
    return this.validationError !== "";
  }

  handleFieldChange(event) {
    const field = event.target.dataset.field;
    const value = event.target.value;
    this.editedFunction[field] = value;
    this.editedFunction = { ...this.editedFunction };
    this.validationError = "";
  }

  handleInputChange(event) {
    const index = parseInt(event.target.dataset.index, 10);
    const field = event.target.dataset.field;
    const inputs = [...(this.editedFunction.inputs || [])];
    const input = { ...inputs[index] };
    if (field === "required") {
      input.required = event.target.checked;
    } else if (field === "options") {
      input.options = String(event.target.value || "")
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean);
    } else {
      input[field] = event.target.value;
    }
    inputs[index] = input;
    this.editedFunction = { ...this.editedFunction, inputs: inputs };
    this.validationError = "";
  }

  handleOutputChange(event) {
    const index = parseInt(event.target.dataset.index, 10);
    const field = event.target.dataset.field;
    const outputs = [...(this.editedFunction.outputs || [])];
    outputs[index] = { ...outputs[index], [field]: event.target.value };
    this.editedFunction = { ...this.editedFunction, outputs: outputs };
    this.validationError = "";
  }

  handleAddInput() {
    const inputs = [...(this.editedFunction.inputs || []), { name: "", type: "string" }];
    this.editedFunction = { ...this.editedFunction, inputs: inputs };
  }

  handleRemoveInput(event) {
    const index = parseInt(event.target.dataset.index, 10);
    const inputs = (this.editedFunction.inputs || []).filter(
      (_input, inputIndex) => inputIndex !== index,
    );
    this.editedFunction = { ...this.editedFunction, inputs: inputs };
  }

  handleAddOutput() {
    const outputs = [...(this.editedFunction.outputs || []), { name: "" }];
    this.editedFunction = { ...this.editedFunction, outputs: outputs };
  }

  handleRemoveOutput(event) {
    const index = parseInt(event.target.dataset.index, 10);
    const outputs = (this.editedFunction.outputs || []).filter(
      (_output, outputIndex) => outputIndex !== index,
    );
    this.editedFunction = { ...this.editedFunction, outputs: outputs };
  }

  handleClose() {
    this.dispatchEvent(new CustomEvent("close"));
  }

  /**
   * Local checks only, for immediate feedback. The CLI re-validates everything (script file
   * exists, id does not collide with a built-in type, select without options...) and is the
   * authority: this never tries to reimplement it.
   */
  handleSave() {
    const definition = this.editedFunction;
    if (!String(definition.id || "").trim()) {
      this.validationError = this.t("customFunctionIdRequired");
      return;
    }
    if (!String(definition.label || "").trim()) {
      this.validationError = this.t("customFunctionLabelRequired");
      return;
    }
    if (!String(definition.script || "").trim()) {
      this.validationError = this.t("customFunctionScriptRequired");
      return;
    }
    const namelessInput = (definition.inputs || []).some(
      (input) => !String(input.name || "").trim(),
    );
    if (namelessInput) {
      this.validationError = this.t("customFunctionInputNameRequired");
      return;
    }
    const namelessOutput = (definition.outputs || []).some(
      (output) => !String(output.name || "").trim(),
    );
    if (namelessOutput) {
      this.validationError = this.t("customFunctionOutputNameRequired");
      return;
    }
    const payload = { ...definition };
    if (payload.timeout) {
      payload.timeout = parseInt(payload.timeout, 10);
    }
    if (!payload.when) {
      delete payload.when;
    }
    this.dispatchEvent(new CustomEvent("save", { detail: payload }));
  }
}
