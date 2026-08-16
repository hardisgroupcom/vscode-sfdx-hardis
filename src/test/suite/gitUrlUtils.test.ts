import * as assert from "assert";
import { gitRemoteToHttps } from "../../utils/gitUrlUtils";

suite("gitUrlUtils Test Suite", () => {
  test("converts an scp-like ssh remote to https", () => {
    assert.strictEqual(
      gitRemoteToHttps("git@github.com:hardisgroupcom/vscode-sfdx-hardis.git"),
      "https://github.com/hardisgroupcom/vscode-sfdx-hardis",
    );
  });

  test("converts an ssh:// remote to https", () => {
    assert.strictEqual(
      gitRemoteToHttps("ssh://git@github.com/hardisgroupcom/vscode-sfdx-hardis.git"),
      "https://github.com/hardisgroupcom/vscode-sfdx-hardis",
    );
  });

  test("converts an ssh:// remote with a port to https", () => {
    assert.strictEqual(
      gitRemoteToHttps("ssh://git@gitlab.example.com:2222/group/project.git"),
      "https://gitlab.example.com:2222/group/project",
    );
  });

  test("strips embedded credentials from an https remote", () => {
    assert.strictEqual(
      gitRemoteToHttps("https://user:token@gitlab.com/group/project.git"),
      "https://gitlab.com/group/project",
    );
  });

  test("leaves an already-clean https remote unchanged aside from the .git suffix", () => {
    assert.strictEqual(
      gitRemoteToHttps("https://github.com/hardisgroupcom/vscode-sfdx-hardis"),
      "https://github.com/hardisgroupcom/vscode-sfdx-hardis",
    );
  });

  test("returns an empty string for unparseable input", () => {
    assert.strictEqual(gitRemoteToHttps("not a url at all"), "");
  });

  test("returns an empty string for empty input", () => {
    assert.strictEqual(gitRemoteToHttps(""), "");
  });

  test("returns an empty string for a Windows drive-letter local path remote", () => {
    assert.strictEqual(gitRemoteToHttps("C:\\repos\\project.git"), "");
  });

  test("returns an empty string for a POSIX absolute local path remote", () => {
    assert.strictEqual(gitRemoteToHttps("/srv/git/project.git"), "");
  });

  test("returns an empty string for a UNC local path remote", () => {
    assert.strictEqual(
      gitRemoteToHttps("\\\\server\\share\\repo.git"),
      "",
    );
  });
});
