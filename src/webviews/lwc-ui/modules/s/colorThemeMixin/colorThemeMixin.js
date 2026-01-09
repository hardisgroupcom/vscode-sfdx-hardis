/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Mixin for managing color theme in LWC components
 * Provides colorTheme and colorContrast tracking and update handling
 * Usage:
 *   import { ColorThemeMixin } from 's/colorThemeMixin';
 *   export default class MyComponent extends ColorThemeMixin(LightningElement) {
 *    ...
 *    @api
 *    handleColorThemeMessage(type, data) {
 *      // Delegate to the mixin's implementation
 *      if (super.handleColorThemeMessage)
 *        super.handleColorThemeMessage(type, data);
 *    }
 */

export const ColorThemeMixin = (BaseClass) =>
	class extends BaseClass {
		_colorTheme;
        _colorContrast;
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