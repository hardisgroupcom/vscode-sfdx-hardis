/**
 * Pure color logic behind the per-org VS Code shell coloring.
 *
 * Kept free of any `vscode` import so it stays unit-testable, and so the whole
 * palette is defined in a single place.
 *
 * The hues are the exact SLDS palette pairs used by the webview design system
 * (see `resources/global-theme-variables.css`): each token is declared there as
 * `light-dark(<light>, <dark>)`, and we pick the branch matching the active VS
 * Code theme kind. The shell tint is therefore literally the same color as the
 * pills rendered inside the panels it frames.
 *
 * Per org type we keep three levels, mirroring the `.hardis-pill` recipe:
 * - `container` = SLDS `-90` : soft surface (pale in light themes, deep in dark themes)
 * - `text`      = SLDS `-30` : readable text/icon color on top of the container
 * - `accent`    = SLDS `-40` : borders, badges, active indicators
 * - `strong`    = SLDS `-40` light branch : saturated fill for the status bar in
 *   both themes, matching VS Code's own convention (Light+ ships a saturated
 *   `#007ACC` status bar with white text).
 */

export type OrgColorKind =
  "production" | "major" | "sandbox" | "scratch" | "dev";

export type OrgColorMode = "off" | "accent" | "tinted" | "full";

export type ThemeVariant = "light" | "dark";

export interface ThemePair {
  light: string;
  dark: string;
}

