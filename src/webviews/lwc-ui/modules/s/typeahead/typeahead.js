import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

/**
 * Reusable typeahead combobox.
 *
 * Behaves like a dropdown (lightning-combobox) but lets the user type to
 * filter the available options. API-compatible with the subset of
 * lightning-combobox used across the extension: `label`, `value`, `options`,
 * `placeholder`, `required`, `disabled`, `variant` ("label-hidden") and a
 * `change` event whose detail carries the selected `value`.
 */

// Monotonic counter to build unique element ids (deterministic, no Math.random)
let TYPEAHEAD_UID = 0;

export default class Typeahead extends SharedMixin(LightningElement) {
  @api label;
  @api placeholder = "";
  @api required = false;
  @api disabled = false;
  @api variant; // "label-hidden" is supported
  @api name;

  @track _options = [];
  @track _value = null;
  @track _searchTerm = "";
  @track _open = false;
  // True once the user has typed since focusing (controls show-all vs filter)
  @track _dirty = false;
  // Index of the keyboard-highlighted option within filteredOptions
  @track _activeIndex = -1;
  @track _showValidationError = false;
  @track _validationMessage = "";

  _uid = `typeahead-${TYPEAHEAD_UID++}`;
  _blurTimer = null;
  _customValidityMessage = "";

  @api
  get options() {
    return this._options;
  }
  set options(val) {
    this._options = Array.isArray(val) ? val : [];
    // Keep the displayed text in sync with the selected value when the option
    // list arrives/changes and the user is not actively typing.
    if (!this._open) {
      this._searchTerm = this.labelForValue(this._value);
    }
  }

  @api
  get value() {
    return this._value;
  }
  set value(val) {
    this._value = val === undefined ? null : val;
    if (!this._open) {
      this._searchTerm = this.labelForValue(this._value);
    }
    this.refreshVisibleValidity();
  }

  labelForValue(val) {
    if (val === null || val === undefined || val === "") {
      return "";
    }
    const found = this._options.find((opt) => opt && opt.value === val);
    return found ? found.label : "";
  }

  // --- Template getters -----------------------------------------------------

  get inputId() {
    return `${this._uid}-input`;
  }

  get listboxId() {
    return `${this._uid}-listbox`;
  }

  get inputValue() {
    return this._searchTerm;
  }

  get requiredLabel() {
    return this.t("requiredField");
  }

  get formElementClass() {
    return this._showValidationError
      ? "slds-form-element slds-has-error"
      : "slds-form-element";
  }

  get errorMessageId() {
    return `${this._uid}-error`;
  }

  get showValidationError() {
    return this._showValidationError && !!this._validationMessage;
  }

  get validationMessage() {
    return this._validationMessage;
  }

  get ariaDescribedBy() {
    return this.showValidationError ? this.errorMessageId : null;
  }

  get ariaInvalid() {
    return this.showValidationError ? "true" : "false";
  }

  get ariaRequired() {
    return this.required ? "true" : "false";
  }

  get isLabelHidden() {
    return this.variant === "label-hidden";
  }

  get computedLabelClass() {
    return this.isLabelHidden
      ? "slds-form-element__label slds-assistive-text"
      : "slds-form-element__label";
  }

  get showDropdown() {
    return this._open && !this.disabled;
  }

  get ariaExpanded() {
    return this.showDropdown ? "true" : "false";
  }

  get comboboxClass() {
    let cls = "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click";
    if (this.showDropdown) {
      cls += " slds-is-open";
    }
    return cls;
  }

  get filteredOptions() {
    let list = this._options;
    if (this._dirty && this._searchTerm) {
      const term = this._searchTerm.toLowerCase();
      list = this._options.filter(
        (opt) => opt && opt.label && opt.label.toLowerCase().includes(term),
      );
    }
    return list.map((opt, index) => {
      const selected = opt.value === this._value;
      const active = index === this._activeIndex;
      let optionClass =
        "slds-media slds-listbox__option slds-listbox__option_plain slds-media_small";
      if (selected) {
        optionClass += " slds-is-selected";
      }
      if (active) {
        optionClass += " slds-has-focus";
      }
      return {
        label: opt.label,
        value: opt.value,
        key: String(opt.value),
        selected,
        optionClass,
        ariaSelected: selected ? "true" : "false",
      };
    });
  }

  get hasNoMatches() {
    return this.filteredOptions.length === 0;
  }

  get noMatchesLabel() {
    return this.t("noMatchingResults");
  }

  // --- Event handlers -------------------------------------------------------

  handleFocus(event) {
    if (this.disabled) {
      return;
    }
    this.cancelBlurTimer();
    this._open = true;
    this._dirty = false;
    this._activeIndex = -1;
    // Select all so the first keystroke replaces the displayed label.
    const input = event.target;
    requestAnimationFrame(() => {
      try {
        input.select();
      } catch (e) {
        // ignore - input may have been removed from the DOM
      }
    });
  }

