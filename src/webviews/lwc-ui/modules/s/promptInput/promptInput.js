/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";

export default class PromptInput extends LightningElement {
  @api promptData = null;
  @api embedded = false;
  @track currentPrompt = null;
  @track inputValue = "";
  @track selectedValues = [];
  @track selectedValue = ""; // Single value for select input (string identifier)
  @track selectedOptionDescription = ""; // Description for selected option
  @track isVisible = false;
  @track isSubmitting = false; // Track if submission is in progress
  @track error = null;
  // Centralized mapping: string identifier -> original value
  @track choiceValueMapping = {};
  // Reverse mapping: JSON-stringified original value -> string identifier
  @track valueToIdentifier = {};
  _hasInitialFocus = false; // Track if initial focus has been set

  // Dynamically set card classes based on embedded property
  get cardClass() {
    return this.embedded ? "" : "slds-card slds-card_boundary";
  }

  get cardBodyClass() {
    return this.embedded ? "" : "slds-card__body slds-card__body_inner";
  }

  connectedCallback() {
    // Listen for prompt events from parent
    this.addEventListener("promptrequest", this.handlePromptRequest.bind(this));

    // Make component available globally for VS Code message handling
    if (typeof window !== "undefined") {
      window.promptInputComponent = this;
    }
  }

