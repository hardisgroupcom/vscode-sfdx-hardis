const showBanner = false;
// Pinned when the published `latest` @salesforce/cli is broken. 2.150.6 ships a
// broken `sf plugins` command, which makes the extension unable to detect the
// installed plugins: pin the version published as `latest-rc` at the time until
// `latest` catches up. The pin is a FLOOR, not an exact target (see
// resolveRecommendedSfCliVersion): as soon as npm `latest` is >= this version,
// npm `latest` wins again and this constant can be reset to null.
export const RECOMMENDED_SFDX_CLI_VERSION: string | null = "2.151.6";
export const NODE_JS_MINIMUM_VERSION = 24.0;
// Pre-release identifiers are ignored when comparing, so 8.0.0-beta.x satisfies it
export const RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION: string = "8.4.1";
export const BANNER_IMAGE_URL = showBanner
  ? "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/refs/heads/main/docs/assets/images/cloudity-banner.png"
  : false;
export const DOCSITE_URL = "https://sfdx-hardis.cloudity.com";
export const EXTENSION_REPOSITORY_URL =
  "https://github.com/hardisgroupcom/vscode-sfdx-hardis";
export const EXTENSION_CHANGELOG_URL =
  EXTENSION_REPOSITORY_URL + "/blob/main/CHANGELOG.md";
// "What's new" page presenting the current major version to end users
export const WHATS_NEW_URL = DOCSITE_URL + "/sfdx-hardis-v8/";
export const SFDX_HARDIS_REPOSITORY_URL =
  "https://github.com/hardisgroupcom/sfdx-hardis";
export const EXTENSION_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis&ssr=false#review-details";
export const EXTENSION_OPENVSX_URL =
  "https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis/reviews";
export const WEBSITE_URL = "https://www.cloudity.com?ref=sfdxhardis";
export const WEBSITE_CONTACT_URL =
  "https://cloudity.com/contact-us/?ref=sfdxhardis";
export const WEBSITE_CONTACT_FORM_URL = "https://cloudity.com/contact-us/";
