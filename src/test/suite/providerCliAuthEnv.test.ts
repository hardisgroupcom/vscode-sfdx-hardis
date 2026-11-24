import * as assert from "assert";
import {
  disableProviderCliAuth,
  PROVIDER_CLI_AUTH_VAR,
} from "../../utils/providerCliAuthEnv";

suite("providerCliAuthEnv Test Suite", () => {
  test("turns off the provider CLI tokens of sfdx-hardis and keeps the rest of the environment", () => {
    const env = disableProviderCliAuth({ PATH: "x" });
    assert.strictEqual(env[PROVIDER_CLI_AUTH_VAR], "false");
    assert.strictEqual(env.PATH, "x");
  });

  test("wins over a value set in the environment of VS Code", () => {
    const env = disableProviderCliAuth({ [PROVIDER_CLI_AUTH_VAR]: "true" });
    assert.strictEqual(env[PROVIDER_CLI_AUTH_VAR], "false");
  });
});
