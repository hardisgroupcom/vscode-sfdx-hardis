import { LightningElement, api } from "lwc";
import { I18nMixin } from "s/i18nMixin";

export default class ApexTestsSelect extends I18nMixin(LightningElement) {
  @api availableClasses = [];
  @api value = [];

  @api
  set translations(_val) {
    // translations are auto-initialized from window.__lwcTranslations via I18nMixin.connectedCallback
  }
  get translations() {
    return undefined;
  }

  get normalizedValue() {
    return Array.isArray(this.value) ? this.value.filter(Boolean) : [];
  }

  get options() {
    const available = Array.isArray(this.availableClasses)
      ? this.availableClasses
      : [];
    const selected = this.normalizedValue;

    const merged = [];
    const seen = new Set();

    for (const item of [...available, ...selected]) {
      const v = String(item || "").trim();
      if (!v) {
        continue;
      }
      const key = v.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(v);
    }

    merged.sort((a, b) => a.localeCompare(b));

    return merged.map((v) => ({
      label: v,
      value: v,
    }));
  }

  handleChange(event) {
    const value = event?.detail?.value;
    const normalized = Array.isArray(value)
      ? value.map((v) => String(v || "").trim()).filter(Boolean)
      : [];

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          value: normalized,
        },
      }),
    );
  }
}