  renderedCallback() {
    // Update the prompt message content manually to properly handle HTML entities
    const messageElement = this.template.querySelector(
      ".prompt-message-content",
    );
    if (messageElement && this.currentPrompt && this.currentPrompt.message) {
      messageElement.textContent = this.decodeHtmlEntities(
        this.currentPrompt.message,
      );
    }

    // Only perform initial focus when the prompt first becomes visible
    if (this.isVisible && this.currentPrompt && !this._hasInitialFocus) {
      this._hasInitialFocus = true;
      setTimeout(() => {
        let firstInput;
        // For button select, focus the first button
        if (this.isSelectWithButtons) {
          firstInput = this.template.querySelector(".select-option-button");
        } else {
          // For other inputs, focus the input/combobox but don't interfere with dropdown navigation
          firstInput = this.template.querySelector(
            "lightning-input, lightning-combobox",
          );
        }
        if (firstInput && typeof firstInput.focus === "function") {
          firstInput.focus();
        }

        // Scroll validate button into view if embedded and not multiselect and not select with buttons
        if (this.embedded && !this.isMultiselectInput) {
          // Find the cancel button (neutral variant)
          const cancelBtn = this.template.querySelector(
            'lightning-button[variant="neutral"]',
          );
          if (cancelBtn && cancelBtn.focus) {
            // LWC base components render a shadow button, so try to scroll the actual button
            // Try to find the native button inside
            const nativeBtn =
              cancelBtn.shadowRoot &&
              cancelBtn.shadowRoot.querySelector("button");
            if (nativeBtn && nativeBtn.scrollIntoView) {
              nativeBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            } else if (cancelBtn.scrollIntoView) {
              cancelBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
        }
      }, 150);
    }
  }

  disconnectedCallback() {
    // Clean up global reference
    if (typeof window !== "undefined" && window.promptInputComponent === this) {
      window.promptInputComponent = null;
    }
  }

  @api
  initialize(initData) {
    // Handle initialization from VS Code
    if (initData && initData.prompt) {
      this.showPrompt({ prompts: [initData.prompt] });
    } else if (initData && initData.prompts) {
      this.showPrompt(initData);
    }
  }

  @api
  showPrompt(promptData) {
    this.promptData = promptData;
    this.currentPrompt = (promptData.prompts && promptData.prompts[0]) || null;
    this.isVisible = true;
    this.error = null;
    this.resetValues();

    // Build mappings for select/multiselect
    if (
      this.currentPrompt &&
      (this.currentPrompt.type === "select" ||
        this.currentPrompt.type === "multiselect")
    ) {
      this.buildChoiceMappings();
    }

    if (this.currentPrompt) {
      if (
        this.currentPrompt.type === "text" ||
        this.currentPrompt.type === "number"
      ) {
        this.inputValue = this.currentPrompt.initial || "";
      } else if (this.currentPrompt.type === "select") {
        // For single select, find the first selected choice
        let selectedChoice =
          this.currentPrompt.choices &&
          this.currentPrompt.choices.find((choice) => choice.selected);
        if (!selectedChoice && this.currentPrompt.default) {
          selectedChoice =
            this.currentPrompt.choices &&
            this.currentPrompt.choices.find((choice) =>
              this.isEqual(choice.value, this.currentPrompt.default),
            );
        }
        if (selectedChoice) {
          // Use reverse mapping to get identifier
          const stringIdentifier =
            this.valueToIdentifier[JSON.stringify(selectedChoice.value)];
          this.selectedValue = stringIdentifier || "";
          this.selectedOptionDescription = this.decodeHtmlEntities(
            selectedChoice.description || "",
          );
        } else {
          this.selectedValue = "";
          this.selectedOptionDescription = "";
        }
      } else if (this.currentPrompt.type === "multiselect") {
        // Use reverse mapping to get identifiers for selected values
        this.selectedValues =
          (this.currentPrompt.choices || [])
            .filter((choice) => choice.selected)
            .map(
              (choice) => this.valueToIdentifier[JSON.stringify(choice.value)],
            ) || [];
      }
    }
  }

  // Build mapping from string identifier <-> original value for current choices
  buildChoiceMappings() {
    this.choiceValueMapping = {};
    this.valueToIdentifier = {};
    if (!this.currentPrompt || !this.currentPrompt.choices) return;
    this.currentPrompt.choices.forEach((choice, index) => {
      let stringIdentifier;
      if (typeof choice.value === "string") {
        stringIdentifier = choice.value;
      } else {
        stringIdentifier = `choice${index + 1}`;
      }
      // Ensure uniqueness
      let uniqueIdentifier = stringIdentifier;
      let counter = 1;
      while (this.choiceValueMapping.hasOwnProperty(uniqueIdentifier)) {
        uniqueIdentifier = `${stringIdentifier}_${counter}`;
        counter++;
      }
      this.choiceValueMapping[uniqueIdentifier] = choice.value;
      this.valueToIdentifier[JSON.stringify(choice.value)] = uniqueIdentifier;
    });
  }

  @api
  hidePrompt() {
    this.isVisible = false;
    this.isSubmitting = false;
    this.currentPrompt = null;
    this.promptData = null;
    this.resetValues();
  }

  // Helper for deep equality (handles primitives and objects)
  isEqual(a, b) {
    if (a === b) return true;
    if (typeof a === "object" && typeof b === "object" && a && b) {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  resetValues() {
    this.inputValue = "";
    this.selectedValues = [];
    this.selectedValue = "";
    this.selectedOptionDescription = "";
    this.error = null;
    this.isSubmitting = false;
    this.choiceValueMapping = {};
    this._hasInitialFocus = false; // Reset focus flag
  }

  get isTextInput() {
    return this.currentPrompt && this.currentPrompt.type === "text";
  }

  get isNumberInput() {
    return this.currentPrompt && this.currentPrompt.type === "number";
  }

  get isSelectInput() {
    return this.currentPrompt && this.currentPrompt.type === "select";
  }

  get isSelectWithButtons() {
    return (
      this.isSelectInput &&
      this.currentPrompt.choices &&
      this.currentPrompt.choices.length <= 5
    );
  }

  get isSelectWithCombobox() {
    return (
      this.isSelectInput &&
      this.currentPrompt.choices &&
      this.currentPrompt.choices.length > 5
    );
  }

  get isMultiselectInput() {
    return this.currentPrompt && this.currentPrompt.type === "multiselect";
  }

  get promptMessage() {
    const message = (this.currentPrompt && this.currentPrompt.message) || "";
    return this.decodeHtmlEntities(message);
  }

  get promptPlaceholder() {
    const placeholder =
      (this.currentPrompt && this.currentPrompt.placeholder) || "";
    return this.decodeHtmlEntities(placeholder);
  }

  get comboboxPlaceholder() {
    const placeholder = this.promptPlaceholder;
    return placeholder || "Choose an option...";
  }

  get promptDescription() {
    const description =
      (this.currentPrompt && this.currentPrompt.description) || "";
    return this.decodeHtmlEntities(description);
  }

  // Helper method to decode HTML entities and strip ANSI codes
  decodeHtmlEntities(text) {
    if (!text || typeof text !== "string") return text;

    // Strip ANSI color codes and escape sequences
    let cleanText = this.stripAnsiCodes(text);

    // Create a temporary element to decode HTML entities
    const textarea = document.createElement("textarea");
    textarea.innerHTML = cleanText;
    return textarea.value;
  }

  // Helper method to strip ANSI color codes
  stripAnsiCodes(text) {
    if (!text || typeof text !== "string") return text;

    // Remove ANSI escape sequences
    return text
      .replace(/\x1b\[[0-9;]*m/g, "") // Standard ANSI codes like \x1b[96m
      .replace(/\[9[0-7]m/g, "") // Color codes like [96m
      .replace(/\[3[0-9]m/g, "") // Color codes like [39m
      .replace(/\[1m/g, "") // Bold
      .replace(/\[0m/g, "") // Reset
      .replace(/\[22m/g, "") // Normal intensity
      .replace(/\[2[0-9]m/g, "") // Various codes
      .replace(/\[4[0-9]m/g, "") // Background colors
      .replace(/\[[0-9]+m/g, "") // Any remaining numeric codes
      .replace(/\[[0-9;]+m/g, ""); // Multiple codes
  }

  get promptName() {
    return (this.currentPrompt && this.currentPrompt.name) || "";
  }

  get selectOptions() {
    if (!this.currentPrompt || !this.currentPrompt.choices) return [];
    return this.currentPrompt.choices.map((choice, index) => {
      const choiceTitle =
        choice.title || choice.label || choice.name || "Option " + (index + 1);
      const choiceDescription = choice.description || "";
      const stringIdentifier =
        this.valueToIdentifier[JSON.stringify(choice.value)];
      return {
        label: this.decodeHtmlEntities(choiceTitle),
        value: stringIdentifier,
        description: this.decodeHtmlEntities(choiceDescription),
      };
    });
  }

  // Helper method to get choice description by value (using string identifier)
  getChoiceDescription(stringIdentifier) {
    if (!this.currentPrompt || !this.currentPrompt.choices || !stringIdentifier)
      return "";

    // Find the original choice using the mapping
    const originalValue = this.choiceValueMapping[stringIdentifier];
    if (originalValue === undefined) {
      return "";
    }

    const choice = this.currentPrompt.choices.find((choice) => {
      // Handle both object and string comparisons
      if (
        typeof originalValue === "object" &&
        typeof choice.value === "object"
      ) {
        return JSON.stringify(choice.value) === JSON.stringify(originalValue);
      }
      return choice.value === originalValue;
    });

    const description = choice
      ? this.decodeHtmlEntities(choice.description || "")
      : "";
    return description;
  }

  get multiselectOptions() {
    if (!this.currentPrompt || !this.currentPrompt.choices) return [];
    return this.currentPrompt.choices.map((choice, index) => {
      const stringIdentifier =
        this.valueToIdentifier[JSON.stringify(choice.value)];
      const isChecked = this.selectedValues.includes(stringIdentifier);
      return {
        label: this.decodeHtmlEntities(choice.title),
        value: stringIdentifier,
        originalValue: choice.value,
        description: this.decodeHtmlEntities(choice.description || ""),
        checked: isChecked,
      };
    });
  }

  get inputType() {
    if (this.isNumberInput) {
      return this.currentPrompt.isFloat ? "number" : "number";
    }
    return "text";
  }

  get numberStep() {
    return this.currentPrompt && this.currentPrompt.isFloat ? "0.01" : "1";
  }

  get allItemsSelected() {
    if (!this.currentPrompt || !this.currentPrompt.choices) return false;
    const totalChoices = this.currentPrompt.choices.length;
    const selectedCount = this.selectedValues.length;
    const result = selectedCount === totalChoices && selectedCount > 0;

    console.log("allItemsSelected getter called:", {
      totalChoices,
      selectedCount,
      result,
      selectedValues: this.selectedValues,
    });

    return result;
  }

  get noItemsSelected() {
    const result = this.selectedValues.length === 0;
    console.log("noItemsSelected getter called:", {
      selectedLength: this.selectedValues.length,
      result,
    });
    return result;
  }

  handleInputChange(event) {
    // Try to get the value from both event.target.value and event.detail.value
    const newValue = event.detail?.value ?? event.target?.value ?? "";
    this.inputValue = newValue;
    this.error = null;
  }

  handleKeyDown(event) {
    // Submit on Enter key press
    if (event.key === "Enter" || event.keyCode === 13) {
      event.preventDefault();

      // For text/number inputs, ensure we capture the current value before submitting
      if (this.isTextInput || this.isNumberInput) {
        // Get the current value from the lightning-input element
        const lightningInput = event.currentTarget;
        if (lightningInput && lightningInput.value !== undefined) {
          this.inputValue = lightningInput.value;
        }
      }

      // For button select, if no button is selected yet, do nothing
      if (this.isSelectWithButtons && !this.selectedValue) {
        return;
      }

      this.handleSubmit();
    }
    // Cancel on Escape key press
    else if (event.key === "Escape" || event.keyCode === 27) {
      event.preventDefault();
      this.handleCancel();
    }
    // For button select, handle arrow key navigation
    else if (
      this.isSelectWithButtons &&
      (event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight")
    ) {
      this.handleButtonNavigation(event);
    }
  }

  handleButtonNavigation(event) {
    event.preventDefault();
    const buttons = this.template.querySelectorAll(".select-option-button");
    const currentButton = event.currentTarget.closest(".select-option-button");
    const currentIndex = Array.from(buttons).indexOf(currentButton);

    let nextIndex = currentIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
    }

    if (buttons[nextIndex]) {
      buttons[nextIndex].focus();
    }
  }

  handleSelectChange(event) {
    // Try to get the value from both event.target.value and event.detail.value
    let newValue = event.detail?.value ?? event.target?.value ?? "";

    // Ensure the value is always a string
    newValue = typeof newValue === "string" ? newValue : String(newValue || "");

    this.selectedValue = newValue;
    this.error = null;

    // Set the description for the selected option using the helper method
    this.selectedOptionDescription = this.getChoiceDescription(
      this.selectedValue,
    );
  }

  handleComboboxClick(event) {
    // Auto-scroll the combobox into view if it's near the bottom of the viewport
    try {
      const combobox = event.currentTarget;
      if (combobox && combobox.getBoundingClientRect) {
        const rect = combobox.getBoundingClientRect();
        const viewportHeight =
          window.innerHeight || document.documentElement.clientHeight;
        // If the bottom of the combobox is below the viewport, scroll it into view
        if (rect.bottom > viewportHeight - 40) {
          combobox.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    } catch (e) {
      // Fail silently
    }
  }

  handleButtonSelect(event) {
    // Use currentTarget to get the button element, not the clicked child element
    const button = event.currentTarget;
    const stringIdentifier = button.dataset.value;

    this.selectedValue = stringIdentifier;
    this.error = null;

    // Set the description for the selected option using the helper method
    this.selectedOptionDescription =
      this.getChoiceDescription(stringIdentifier);

    // Auto-submit when button is clicked
    setTimeout(() => {
      this.handleSubmit();
    }, 100);
  }

  handleMultiselectChange(event) {
    const value = event.target.value;
    const isChecked = event.target.checked;

    if (isChecked) {
      this.selectedValues = [...this.selectedValues, value];
    } else {
      this.selectedValues = this.selectedValues.filter((v) => v !== value);
    }
    this.error = null;
  }

  handleSelectAll() {
    if (!this.currentPrompt || !this.currentPrompt.choices) return;
    // Select all string identifiers from mapping
    const allIdentifiers = this.currentPrompt.choices.map(
      (choice) => this.valueToIdentifier[JSON.stringify(choice.value)],
    );
    this.selectedValues = allIdentifiers;
    this.error = null;
  }

  handleUnselectAll() {
    // Clear all selections with debugging
    console.log("handleUnselectAll called, before:", this.selectedValues);
    this.selectedValues = [];
    this.error = null;
    console.log("handleUnselectAll called, after:", this.selectedValues);

    // Force reactivity by creating a new array reference
    this.selectedValues = [...this.selectedValues];
  }

  handleSubmit() {
    // Prevent multiple submissions
    if (this.isSubmitting) {
      return;
    }

    try {
      // Show spinner immediately
      this.isSubmitting = true;

      // Ensure we have the latest input value before submitting
      this.updateInputValueFromDOM();

      const response = this.buildResponse();
      this.dispatchPromptResponse(response);
    } catch (error) {
      this.error = error.message;
      this.isSubmitting = false; // Hide spinner on error
    }
  }

  // Helper method to get the current value from the DOM input elements
  updateInputValueFromDOM() {
    if (this.isTextInput || this.isNumberInput) {
      const lightningInput = this.template.querySelector("lightning-input");
      if (lightningInput && lightningInput.value !== undefined) {
        this.inputValue = lightningInput.value;
      }
    }
    // For combobox, we rely on handleSelectChange to set the value correctly
  }

  handleCancel() {
    // Prevent cancel during submission
    if (this.isSubmitting) {
      return;
    }

    const response = {};
    if (this.isMultiselectInput) {
      response[this.promptName] = [];
    } else {
      response[this.promptName] = "exitNow";
    }
    this.dispatchPromptResponse(response);
  }

  buildResponse() {
    const response = {};
    const promptName = this.promptName;
    if (this.isTextInput) {
      response[promptName] = this.inputValue;
    } else if (this.isNumberInput) {
      const value = this.inputValue;
      if (value === "" || value === null) {
        response[promptName] = null;
      } else {
        const numValue = this.currentPrompt.isFloat
          ? parseFloat(value)
          : parseInt(value, 10);
        if (isNaN(numValue)) {
          throw new Error("Please enter a valid number");
        }
        response[promptName] = numValue;
      }
    } else if (this.isSelectInput) {
      if (!this.selectedValue || this.selectedValue === "") {
        response[promptName] = "exitNow";
      } else {
        const originalValue = this.choiceValueMapping[this.selectedValue];
        response[promptName] = this.makeSafeValue(originalValue);
      }
    } else if (this.isMultiselectInput) {
      // Return array of original values, stringified if not string
      response[promptName] = this.selectedValues.map((identifier) => {
        const originalValue = this.choiceValueMapping[identifier];
        return this.makeSafeValue(originalValue);
      });
    }
    return response;
  }

  makeSafeValue(value) {
    // if the value is an object, convert it to a string
    if (typeof value === "object" && value !== null) {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }

  dispatchPromptResponse(response) {
    // Send message to VS Code via the global API
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: "submit",
        data: response,
      });
    }

    // Also dispatch custom event to parent component for local handling
    const responseEvent = new CustomEvent("promptresponse", {
      detail: {
        event: "promptsResponse",
        promptsResponse: [response],
      },
      bubbles: true,
      composed: true,
    });

    this.dispatchEvent(responseEvent);

    // Don't hide the prompt immediately - let the parent handle hiding
    // after the response is processed. The spinner will show until then.
    // this.hidePrompt();
  }

  handlePromptRequest(event) {
    const promptData = event.detail;
    this.showPrompt(promptData);
  }
}
