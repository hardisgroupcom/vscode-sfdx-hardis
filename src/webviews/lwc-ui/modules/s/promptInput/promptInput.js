/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

export default class PromptInput extends SharedMixin(LightningElement) {
  // Track the index of the currently focused button for select-with-buttons
  focusedButtonIndex = 0;
  @api promptData = null;
  @api embedded = false;
  @track currentPrompt = null;
  @track inputValue = "";
  @track selectedValues = [];
  @track selectedValue = ""; // Single value for select input (string identifier)
  @track selectedOptionDescription = ""; // Description for selected option
  @track comboboxFilter = ""; // filter text for combobox when many options
  @track multiselectFilter = "";
  @track multiselectShowOnlySelected = false;
  @track isVisible = false;
  @track isSubmitting = false; // Track if submission is in progress
  @track error = null;
  // Centralized mapping: string identifier -> original value
  @track choiceValueMapping = {};
  // Reverse mapping: JSON-stringified original value -> string identifier
  @track valueToIdentifier = {};
  _hasInitialFocus = false; // Track if initial focus has been set
  _hasInitialScroll = false;

  // Handler for filter input
  handleMultiselectFilterChange(event) {
    this.multiselectFilter = event.target.value || "";
  }

  // Handler for the list select filter input
  handleComboboxFilterChange(event) {
    this.comboboxFilter = event.detail?.value ?? event.target?.value ?? "";
  }

  // Toggle "show only selected" filter (multiselect)
  handleToggleShowOnlySelected() {
    this.multiselectShowOnlySelected = !this.multiselectShowOnlySelected;
  }

  // Returns filtered options for multiselect
  get filteredMultiselectOptions() {
    let options = this.multiselectOptions;
    if (this.multiselectShowOnlySelected) {
      options = options.filter((opt) => opt.checked);
    }
    if (this.multiselectFilter && this.multiselectFilter.trim().length > 0) {
      const filter = this.multiselectFilter.trim().toLowerCase();
      options = options.filter(
        (opt) =>
          (opt.label && opt.label.toLowerCase().includes(filter)) ||
          (opt.description && opt.description.toLowerCase().includes(filter)),
      );
    }
    return options;
  }

