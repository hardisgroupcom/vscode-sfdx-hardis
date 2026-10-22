import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { WELCOME_NAVIGATION_TARGETS } from "../../commands/showWelcome";
import {
  allowedGameLink,
  GUINEA_RUN_SITE,
  guineaRunPlayUrl,
  guineaRunSiteOrigin,
} from "../../utils/guineaRunUtils";
import {
  assertKeysTranslated,
  readSourceFile,
  REPO_ROOT,
} from "./lwcSourceUtils";

/**
 * Guinea Run, the game hidden in the training site, opened from the Welcome
 * page in a panel that frames the game page of the site.
 */
suite("Guinea Run", () => {
  suite("links the game may open", () => {
    test("accepts https links to the training site and the Cloudity sites", () => {
      for (const url of [
        "https://sfdx-hardis-training.cloudity.com/en/level-1/",
        "https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/",
        "https://cloudity.com/?utm_source=sfdx-hardis-training",
        "https://www.cloudity.com/fr/services/",
      ]) {
        assert.strictEqual(allowedGameLink(url), url);
      }
    });

    test("returns the parsed address, which is what was checked", () => {
      assert.strictEqual(
        allowedGameLink("https://CLOUDITY.com/services/"),
        "https://cloudity.com/services/",
      );
      // A backslash is a slash for the parser: the host stays cloudity.com
      assert.strictEqual(
        allowedGameLink("https://cloudity.com\\evil.com/"),
        "https://cloudity.com/evil.com/",
      );
    });

    test("refuses any other host", () => {
      for (const url of [
        "https://example.com/",
        "https://evilcloudity.com/",
        "https://cloudity.com.example.com/",
        "https://training.cloudity.com/",
        "https://github.com/hardisgroupcom/sfdx-hardis",
      ]) {
        assert.strictEqual(allowedGameLink(url), null, url);
      }
    });

    test("refuses http and other protocols", () => {
      for (const url of [
        "http://sfdx-hardis-training.cloudity.com/",
        "javascript:alert(1)",
        "JavaScript:alert(document.domain)",
        "file:///C:/Windows/System32/calc.exe",
        "vscode://settings/",
        "data:text/html,<script>alert(1)</script>",
      ]) {
        assert.strictEqual(allowedGameLink(url), null, url);
      }
    });

    test("refuses credentials and explicit ports", () => {
      assert.strictEqual(allowedGameLink("https://user@cloudity.com/"), null);
      assert.strictEqual(
        allowedGameLink("https://user:secret@cloudity.com/"),
        null,
      );
      assert.strictEqual(
        allowedGameLink("https://example.com@cloudity.com/"),
        null,
      );
      assert.strictEqual(allowedGameLink("https://cloudity.com:8443/"), null);
    });

    test("refuses malformed values", () => {
      for (const value of [
        "",
        "not a url",
        "https://",
        "//cloudity.com/",
        "cloudity.com",
        undefined,
        null,
        42,
        { href: "https://cloudity.com/" },
      ]) {
        assert.strictEqual(allowedGameLink(value), null, String(value));
      }
    });
  });

  suite("where the frame points", () => {
    test("the training site, unless a loopback copy is named", () => {
      assert.strictEqual(guineaRunSiteOrigin(undefined), GUINEA_RUN_SITE);
      assert.strictEqual(guineaRunSiteOrigin(""), GUINEA_RUN_SITE);
      assert.strictEqual(
        guineaRunSiteOrigin("http://127.0.0.1:8765/some/path"),
        "http://127.0.0.1:8765",
      );
      assert.strictEqual(
        guineaRunSiteOrigin("http://localhost:8000"),
        "http://localhost:8000",
      );
    });

    test("ignores an override that is not a loopback address", () => {
      for (const value of [
        "https://example.com",
        "http://192.168.1.10:8765",
        "javascript:alert(1)",
        "file:///C:/temp/",
        "not a url",
      ]) {
        assert.strictEqual(guineaRunSiteOrigin(value), GUINEA_RUN_SITE, value);
      }
    });

    test("the game page in French or English, told it runs in VS Code", () => {
      assert.strictEqual(
        guineaRunPlayUrl(GUINEA_RUN_SITE, "fr"),
        "https://sfdx-hardis-training.cloudity.com/theme/javascripts/guinea-run/play.html?lang=fr&from=vscode",
      );
      assert.strictEqual(
        guineaRunPlayUrl(GUINEA_RUN_SITE, "en"),
        "https://sfdx-hardis-training.cloudity.com/theme/javascripts/guinea-run/play.html?lang=en&from=vscode",
      );
      // The game speaks English and French only
      for (const locale of ["de", "ja", "pt-BR", ""]) {
        assert.ok(
          guineaRunPlayUrl(GUINEA_RUN_SITE, locale).includes("?lang=en&"),
          locale,
        );
      }
    });
  });

  suite("wiring", () => {
    test("the Welcome page may open it", () => {
      assert.strictEqual(
        WELCOME_NAVIGATION_TARGETS.guineaRun,
        "vscode-sfdx-hardis.openGuineaRun",
      );
      assert.ok(
        readSourceFile("webviews/lwc-ui/modules/s/welcome/welcome.js").includes(
          'target: "guineaRun"',
        ),
      );
    });

    test("the command is declared and hidden from the command palette", () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
      );
      assert.ok(
        packageJson.contributes.commands.some(
          (command: any) =>
            command.command === "vscode-sfdx-hardis.openGuineaRun",
        ),
      );
      assert.ok(
        packageJson.contributes.menus.commandPalette.some(
          (entry: any) =>
            entry.command === "vscode-sfdx-hardis.openGuineaRun" &&
            entry.when === "false",
        ),
      );
      assert.ok(
        !JSON.stringify(packageJson.activationEvents).includes("GuineaRun"),
        "Guinea Run must not add an activation event",
      );
      assert.ok(
        readSourceFile("commands.ts").includes("registerOpenGuineaRun(this)"),
      );
    });

    test("the panel module is only imported when the command runs", () => {
      const command = readSourceFile("commands/openGuineaRun.ts");
      assert.ok(command.includes('await import("../webviews/guineaRunPanel")'));
      assert.ok(!/^import .*guineaRunPanel/m.test(command));
      for (const file of ["commands.ts", "extension.ts"]) {
        assert.ok(
          !readSourceFile(file).includes("guineaRunPanel"),
          `${file} must not import the Guinea Run panel`,
        );
      }
    });

    test("the panel keeps its strict Content Security Policy", () => {
      const panel = readSourceFile("webviews/guineaRunPanel.ts");
      for (const directive of [
        "default-src 'none'",
        "frame-src ${siteOrigin}",
        "script-src 'nonce-${nonce}'",
      ]) {
        assert.ok(panel.includes(directive), directive);
      }
      assert.ok(!panel.includes("unsafe-inline"));
      assert.ok(!panel.includes("unsafe-eval"));
      // Only the game, from its site and its frame, is heard
      assert.ok(panel.includes("event.origin !== GAME_ORIGIN"));
      assert.ok(panel.includes("event.source !== frame.contentWindow"));
      assert.ok(panel.includes('data.source !== "guinea-run"'));
    });

    test("its strings are translated in every locale", () => {
      assertKeysTranslated([
        "guineaRunEggHint",
        "guineaRunOfflineMessage",
        "guineaRunOfflineTitle",
        "tryAgainLabel",
      ]);
    });
  });
});
