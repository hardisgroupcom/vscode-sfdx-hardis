/*
 * Copyright (c) 2025, Salesforce, Inc.,
 * All rights reserved.
 * For full license text, see the LICENSE.txt file
 */
import { api, LightningElement } from "lwc";

import { classSet } from "lightning/utils";
import { normalizeString as normalize, isCSR } from "lightning/utilsPrivate";

const DEFAULT_SIZE = "medium";
const DEFAULT_VARIANT = "base";

/**
 * Displays an animated spinner.
 */
export default class LightningSpinner extends LightningElement {
  static validationOptOut = ["class"];

  /**
   * The alternative text used to describe the reason for the wait and need for a spinner.
   * @type {string}
   */
  @api alternativeText;

  _originalSize = DEFAULT_SIZE;
  _privateSize = DEFAULT_SIZE;

  /**
   * The size of the spinner. Accepted sizes are xx-small, x-small, small, medium, and large. This value defaults to medium.
   * @type {string}
   * @default medium
   */
  @api
  get size() {
    return this._originalSize;
  }
  set size(val) {
    this._originalSize = val;
    this._privateSize = this.normalizeSize(val);
    this.setAttribute("size", this._privateSize);
  }

  _originalVariant;
  _privateVariant = DEFAULT_VARIANT;

  /**
   * The variant changes the appearance of the spinner.
   * Accepted variants include base, brand, and inverse. The default is base.
   * @type {string}
   * @default base
   */
  @api
  get variant() {
    return this._originalVariant;
  }
  set variant(val) {
    this._originalVariant = val;
    this._privateVariant = this.normalizeVariant(val);

    if (this._privateVariant !== DEFAULT_VARIANT) {
      this.setAttribute("variant", this._privateVariant);
    }
  }

  _altText = null;

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("slds-spinner_container");
    if (isCSR) {
      this.template.addEventListener("mousewheel", this.stopScrolling);
      this.template.addEventListener("touchmove", this.stopScrolling);
    }
  }

  renderedCallback() {
    // [W-10320761] We set the _altText in the next tick because screen readers are not reading out
    // the text when the text along the aria-live container is inserted into the DOM together.
    // It is only working when only aria-live container is setup on load and later the content changes
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      this._altText = this.alternativeText;
    }, 0);
  }

  normalizeVariant(variant) {
    return normalize(variant, {
      fallbackValue: DEFAULT_VARIANT,
      validValues: ["base", "brand", "inverse"],
    });
  }

  normalizeSize(size) {
    return normalize(size, {
      fallbackValue: DEFAULT_SIZE,
      validValues: ["xx-small", "x-small", "small", "medium", "large"],
    });
  }

  get computedClass() {
    const classes = classSet("slds-spinner");

    // add variant-specific class
    if (this._privateVariant !== DEFAULT_VARIANT) {
      classes.add(`slds-spinner_${this._privateVariant}`);
    }
    // add size-specific class
    classes.add(`slds-spinner_${this._privateSize}`);

    return classes.toString();
  }

  // alternativeText validation
  get validAlternativeText() {
    const hasAlternativeText = !!this.alternativeText;

    // if we have an empty value output a console warning
    if (!hasAlternativeText) {
      // eslint-disable-next-line no-console
      console.warn(
        `<lightning-spinner> The alternativeText attribute should not be empty. Please add a description of what is causing the wait.`,
      );
    }

    return hasAlternativeText;
  }

  // prevent scrolling
  stopScrolling(event) {
    event.preventDefault();
  }
}