  connectedCallback() {
    super.connectedCallback();
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
    this.setInitialScroll();
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
        if (!selectedChoice && this.currentPrompt.initial) {
          selectedChoice =
            this.currentPrompt.choices &&
            this.currentPrompt.choices.find((choice) =>
              this.isEqual(choice.value, this.currentPrompt.initial),
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
        if (
          this.selectedValues.length === 0 &&
          this.currentPrompt?.default?.length > 0
        ) {
          // If no initial selections, try to find from default values
          this.selectedValues = this.currentPrompt.default
            .map((defaultValue) => {
              return this.valueToIdentifier[JSON.stringify(defaultValue)];
            })
            .filter((value) => value !== undefined && value !== null);
        }
        if (
          this.selectedValues.length === 0 &&
          this.currentPrompt?.initial?.length > 0
        ) {
          // If no initial selections, try to find from initial values
          this.selectedValues = this.currentPrompt.initial
            .map((initValue) => {
              return this.valueToIdentifier[JSON.stringify(initValue)];
            })
            .filter((value) => value !== undefined && value !== null);
        }
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

  setInitialScroll() {
    if (this.isVisible && this.currentPrompt && !this._hasInitialScroll) {
      setTimeout(() => {
        if (this._hasInitialScroll) {
          this.setInitialFocus();
          return;
        }
        if (this.isMultiselectInput || !this.embedded) {
          // For multiselect, we don't scroll to the cancel button
          this._hasInitialScroll = true;
          this.setInitialFocus();
          return;
        }
        // Find the cancel button by its label attribute
        let cancelBtn = this.template.querySelector(
          'lightning-button[data-id="cancelBtn"]',
        );
        if (cancelBtn && cancelBtn.focus) {
          // LWC base components render a shadow button, so try to scroll the actual button
          // Try to find the native button inside
          const nativeBtn =
            cancelBtn.shadowRoot &&
            cancelBtn.shadowRoot.querySelector("button");
          if (nativeBtn && nativeBtn.scrollIntoView) {
            if (!this._hasInitialScroll) {
              nativeBtn.scrollIntoView({ behavior: "smooth", block: "center" });
              this._hasInitialScroll = true;
              this.setInitialFocus();
            }
          } else if (cancelBtn.scrollIntoView) {
            if (!this._hasInitialScroll) {
              cancelBtn.scrollIntoView({ behavior: "smooth", block: "center" });
              this.setInitialFocus();
              this._hasInitialScroll = true;
            }
          }
        }
      }, 200);
    }
  }

  setInitialFocus() {
    if (this.isVisible && this.currentPrompt && !this._hasInitialFocus) {
      setTimeout(() => {
        if (this._hasInitialFocus) {
          return;
        }
        let firstInput;
        if (this.isSelectWithButtons) {
          // Always set focus to the button matching the first selectOption
          this.focusedButtonIndex = 0;
          const firstValue =
            this.selectOptions[0] && this.selectOptions[0].value;
          const buttons = this.template.querySelectorAll(
            ".select-option-button",
          );
          // Find the button whose data-value matches the first selectOption value
          let btnToFocus = null;
          if (firstValue) {
            btnToFocus = Array.from(buttons).find(
              (btn) => btn.dataset.value === firstValue,
            );
          }
          firstInput = btnToFocus || buttons[0];
        } else {
          firstInput = this.template.querySelector(
            "lightning-input, lightning-combobox",
          );
        }
        if (firstInput && typeof firstInput.focus === "function") {
          if (!this._hasInitialFocus) {
            firstInput.focus();
          }
          this._hasInitialFocus = true;
        }
      }, 50);
    }
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
    this._hasInitialScroll = false; // Reset scroll flag
    this.multiselectFilter = "";
    this.comboboxFilter = "";
    this.multiselectShowOnlySelected = false;
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

  get isSelectWithList() {
    return (
      this.isSelectInput &&
      this.currentPrompt.choices &&
      this.currentPrompt.choices.length > 5
    );
  }

  get isMultiselectInput() {
    return this.currentPrompt && this.currentPrompt.type === "multiselect";
  }

  // Both select variants answer on click, so they show no Validate button
  get isClickToAnswerSelect() {
    return this.isSelectWithButtons || this.isSelectWithList;
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

  // Visible choices count chip for the list select
  get listCountLabel() {
    const count = (this.filteredComboboxOptions || []).length;
    const choiceWord =
      count === 1 ? this.i18n.choiceSingular : this.i18n.choicesPlural;
    return `${count} ${choiceWord}`;
  }

  // Filtered list options based on the filter text
  get filteredComboboxOptions() {
    const options = this.selectOptions || [];
    if (!this.comboboxFilter || this.comboboxFilter.trim().length === 0) {
      return options;
    }
    const filter = this.comboboxFilter.trim().toLowerCase();
    return options.filter(
      (opt) =>
        (opt.label && opt.label.toLowerCase().includes(filter)) ||
        (opt.description && opt.description.toLowerCase().includes(filter)),
    );
  }

  // Filtered list options decorated for the template (emoji slot, selection state)
  get filteredListOptions() {
    return this.filteredComboboxOptions.map((opt) => {
      const { emoji, labelClean } = this.extractLeadingEmoji(opt.label);
      const selected = opt.value === this.selectedValue;
      return {
        ...opt,
        emoji,
        labelClean,
        selected,
        rowClass: "hardis-option-row" + (selected ? " selected" : ""),
      };
    });
  }

  // Radio-card options decorated for the template (emoji slot)
  get selectOptionsDecorated() {
    return this.selectOptions.map((opt) => {
      const { emoji, labelClean } = this.extractLeadingEmoji(opt.label);
      return { ...opt, emoji, labelClean };
    });
  }

  // The CLI bakes emoji into some choice labels (✅ ❌ ☢️ ...): pull a leading
  // emoji into a dedicated, consistently-sized slot instead of leaving it
  // to distort the label typography.
  extractLeadingEmoji(label) {
    if (!label || typeof label !== "string") {
      return { emoji: null, labelClean: label || "" };
    }
    const match = label.match(
      /^((?:\p{Extended_Pictographic}|[☀-➿⬀-⯿])[️‍\p{Extended_Pictographic}]*)\s+(.+)$/u,
    );
    if (match) {
      return { emoji: match[1], labelClean: match[2] };
    }
    return { emoji: null, labelClean: label };
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

    if (cleanText.includes("🦙")) {
      cleanText = cleanText.replace(/^🦙\s*/, "");
    }

    // Create a temporary element to decode HTML entities
    const textarea = document.createElement("textarea");
    textarea.innerHTML = cleanText;
    return textarea.value;
  }

  // Helper method to strip ANSI color codes
  stripAnsiCodes(text) {
    if (!text || typeof text !== "string") return text;

    // Remove ANSI escape sequences
    /* jscpd:ignore-start */
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
    /* jscpd:ignore-end */
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
        rowClass: "hardis-option-row" + (isChecked ? " selected" : ""),
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
    return selectedCount === totalChoices && selectedCount > 0;
  }

  get noItemsSelected() {
    return this.selectedValues.length === 0;
  }

  get showOnlySelectedLabel() {
    if (this.multiselectShowOnlySelected) {
      return this.i18n.showAllOptions;
    }
    return this.i18n.showOnlySelected;
  }

  // "n of m selected" chip for multiselect prompts
  get selectedCountLabel() {
    const total =
      (this.currentPrompt &&
        this.currentPrompt.choices &&
        this.currentPrompt.choices.length) ||
      0;
    return this.t("selectedCountOf", {
      selected: this.selectedValues.length,
      total: total,
    });
  }

  // Validate button carries the selection count for multiselect prompts
  get validateLabel() {
    if (this.isMultiselectInput && this.selectedValues.length > 0) {
      return this.t("validateCount", { count: this.selectedValues.length });
    }
    return this.i18n.validate;
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
      if (this.isSelectWithButtons) {
        // Use selectOptions for stable mapping
        const option = this.selectOptions[this.focusedButtonIndex];
        if (option && option.value) {
          this.selectedValue = option.value;
          this.handleSubmit();
        }
        // If no option, do nothing
        return;
      }
      if (this.isSelectWithList) {
        // Enter answers with the option the filter narrowed down to; with
        // several options still visible it does nothing (click decides)
        const filtered = this.filteredComboboxOptions;
        if (filtered.length === 1 && filtered[0].value) {
          this.selectedValue = filtered[0].value;
          this.handleSubmit();
        }
        return;
      }
      // For text/number inputs, ensure we capture the current value before submitting
      if (this.isTextInput || this.isNumberInput) {
        const lightningInput = event.currentTarget;
        if (lightningInput && lightningInput.value !== undefined) {
          this.inputValue = lightningInput.value;
        }
        this.handleSubmit();
        return;
      }
      // For other types, default submit
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
      // Only handle navigation if the event target is the button itself, not a child
      const isButton =
        event.currentTarget &&
        event.currentTarget.classList &&
        event.currentTarget.classList.contains("select-option-button");
      if (isButton) {
        this.handleButtonNavigation(event);
      }
    }
  }

  handleButtonNavigation(event) {
    event.preventDefault();
    // Use selectOptions for stable navigation
    const optionsLen = this.selectOptions.length;
    let currentIndex = this.focusedButtonIndex;
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % optionsLen;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : optionsLen - 1;
    }
    this.focusedButtonIndex = nextIndex;
    // Focus the button whose data-value matches the selectOption value
    const nextValue =
      this.selectOptions[nextIndex] && this.selectOptions[nextIndex].value;
    const buttons = this.template.querySelectorAll(".select-option-button");
    const btnToFocus = Array.from(buttons).find(
      (btn) => btn.dataset.value === nextValue,
    );
    if (btnToFocus) {
      btnToFocus.focus();
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

  handleButtonSelect(event) {
    // Use currentTarget to get the button element, not the clicked child element
    const button = event.currentTarget;
    const stringIdentifier = button.dataset.value;

    // Update focusedButtonIndex to match the selectOption index for this value
    const idx = this.selectOptions.findIndex(
      (opt) => opt.value === stringIdentifier,
    );
    if (idx >= 0) {
      this.focusedButtonIndex = idx;
    }

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

  // Row click toggles the value (multiselect list rows)
  handleMultiselectRowToggle(event) {
    const value = event.currentTarget.dataset.value;
    if (this.selectedValues.includes(value)) {
      this.selectedValues = this.selectedValues.filter((v) => v !== value);
    } else {
      this.selectedValues = [...this.selectedValues, value];
    }
    this.error = null;
  }

  // On option rows, Enter/Space must activate the row (native button click)
  // without bubbling to the card-level handler that submits the prompt.
  handleOptionRowKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
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
    this.selectedValues = [];
    this.error = null;
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
        // Pressing Enter with nothing chosen must not silently cancel the
        // command: surface a hint instead (Cancel/Esc still exits)
        throw new Error(this.i18n.selectAnOption);
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
    window.sendMessageToVSCode({
      type: "submit",
      data: response,
    });

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
