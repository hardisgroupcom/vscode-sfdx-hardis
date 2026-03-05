import i18next from "i18next";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

let initialized = false;

/**
 * Load translation JSON file for a given locale.
 * Tries the compiled `out/i18n/` directory first, then falls back to `src/i18n/`.
 */
function loadTranslations(locale: string): Record<string, string> {
  try {
    // In a bundled extension, __dirname points to the `out` directory.
    // Translation JSON files are copied there by webpack.
    const outLocaleFile = path.join(__dirname, "i18n", `${locale}.json`);
    if (fs.existsSync(outLocaleFile)) {
      return JSON.parse(fs.readFileSync(outLocaleFile, "utf-8"));
    }
    // Fallback: try src/i18n/ relative to out/
    const srcLocaleFile = path.join(
      __dirname,
      "..",
      "src",
      "i18n",
      `${locale}.json`,
    );
    if (fs.existsSync(srcLocaleFile)) {
      return JSON.parse(fs.readFileSync(srcLocaleFile, "utf-8"));
    }
  } catch {
    // Ignore errors and fall back to empty translations
  }
  return {};
}

/**
 * Detect the user's preferred locale.
 * Priority:
 *  1. VS Code setting `vsCodeSfdxHardis.lang`
 *  2. Environment variable `SFDX_HARDIS_LANG`
 *  3. VS Code display language
 *  4. Default: "en"
 */
function detectLocale(): string {
  // 1. VS Code setting
  const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
  const settingLang = config.get<string>("lang");
  if (settingLang && settingLang !== "auto") {
    return settingLang.substring(0, 2).toLowerCase();
  }

  // 2. Environment variable
  const envLang = process.env.SFDX_HARDIS_LANG;
  if (envLang) {
    return envLang.substring(0, 2).toLowerCase();
  }

  // 3. VS Code display language
  const vsCodeLang = vscode.env.language;
  if (vsCodeLang) {
    return vsCodeLang.substring(0, 2).toLowerCase();
  }

  // 4. Default
  return "en";
}

/**
 * Initialize the i18n system. Called lazily on first `t()` call.
 */
export function initI18n(): void {
  if (initialized) {
    return;
  }
  const locale = detectLocale();
  const supportedLocales = ["en", "fr", "es"];
  const lng = supportedLocales.includes(locale) ? locale : "en";

  i18next.init({
    lng,
    fallbackLng: "en",
    resources: {
      en: { translation: loadTranslations("en") },
      es: { translation: loadTranslations("es") },
      fr: { translation: loadTranslations("fr") },
    },
    interpolation: {
      escapeValue: false,
    },
    showSupportNotice: false,
  });
  initialized = true;
}

/**
 * Translate a message key with optional interpolation variables.
 * Falls back to the key itself if no translation is found.
 *
 * @param key - Translation key (camelCase)
 * @param vars - Optional interpolation variables (e.g. `{ count: 5 }`)
 * @returns Translated string, or the key if not found
 */
export function t(key: string, vars?: Record<string, unknown>): string {
  if (!initialized) {
    initI18n();
  }
  const result = i18next.t(key, vars as any);
  return result as string;
}

/**
 * Get all translations for the current locale.
 * Useful for sending translations to LWC webviews.
 */
export function getAllTranslations(): Record<string, string> {
  if (!initialized) {
    initI18n();
  }
  const lng = i18next.language;
  const bundle = i18next.getResourceBundle(lng, "translation");
  return (bundle as Record<string, string>) || {};
}

/**
 * Get the current locale.
 */
export function getCurrentLocale(): string {
  if (!initialized) {
    initI18n();
  }
  return i18next.language;
}

/**
 * Re-initialize i18n (e.g. when the user changes the language setting).
 */
export function reinitI18n(): void {
  initialized = false;
  initI18n();
}
