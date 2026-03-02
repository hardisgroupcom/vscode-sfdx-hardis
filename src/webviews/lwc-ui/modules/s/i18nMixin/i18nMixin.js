/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Mixin for i18n (internationalization) in LWC components.
 *
 * Exposes a reactive `i18n` object that contains all translations.
 * In templates, use `{i18n.someKey}` directly — no getters needed.
 *
 * For dynamic interpolation, use `this.t(key, { varName: value })` in JS.
 *
 * Translations are automatically initialized from `window.__lwcTranslations` in
 * `connectedCallback`, which is populated by the LWC bootstrapper (index.js) from
 * the `data-init-data` attribute before mounting. This means static HTML bindings
 * like `{i18n.someKey}` are correct on the very first render with no flash.
 *
 * Components that define their own `connectedCallback` must call
 * `super.connectedCallback()` to ensure auto-initialization runs.
 *
 * Usage:
 *   import { I18nMixin } from 's/i18nMixin';
 *   export default class MyComponent extends I18nMixin(LightningElement) {
 *     connectedCallback() {
 *       super.connectedCallback(); // auto-inits translations
 *     }
 *   }
 *
 *   In template:
 *     <span>{i18n.welcomeTitle}</span>
 *     <span>{computedGreeting}</span>  <!-- for interpolated strings, use a getter -->
 */

export const I18nMixin = (BaseClass) =>
  class extends BaseClass {
    /**
     * Reactive translations object.
     * Access `{i18n.keyName}` directly in templates.
     * Falls back: if a key is missing, returns the key name itself.
     */
    i18n = new Proxy(
      {},
      {
        get(target, prop) {
          if (typeof prop === "symbol" || prop === "toJSON") {
            return target[prop];
          }
          return prop in target ? target[prop] : String(prop);
        },
      }
    );

    _locale = "en";

    /**
     * Raw translations object, useful for passing to child components.
     */
    translations = {};

    /**
     * Automatically initialize translations from the globally-preloaded window translations.
     * Components that override connectedCallback must call super.connectedCallback().
     */
    connectedCallback() {
      if (typeof window !== "undefined" && window.__lwcTranslations) {
        this.initTranslations({
          translations: window.__lwcTranslations,
          locale: window.__lwcLocale || "en",
        });
      }
      if (super.connectedCallback) {
        super.connectedCallback();
      }
    }

    /**
     * Initialize translations from data. Called automatically by connectedCallback.
     * Can also be called manually if translations need to be refreshed.
     */
    initTranslations(data) {
      if (data && data.translations) {
        // Create a new Proxy wrapping the translations to trigger reactivity
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

    /**
     * Translate a key with interpolation variables.
     * Use this in JS only (for dynamic values). For static labels, use `{i18n.key}` in templates.
     *
     * @param {string} key - Translation key (camelCase)
     * @param {Object} [vars] - Interpolation variables: { varName: value }
     * @returns {string} Translated string
     */
    t(key, vars) {
      let value = this.i18n[key];
      if (vars) {
        for (const [varName, varValue] of Object.entries(vars)) {
          value = value.replace(
            new RegExp("\\{\\{" + varName + "\\}\\}", "g"),
            String(varValue)
          );
        }
      }
      return value;
    }

    /**
     * Get the current locale.
     * @returns {string}
     */
    get locale() {
      return this._locale;
    }
  };