export interface OrgHue {
  container: ThemePair;
  text: ThemePair;
  accent: ThemePair;
  strong: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const WHITE = "#ffffff";
const NEAR_BLACK = "#181818"; // SLDS neutral-10 (light branch)

/** Palette per org type, straight from the SLDS tokens of the design system. */
export const ORG_HUES: Record<OrgColorKind, OrgHue> = {
  // red-90 / red-30 / red-40
  production: {
    container: { light: "#feded8", dark: "#300c01" },
    text: { light: "#8e030f", dark: "#fe8f7d" },
    accent: { light: "#ba0517", dark: "#fe5c4c" },
    strong: "#ba0517",
  },
  // orange-90 / orange-30 / orange-40
  major: {
    container: { light: "#fedfd0", dark: "#201600" },
    text: { light: "#5f3e02", dark: "#fe9339" },
    accent: { light: "#825101", dark: "#dd7a01" },
    strong: "#825101",
  },
  // green-90 / green-30 / green-40
  sandbox: {
    container: { light: "#cdefc4", dark: "#071b12" },
    text: { light: "#194e31", dark: "#45c65a" },
    accent: { light: "#396547", dark: "#3ba755" },
    strong: "#396547",
  },
  // cloud-blue-90 / cloud-blue-30 / cloud-blue-40
  scratch: {
    container: { light: "#cfe9fe", dark: "#001a28" },
    text: { light: "#084968", dark: "#1ab9ff" },
    accent: { light: "#05628a", dark: "#0d9dda" },
    strong: "#05628a",
  },
  // blue-90 / blue-30 / blue-40
  dev: {
    container: { light: "#d8e6fe", dark: "#001639" },
    text: { light: "#014486", dark: "#78b0fd" },
    accent: { light: "#0b5cab", dark: "#1b96ff" },
    strong: "#0b5cab",
  },
};

/**
 * Every workbench color key this extension may write.
 * Anything not in this list is never touched, and anything in this list is
 * always restored when the feature is turned off.
 */
export const MANAGED_COLOR_KEYS: string[] = [
  "statusBar.background",
  "statusBar.foreground",
  "statusBar.border",
  "statusBarItem.hoverBackground",
  "statusBarItem.remoteBackground",
  "statusBarItem.remoteForeground",
  "activityBar.activeBorder",
  "activityBarBadge.background",
  "activityBarBadge.foreground",
  "titleBar.activeBackground",
  "titleBar.activeForeground",
  "titleBar.inactiveBackground",
  "titleBar.inactiveForeground",
  "titleBar.border",
  "activityBar.background",
  "activityBar.foreground",
  "activityBar.inactiveForeground",
  "activityBar.border",
];

/**
 * Bogus color ids written by previous versions of the extension.
 * They are not valid VS Code color ids, so they show up as warnings in the
 * user settings: clean them up wherever we find them.
 */
export const LEGACY_COLOR_KEYS: string[] = [
  "statusBar.backgroundPrevious",
  "activityBar.backgroundPrevious",
];

/** Hardcoded colors used by previous versions of the extension. */
export const LEGACY_ORG_COLORS: string[] = ["#8c1004", "#a66004", "#2f53a8"];

export function parseHexColor(hex: string): Rgb | null {
  const match = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.exec((hex || "").trim());
  if (!match) {
    return null;
  }
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return {
    r: parseInt(value.substring(0, 2), 16),
    g: parseInt(value.substring(2, 4), 16),
    b: parseInt(value.substring(4, 6), 16),
  };
}

export function isValidHexColor(hex: string): boolean {
  return parseHexColor(hex) !== null;
}

function toHexColor(rgb: Rgb): string {
  const part = (value: number) => {
    return Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function mixRgb(from: Rgb, to: Rgb, ratio: number): Rgb {
  const amount = Math.max(0, Math.min(1, ratio));
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

/** Mix two hex colors. `ratio` is the amount of `to` blended into `from`. */
export function mixColors(from: string, to: string, ratio: number): string {
  const fromRgb = parseHexColor(from);
  const toRgb = parseHexColor(to);
  if (!fromRgb || !toRgb) {
    return from;
  }
  return toHexColor(mixRgb(fromRgb, toRgb, ratio));
}

function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }
    return Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/** WCAG 2.1 contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(colorA: string, colorB: string): number {
  const rgbA = parseHexColor(colorA);
  const rgbB = parseHexColor(colorB);
  if (!rgbA || !rgbB) {
    return 1;
  }
  const luminanceA = relativeLuminance(rgbA);
  const luminanceB = relativeLuminance(rgbB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick white or near-black, whichever reads better on the given background. */
export function readableForegroundFor(background: string): string {
  if (
    contrastRatio(WHITE, background) >= contrastRatio(NEAR_BLACK, background)
  ) {
    return WHITE;
  }
  return NEAR_BLACK;
}

/**
 * Push `foreground` away from `background` until the target contrast ratio is
 * reached, so a user-chosen color can never produce unreadable text.
 */
export function ensureContrast(
  foreground: string,
  background: string,
  target: number,
): string {
  if (contrastRatio(foreground, background) >= target) {
    return foreground;
  }
  const backgroundRgb = parseHexColor(background);
  if (!backgroundRgb) {
    return foreground;
  }
  const towards = relativeLuminance(backgroundRgb) > 0.35 ? NEAR_BLACK : WHITE;
  for (let step = 1; step <= 20; step++) {
    const candidate = mixColors(foreground, towards, step / 20);
    if (contrastRatio(candidate, background) >= target) {
      return candidate;
    }
  }
  return readableForegroundFor(background);
}

/**
 * Derive a complete, contrast-checked hue from a single user-chosen color, so
 * `customOrgColors` entries get the same treatment as the built-in org types.
 */
export function buildCustomHue(hex: string): OrgHue | null {
  const rgb = parseHexColor(hex);
  if (!rgb) {
    return null;
  }
  const base = toHexColor(rgb);
  const containerLight = mixColors(base, WHITE, 0.86);
  const containerDark = mixColors(base, NEAR_BLACK, 0.86);
  return {
    container: { light: containerLight, dark: containerDark },
    text: {
      light: ensureContrast(
        mixColors(base, NEAR_BLACK, 0.3),
        containerLight,
        4.5,
      ),
      dark: ensureContrast(mixColors(base, WHITE, 0.3), containerDark, 4.5),
    },
    accent: {
      light: ensureContrast(base, containerLight, 3),
      dark: ensureContrast(base, containerDark, 3),
    },
    strong: base,
  };
}

/** Resolve the hue to apply for an org type, honoring a custom color override. */
export function resolveOrgHue(
  kind: OrgColorKind | null,
  customColor: string | null,
): OrgHue | null {
  if (customColor) {
    const customHue = buildCustomHue(customColor);
    if (customHue) {
      return customHue;
    }
  }
  if (!kind) {
    return null;
  }
  return ORG_HUES[kind];
}

/**
 * Build the `workbench.colorCustomizations` payload for a hue.
 *
 * Every background is written together with its foreground and its neighbors,
 * so no theme is ever left with its own (clashing) text color on our surface.
 * `accent` keeps the footprint to the status bar stripe and a few indicators,
 * `tinted` adds the title bar, `full` also fills the activity bar.
 */
export function buildOrgColorCustomizations(
  hue: OrgHue | null,
  mode: OrgColorMode,
  variant: ThemeVariant,
): Record<string, string> {
  if (!hue || mode === "off") {
    return {};
  }
  const accent = hue.accent[variant];
  const container = hue.container[variant];
  const text = hue.text[variant];
  const strong = hue.strong;
  const strongForeground = readableForegroundFor(strong);
  const hoverTarget = strongForeground === WHITE ? WHITE : NEAR_BLACK;

  const colors: Record<string, string> = {
    "statusBar.background": strong,
    "statusBar.foreground": strongForeground,
    "statusBar.border": accent,
    "statusBarItem.hoverBackground": mixColors(strong, hoverTarget, 0.18),
    "statusBarItem.remoteBackground": mixColors(strong, NEAR_BLACK, 0.3),
    "statusBarItem.remoteForeground": strongForeground,
    "activityBar.activeBorder": accent,
    "activityBarBadge.background": accent,
    "activityBarBadge.foreground": readableForegroundFor(accent),
  };

  if (mode === "tinted" || mode === "full") {
    colors["titleBar.activeBackground"] = container;
    colors["titleBar.activeForeground"] = ensureContrast(text, container, 4.5);
    colors["titleBar.inactiveBackground"] = container;
    colors["titleBar.inactiveForeground"] = ensureContrast(
      mixColors(text, container, 0.35),
      container,
      3,
    );
    colors["titleBar.border"] = accent;
  }

  if (mode === "full") {
    colors["activityBar.background"] = container;
    colors["activityBar.foreground"] = ensureContrast(text, container, 4.5);
    colors["activityBar.inactiveForeground"] = ensureContrast(
      mixColors(text, container, 0.35),
      container,
      3,
    );
    colors["activityBar.border"] = accent;
  }

  return colors;
}

/**
 * Match a domain against `customOrgColors` keys, supporting wildcard (`*`)
 * patterns. Exact matches take priority over wildcard matches.
 */
export function matchCustomOrgColor(
  domain: string,
  customOrgColors: Record<string, string>,
): { color: string | null; hasInvalidPattern: boolean } {
  if (!domain) {
    return { color: null, hasInvalidPattern: false };
  }
  const isValidUrl = (url: string) => {
    const cleanedUrl = url.replaceAll("*", "placeholder");
    try {
      new URL(cleanedUrl);
      return true;
    } catch {
      return false;
    }
  };
  const normalize = (value: string) => value.replace(/\/+$/, "").toLowerCase();
  const normalizedDomain = normalize(domain);
  const wildcardPatterns: string[] = [];
  let hasInvalidPattern = false;
  let exactMatchColor: string | null = null;
  for (const pattern of Object.keys(customOrgColors)) {
    const normalizedPattern = normalize(pattern);
    if (!isValidUrl(normalizedPattern)) {
      hasInvalidPattern = true;
    }
    if (pattern.includes("*")) {
      wildcardPatterns.push(pattern);
    } else if (normalizedPattern === normalizedDomain) {
      exactMatchColor = customOrgColors[pattern];
    }
  }
  if (exactMatchColor) {
    return { color: exactMatchColor, hasInvalidPattern };
  }
  for (const pattern of wildcardPatterns) {
    // Build regex: split on '*', escape each part, join with '.*'
    const regex = new RegExp(
      "^" +
        normalize(pattern)
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
      "i",
    );
    if (regex.test(normalizedDomain)) {
      return { color: customOrgColors[pattern], hasInvalidPattern };
    }
  }
  return { color: null, hasInvalidPattern };
}

/**
 * Salesforce host suffixes stripped from the status bar badge: they are the
 * same on every org, and the badge already states the org type.
 * Longest first, so `.sandbox.my.salesforce.com` wins over `.my.salesforce.com`.
 */
const ORG_HOST_SUFFIXES: string[] = [
  ".sandbox.my.salesforce.com",
  ".scratch.my.salesforce.com",
  ".develop.my.salesforce.com",
  ".trailblaze.my.salesforce.com",
  ".demo.my.salesforce.com",
  ".my.salesforce.com",
  ".lightning.force.com",
  ".my.site.com",
  ".salesforce.com",
  ".force.com",
];

/**
 * Turn an org instance URL into a short host label, e.g.
 * `https://acme--dev.sandbox.my.salesforce.com` -> `acme--dev`.
 */
export function shortenOrgHost(instanceUrl: string): string {
  if (!instanceUrl) {
    return "";
  }
  let host: string;
  try {
    host = new URL(instanceUrl).host;
  } catch {
    host = instanceUrl.replace(/^https?:\/\//, "").split("/")[0];
  }
  host = host.toLowerCase().replace(/\.$/, "");
  for (const suffix of ORG_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return host.slice(0, -suffix.length);
    }
  }
  return host;
}
