// A command launched by the extension gets its git provider and ticketing tokens from the extension
// (the tokens it stores, or the VS Code GitHub session). sfdx-hardis must not look for another way
// to authenticate: with --agent it would read a missing or refused token from gh, glab or az, and
// check the token it has with one more API call. Forced, even when the variable is set elsewhere.
export const PROVIDER_CLI_AUTH_VAR = "SFDX_HARDIS_PROVIDER_CLI_AUTH";

export function disableProviderCliAuth(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  env[PROVIDER_CLI_AUTH_VAR] = "false";
  return env;
}
