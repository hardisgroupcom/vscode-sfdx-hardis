// Pure helpers (no vscode import, so they are directly unit-testable) deciding
// whether the SFDX Hardis extension itself runs its latest published version.
//
// Two registries publish it (see .github/workflows/deploy-RELEASE.yml):
// the Visual Studio Marketplace, which also receives the pre-releases built
// from the alpha branch, and Open VSX, which only receives the releases.
// Both are queried for the latest RELEASE version: a pre-release build is
// expected to be ahead of it, and is only reported when it falls behind.

import { comparePluginVersions } from "./pluginsVersionUtils";

export const EXTENSION_PUBLISHER = "NicolasVuillamy";
export const EXTENSION_NAME = "vscode-sfdx-hardis";
export const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;

export const MARKETPLACE_QUERY_URL =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
export const OPEN_VSX_QUERY_URL = `https://open-vsx.org/api/${EXTENSION_PUBLISHER}/${EXTENSION_NAME}`;

// Property carried by the versions published with `vsce publish --pre-release`
const MARKETPLACE_PRE_RELEASE_PROPERTY =
  "Microsoft.VisualStudio.Code.PreRelease";

/**
 * Body of the Marketplace gallery query returning the published versions of
 * the extension. `filterType: 7` is the "extension name" filter, and the flags
 * ask for the versions (1) and their properties (16), which is what tells a
 * pre-release version from a release one.
 */
export function buildMarketplaceQueryBody(
  extensionId: string = EXTENSION_ID,
): any {
  return {
    filters: [
      {
        criteria: [{ filterType: 7, value: extensionId }],
        pageNumber: 1,
        pageSize: 1,
      },
    ],
    flags: 1 | 16,
  };
}

function isMarketplacePreReleaseVersion(version: any): boolean {
  const properties = version?.properties;
  if (!Array.isArray(properties)) {
    return false;
  }
  return properties.some(
    (property: any) =>
      property?.key === MARKETPLACE_PRE_RELEASE_PROPERTY &&
      String(property?.value).toLowerCase() === "true",
  );
}

/**
 * Latest RELEASE version in a Marketplace gallery query response. The gallery
 * returns the versions newest first and mixes the pre-releases in, so the
 * pre-release ones are skipped. Returns null when the payload is unusable.
 */
export function parseMarketplaceLatestReleaseVersion(
  payload: any,
): string | null {
  const versions = payload?.results?.[0]?.extensions?.[0]?.versions;
  if (!Array.isArray(versions)) {
    return null;
  }
  for (const version of versions) {
    if (typeof version?.version !== "string" || version.version === "") {
      continue;
    }
    if (isMarketplacePreReleaseVersion(version)) {
      continue;
    }
    return version.version;
  }
  return null;
}

/**
 * Latest version in an Open VSX extension response. Only the releases are
 * published there, so no pre-release filtering is needed.
 */
export function parseOpenVsxLatestReleaseVersion(payload: any): string | null {
  const version = payload?.version;
  return typeof version === "string" && version !== "" ? version : null;
}

export type ExtensionUpdateState = "ok" | "outdated" | "unknown";

export interface ExtensionUpdateStatus {
  state: ExtensionUpdateState;
  installedVersion: string | null;
  latestVersion: string | null;
  // The installed build is a pre-release one, ahead of the latest release
  isPreviewAhead: boolean;
}

/**
 * Tells whether the installed extension must be updated.
 *
 * A pre-release build (published from the alpha branch) carries a version
 * ahead of the latest release, so it is fine as long as it stays ahead: it is
 * only reported once the published releases have gone past it. A release build
 * is reported as soon as a newer release exists.
 *
 * Returns "unknown" when either version is missing (offline, cold cache, or
 * the extension running from sources), in which case callers must not decorate
 * anything: guessing would nag the user about an upgrade that may not exist.
 */
export function resolveExtensionUpdateStatus(params: {
  installedVersion: string | null | undefined;
  latestVersion: string | null | undefined;
  isPreRelease: boolean;
}): ExtensionUpdateStatus {
  const { installedVersion, latestVersion, isPreRelease } = params;
  if (!installedVersion || !latestVersion) {
    return {
      state: "unknown",
      installedVersion: installedVersion || null,
      latestVersion: latestVersion || null,
      isPreviewAhead: false,
    };
  }
  const comparison = comparePluginVersions(installedVersion, latestVersion);
  return {
    state: comparison < 0 ? "outdated" : "ok",
    installedVersion,
    latestVersion,
    isPreviewAhead: isPreRelease && comparison > 0,
  };
}