  handleClick() {
    if (this.disabled) {
      return;
    }
    // Reopen when the input is already focused but the dropdown was closed.
    if (!this._open) {
      this._open = true;
      this._dirty = false;
      this._activeIndex = -1;
    }
  }

  handleInput(event) {
    this._searchTerm = event.target.value;
    this._dirty = true;
    this._open = true;
    this.highlightFirstFilteredOption();
  }

  handleBlur() {
    // Delay closing so a click on an option can register before we reset.
    this.cancelBlurTimer();
    this._blurTimer = setTimeout(() => {
      this.closeAndReset();
      this._blurTimer = null;
    }, 200);
  }

  handleOptionMouseDown(event) {
    // Prevent the input from losing focus (which would trigger blur/close
    // before the click is processed).
    event.preventDefault();
    const value = event.currentTarget.dataset.value;
    this.selectByDatasetValue(value);
  }

  handleKeydown(event) {
    const key = event.key;
    if (key === "ArrowDown") {
      event.preventDefault();
      if (!this._open) {
        this._open = true;
        this._dirty = false;
      }
      this.moveActive(1);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      this.moveActive(-1);
    } else if (key === "Enter") {
      const opts = this.filteredOptions;
      const chosen =
        opts[this._activeIndex] ||
        (this._dirty && this._searchTerm ? opts[0] : null);
      if (this._open && chosen) {
        event.preventDefault();
        this.commitSelection(chosen.value, chosen.label);
      }
    } else if (key === "Escape") {
      if (this._open) {
        event.preventDefault();
        this.closeAndReset();
      }
    }
  }

  // --- Helpers --------------------------------------------------------------

  moveActive(delta) {
    const count = this.filteredOptions.length;
    if (count === 0) {
      this._activeIndex = -1;
      return;
    }
    let next = this._activeIndex + delta;
    if (next < 0) {
      next = count - 1;
    } else if (next >= count) {
      next = 0;
    }
    this._activeIndex = next;
  }

  highlightFirstFilteredOption() {
    const opts = this.filteredOptions;
    this._activeIndex =
      this._dirty && this._searchTerm && opts.length > 0 ? 0 : -1;
  }

  selectByDatasetValue(datasetValue) {
    const found = this._options.find(
      (opt) => opt && String(opt.value) === String(datasetValue),
    );
    const finalValue = found ? found.value : datasetValue;
    const finalLabel = found ? found.label : "";
    this.commitSelection(finalValue, finalLabel);
  }

  commitSelection(value, label) {
    this._value = value;
    this._searchTerm = label;
    this._open = false;
    this._dirty = false;
    this._activeIndex = -1;
    this.refreshVisibleValidity();
    this.dispatchEvent(new CustomEvent("change", { detail: { value } }));
  }

  closeAndReset() {
    this._open = false;
    this._dirty = false;
    this._activeIndex = -1;
    // Restore the input text to reflect the currently selected option.
    this._searchTerm = this.labelForValue(this._value);
    this.refreshVisibleValidity();
  }

  @api
  checkValidity() {
    const message = this.getValidationMessage();
    this.applyInputValidity(message);
    const input = this.inputElement;
    return input && typeof input.checkValidity === "function"
      ? input.checkValidity()
      : !message;
  }

  @api
  reportValidity() {
    const message = this.getValidationMessage();
    this._validationMessage = message;
    this._showValidationError = !!message;
    this.applyInputValidity(message);
    const input = this.inputElement;
    return input && typeof input.reportValidity === "function"
      ? input.reportValidity()
      : !message;
  }

  @api
  setCustomValidity(message) {
    this._customValidityMessage = message || "";
    const validationMessage = this.getValidationMessage();
    this.applyInputValidity(validationMessage);
    if (this._showValidationError) {
      this._validationMessage = validationMessage;
      this._showValidationError = !!validationMessage;
    }
  }

  get inputElement() {
    return this.template.querySelector("input");
  }

  hasSelectedValue() {
    return (
      this._value !== null && this._value !== undefined && this._value !== ""
    );
  }

  getValidationMessage() {
    if (this._customValidityMessage) {
      return this._customValidityMessage;
    }
    return this.required && !this.hasSelectedValue()
      ? this.t("requiredField")
      : "";
  }

  applyInputValidity(message) {
    const input = this.inputElement;
    if (input && typeof input.setCustomValidity === "function") {
      input.setCustomValidity(message);
    }
  }

  refreshVisibleValidity() {
    if (!this._showValidationError) {
      return;
    }
    const message = this.getValidationMessage();
    this._validationMessage = message;
    this._showValidationError = !!message;
    this.applyInputValidity(message);
  }

  cancelBlurTimer() {
    if (this._blurTimer) {
      clearTimeout(this._blurTimer);
      this._blurTimer = null;
    }
  }

  disconnectedCallback() {
    this.cancelBlurTimer();
    if (super.disconnectedCallback) {
      super.disconnectedCallback();
    }
  }
}
