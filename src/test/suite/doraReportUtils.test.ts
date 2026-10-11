import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  DORA_DEFAULT_PERIOD,
  DORA_PERIODS,
  buildDoraExportCommand,
  buildDoraReportCommand,
  doraCacheKey,
  isCliTooOldForDoraPanel,
  normalizeDoraPeriod,
  readDoraOutcome,
  safeWebUrl,
  sanitizeDoraReport,
} from "../../utils/doraReportUtils";
import {
  LOCALES,
  REPO_ROOT,
  assertKeysTranslated,
  loadLocale,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";

/**
 * Tests of the DORA metrics panel that need no VS Code window:
 *  - the commands the panel runs, and what it makes of their answer
 *  - only web addresses reach the webview
 *  - the fixture the mocked sf CLI answers is consistent with itself
 *  - the component computes no metric, and every label it shows is translated
 *  - the DevOps Pipeline menu opens the panel
 */

const FIXTURE_FILE = path.join(
  REPO_ROOT,
  "test",
  "fixtures",
  "sf-shim",
  "dora-report.json",
);

function loadFixture(): any {
  return JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8"));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

suite("DORA metrics panel", () => {
  test("the periods of the panel are 30, 90, 180 and 365 days, 90 by default", () => {
    assert.deepStrictEqual(DORA_PERIODS, [30, 90, 180, 365]);
    assert.strictEqual(DORA_DEFAULT_PERIOD, 90);
    assert.strictEqual(normalizeDoraPeriod(180), 180);
    assert.strictEqual(normalizeDoraPeriod("365"), 365);
    assert.strictEqual(normalizeDoraPeriod(45), 90);
    assert.strictEqual(normalizeDoraPeriod("90; rm -rf"), 90);
    assert.strictEqual(normalizeDoraPeriod(undefined), 90);
  });

  test("the panel reads its data without writing a file, and compares with the period before", () => {
    assert.strictEqual(
      buildDoraReportCommand(90, { refresh: false }),
      "sf hardis:doc:dora-report --agent --data-only --compare --period 90",
    );
    assert.strictEqual(
      buildDoraReportCommand(365, { refresh: true }),
      "sf hardis:doc:dora-report --agent --data-only --compare --period 365 --refresh",
    );
    // A period the panel does not offer never reaches the command line
    assert.strictEqual(
      buildDoraReportCommand("7 && whoami" as any, { refresh: false }),
      "sf hardis:doc:dora-report --agent --data-only --compare --period 90",
    );
  });

  test("the Export menu runs the real report command", () => {
    assert.strictEqual(
      buildDoraExportCommand(30, false),
      "sf hardis:doc:dora-report --period 30",
    );
    assert.strictEqual(
      buildDoraExportCommand(180, true),
      "sf hardis:doc:dora-report --period 180 --pdf",
    );
  });

  test("the last result is kept per workspace and per period", () => {
    assert.notStrictEqual(
      doraCacheKey("/work/a", 90),
      doraCacheKey("/work/a", 30),
    );
    assert.notStrictEqual(
      doraCacheKey("/work/a", 90),
      doraCacheKey("/work/b", 90),
    );
    assert.strictEqual(
      doraCacheKey("/work/a", 90),
      doraCacheKey("/work/a", 90),
    );
  });

  test("a successful answer is the report", () => {
    const outcome = readDoraOutcome({ status: 0, result: loadFixture() }, true);
    assert.ok("report" in outcome);
    assert.strictEqual((outcome as any).report.branches.length, 4);
  });

  test("an answer without branches is the report of an older sfdx-hardis", () => {
    const outcome = readDoraOutcome(
      { status: 0, result: { outputString: "DORA report generated" } },
      true,
    );
    assert.deepStrictEqual(outcome, { error: { kind: "oldCli", message: "" } });
  });

  test("an sfdx-hardis that does not know the flags of the panel is too old", () => {
    const answer = {
      name: "NonexistentFlagsError",
      message: "Nonexistent flag: --data-only\nSee more help with --help",
      status: 2,
    };
    assert.strictEqual(isCliTooOldForDoraPanel(answer), true);
    const outcome = readDoraOutcome(answer, true) as any;
    assert.strictEqual(outcome.error.kind, "oldCli");
    assert.strictEqual(
      isCliTooOldForDoraPanel({ status: 1, message: "HTTP 403" }),
      false,
    );
  });

  test("a failure without any git provider token asks to connect", () => {
    const outcome = readDoraOutcome(
      { status: 1, message: "No authenticated git provider found" },
      false,
    ) as any;
    assert.strictEqual(outcome.error.kind, "noGitProvider");
  });

  test("any other failure shows the message of sfdx-hardis", () => {
    const outcome = readDoraOutcome(
      {
        status: 1,
        message:
          "\u001b[31mThe token cannot read the CI jobs (HTTP 403)\u001b[39m",
      },
      true,
    ) as any;
    assert.strictEqual(outcome.error.kind, "cli");
    assert.strictEqual(
      outcome.error.message,
      "The token cannot read the CI jobs (HTTP 403)",
    );
    // No answer at all is still an error the panel can show
    assert.strictEqual(
      (readDoraOutcome(undefined, true) as any).error.kind,
      "cli",
    );
  });

  test("only http and https addresses are kept", () => {
    assert.strictEqual(
      safeWebUrl("https://github.com/mycompany/salesforce-crm/pull/128"),
      "https://github.com/mycompany/salesforce-crm/pull/128",
    );
    assert.strictEqual(
      safeWebUrl(" http://gitlab.local/x "),
      "http://gitlab.local/x",
    );
    for (const refused of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "vscode://extension/install",
      "command:workbench.action.reloadWindow",
      "https://example.com/a b",
      'https://example.com/"onclick',
      "//example.com",
      "",
      null,
      42,
    ]) {
      assert.strictEqual(safeWebUrl(refused), "", String(refused));
    }
  });

  test("an address that is not a web one is removed from the report", () => {
    const report = sanitizeDoraReport({
      schemaVersion: 2,
      branches: [
        {
          name: "main",
          failedDeployments: [
            {
              runUrl: "javascript:alert(1)",
              pullRequest: { id: "1", title: "x", url: "file:///c:/x" },
            },
            {
              runUrl: "https://ci.example.com/run/1",
              pullRequest: null,
            },
          ],
          slowPullRequests: [{ id: "2", url: "command:evil" }],
          hotfixPullRequests: [{ id: "3", url: "https://example.com/pull/3" }],
          attention: [
            { code: "deploymentFailing", message: "m", url: "vscode://x" },
            { code: "noRecentDeployment", message: "m", url: null },
          ],
        },
      ],
    });
    const branch = report.branches[0];
    assert.strictEqual(branch.failedDeployments[0].runUrl, "");
    assert.strictEqual(branch.failedDeployments[0].pullRequest.url, "");
    assert.strictEqual(
      branch.failedDeployments[1].runUrl,
      "https://ci.example.com/run/1",
    );
    assert.strictEqual(branch.failedDeployments[1].pullRequest, null);
    assert.strictEqual(branch.slowPullRequests[0].url, "");
    assert.strictEqual(
      branch.hotfixPullRequests[0].url,
      "https://example.com/pull/3",
    );
    assert.strictEqual(branch.attention[0].url, null);
    assert.strictEqual(branch.attention[1].url, null);
    // Missing lists become empty ones: the component iterates on them
    assert.deepStrictEqual(report.contributors, []);
    assert.deepStrictEqual(sanitizeDoraReport({}).branches, []);
  });

  test("the fixture of the mocked sf CLI is left as it is by the sanitizer", () => {
    const fixture = loadFixture();
    assert.deepStrictEqual(sanitizeDoraReport(fixture), fixture);
  });

  test("the fixture is consistent: weekly counts add up to the counts, rates match them", () => {
    const fixture = loadFixture();
    assert.strictEqual(fixture.schemaVersion, 2);
    assert.strictEqual(fixture.pipeline, null);
    assert.deepStrictEqual(
      fixture.branches.map((branch: any) => branch.name),
      ["integration", "uat", "preprod", "main"],
    );
    const days = fixture.period.days;
    const attentionCodes = new Set<string>();
    for (const branch of fixture.branches) {
      const { counts, metrics, weeks } = branch;
      assert.strictEqual(weeks.length, 13, branch.name);
      const succeeded = sum(weeks.map((week: any) => week.succeeded));
      const failed = sum(weeks.map((week: any) => week.failed));
      assert.strictEqual(counts.succeeded, succeeded, branch.name);
      assert.strictEqual(counts.failed, failed, branch.name);
      assert.strictEqual(counts.deployments, succeeded + failed, branch.name);
      assert.strictEqual(
        counts.canceled,
        sum(weeks.map((week: any) => week.canceled)),
      );
      assert.strictEqual(
        counts.validations,
        sum(weeks.map((week: any) => week.validations)),
      );
      assert.strictEqual(
        metrics.deploymentFrequency.perWeek,
        round1((succeeded / days) * 7),
        branch.name,
      );
      assert.strictEqual(
        metrics.changeFailureRate.percent,
        round1((failed / counts.deployments) * 100),
        branch.name,
      );
      assert.strictEqual(
        metrics.reworkRate.percent,
        round1((branch.hotfixPullRequests.length / counts.deployments) * 100),
        branch.name,
      );
      assert.strictEqual(branch.failedDeployments.length, failed, branch.name);
      assert.strictEqual(
        metrics.mttr.recoveries,
        branch.failedDeployments.filter(
          (failure: any) => failure.recoveryHours !== null,
        ).length,
        branch.name,
      );
      const validationsFailed = sum(
        weeks.map((week: any) => week.validationsFailed),
      );
      assert.strictEqual(
        branch.supplementary.validationSuccessRate,
        round1(
          ((counts.validations - validationsFailed) / counts.validations) * 100,
        ),
        branch.name,
      );
      for (const item of branch.attention) {
        attentionCodes.add(item.code);
      }
    }
    assert.deepStrictEqual([...attentionCodes].sort(), [
      "deploymentFailing",
      "failureRateUp",
      "noRecentDeployment",
      "stalePullRequests",
    ]);
    assert.deepStrictEqual(
      fixture.contributors.map((contributor: any) => contributor.name),
      ["Victor", "Mariia", "Romain"],
    );
    const allFailures = fixture.branches.flatMap(
      (branch: any) => branch.failedDeployments,
    );
    for (const contributor of fixture.contributors) {
      assert.strictEqual(
        contributor.failedDeployments,
        allFailures.filter(
          (failure: any) => failure.triggeredBy === contributor.name,
        ).length,
        contributor.name,
      );
    }
    assert.strictEqual(
      sum(fixture.contributors.map((c: any) => c.deploymentsTriggered)),
      sum(fixture.branches.map((branch: any) => branch.counts.deployments)),
    );
  });

  test("the component only draws: no rating threshold, no HTML rendering", () => {
    const js = readModuleFile("doraMetrics", "doraMetrics.js");
    const html = readModuleFile("doraMetrics", "doraMetrics.html");
    // The rating comes from the level sfdx-hardis gives, never from a comparison with a threshold
    assert.ok(js.includes("LEVEL_PILLS[data.level]"));
    const code = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/benchmark|threshold/i.test(code));
    assert.ok(!html.includes("lwc:inner-html"));
    assert.ok(!html.includes("lwc:dom"));
    assert.ok(!js.includes("innerHTML"));
    // Links leave the panel through the two functions that check the address
    const sends = js.match(/type: "open(External|PullRequest)"/g) || [];
    assert.strictEqual(sends.length, 2);
    assert.ok(js.includes("const safeUrl = httpUrl(url);"));
    // No Pipeline flow tab in this version
    assert.ok(!/pipeline/i.test(html));
  });

  test("the stylesheet of the panel has no hardcoded color nor font", () => {
    const css = readModuleFile("doraMetrics", "doraMetrics.css");
    assert.ok(
      !/#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family|font-weight: *[0-9]|data-theme/.test(
        css,
      ),
    );
  });

  test("every label of the panel is translated in the 9 locales", () => {
    const js = readModuleFile("doraMetrics", "doraMetrics.js");
    const html = readModuleFile("doraMetrics", "doraMetrics.html");
    const keys = new Set<string>();
    for (const [, key] of html.matchAll(/\{i18n\.(\w+)\}/g)) {
      keys.add(key);
    }
    for (const [, key] of js.matchAll(/this\.i18n\.(\w+)/g)) {
      keys.add(key);
    }
    for (const [, key] of js.matchAll(/this\.t\(\s*"(\w+)"/g)) {
      keys.add(key);
    }
    for (const [, key] of js.matchAll(/(?:labelKey|unitKey): "(\w+)"/g)) {
      keys.add(key);
    }
    for (const [, key] of js.matchAll(/"(doraValue\w+)"/g)) {
      keys.add(key);
    }
    assert.ok(keys.size > 60, `keys found: ${keys.size}`);
    assertKeysTranslated(keys);
    assertKeysTranslated(["doraMetricsTooltip"]);
    // Every dora key of en.json is used by the panel, and holds no em-dash
    const used = new Set([...keys, "doraMetricsTooltip"]);
    for (const locale of LOCALES) {
      const translations = loadLocale(locale);
      for (const [key, value] of Object.entries(translations)) {
        if (!key.startsWith("dora")) {
          continue;
        }
        assert.ok(used.has(key), `unused i18n key ${key} in ${locale}.json`);
        assert.ok(!value.includes("\u2014"), `em-dash in ${key} (${locale})`);
        const placeholders = (text: string) =>
          (text.match(/\{\{\w+\}\}/g) || []).sort().join(",");
        assert.strictEqual(
          placeholders(value),
          placeholders(loadLocale("en")[key]),
          `placeholders of ${key} in ${locale}.json`,
        );
      }
    }
  });

  test("the DevOps Pipeline menu opens the panel instead of running the report", () => {
    const html = readModuleFile("pipeline", "pipeline.html");
    const js = readModuleFile("pipeline", "pipeline.js");
    assert.ok(html.includes("label={i18n.doraMetrics}"));
    assert.ok(html.includes("onclick={handleShowDoraMetrics}"));
    assert.ok(js.includes('command: "vscode-sfdx-hardis.showDoraMetrics"'));
    assert.ok(!js.includes('command: "sf hardis:doc:dora-report"'));
    for (const locale of LOCALES) {
      assert.strictEqual(
        loadLocale(locale).generateDoraReport,
        undefined,
        `orphan key generateDoraReport in ${locale}.json`,
      );
    }
    assert.strictEqual(loadLocale("en").doraMetrics, "DORA metrics");
  });

  test("the panel command is declared, registered and has its icon", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    assert.ok(
      packageJson.contributes.commands.some(
        (command: any) =>
          command.command === "vscode-sfdx-hardis.showDoraMetrics",
      ),
    );
    assert.ok(
      readSourceFile("commands.ts").includes("registerShowDoraMetrics(this)"),
    );
    assert.ok(
      readSourceFile("utils/themeUtils.ts").includes(
        '"vscode-sfdx-hardis.showDoraMetrics"',
      ),
    );
    assert.ok(
      readSourceFile("hardis-commands-provider.ts").includes(
        'command: "vscode-sfdx-hardis.showDoraMetrics"',
      ),
    );
    assert.ok(
      readSourceFile("webviews/lwc-ui/index.js").includes(
        '"s-dora-metrics": () => import("s/doraMetrics")',
      ),
    );
  });
});
