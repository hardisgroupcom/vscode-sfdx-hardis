/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

import { api } from "lwc";

/**
 * Consolidated mixin for LWC customization concerns.
 *
 * Features:
 * - i18n helpers (`i18n`, `translations`, `t`, `initTranslations`, `locale`)
 * - theme helpers (`colorTheme`, `colorContrast`, `handleColorThemeMessage`)
 */
export const SharedMixin = (BaseClass) =>
  class extends BaseClass {
    i18n = new Proxy(
      {},
      {
        get(target, prop) {
          if (typeof prop === "symbol" || prop === "toJSON") {
            return target[prop];
          }
          return prop in target ? target[prop] : String(prop);
        },
      },
    );

    translations = {};
    images = {};
    _locale = "en";
    _colorTheme;
    _colorContrast;

    connectedCallback() {
      if (typeof window !== "undefined" && window.__lwcTranslations) {
        this.initTranslations({
          translations: window.__lwcTranslations,
          locale: window.__lwcLocale || "en",
        });
      }
      if (typeof window !== "undefined" && window.__lwcImages) {
        this.initializeImages(window.__lwcImages);
      }
      if (super.connectedCallback) {
        super.connectedCallback();
      }
    }

    @api
    initTranslations(data) {
      if (data && data.translations) {
        const translations = data.translations;
        this.translations = translations;
        this.i18n = new Proxy(translations, {
          get(target, prop) {
            if (typeof prop === "symbol" || prop === "toJSON") {
              return target[prop];
            }
            return prop in target ? target[prop] : String(prop);
          },
        });
      }
      if (data && data.locale) {
        this._locale = data.locale;
      }
    }

    t(key, vars) {
      let value = this.i18n[key];
      if (vars) {
        for (const [varName, varValue] of Object.entries(vars)) {
          value = value.replace(
            new RegExp("\\{\\{" + varName + "\\}\\}", "g"),
            String(varValue),
          );
        }
      }
      return value;
    }

    get locale() {
      return this._locale;
    }

    @api
    initializeImages(images) {
      if (images && typeof images === "object") {
        this.images = { ...images };
      }
    }

    getImageUrl(key, fallbackKey = "") {
      if (key && this.images && this.images[key]) {
        return this.images[key];
      }
      if (fallbackKey && this.images && this.images[fallbackKey]) {
        return this.images[fallbackKey];
      }
      return "";
    }

    get colorTheme() {
      return this._colorTheme || "";
    }

    set colorTheme(value) {
      this._colorTheme = value;
    }

    get colorContrast() {
      return this._colorContrast || "";
    }

    set colorContrast(value) {
      this._colorContrast = value;
    }

    handleColorThemeMessage(type, data) {
      if (type === "updateTheme" && data?.colorTheme) {
        this._colorTheme = data.colorTheme;
        this._colorContrast = data.colorContrast;
      }
    }
  };
