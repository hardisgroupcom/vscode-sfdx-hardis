import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  buildDevOrgListCommand,
  buildDevOrgRegisterCommand,
  buildDevOrgRemoveCommand,
  devOrgNodeName,
  devOrgEditBranches,
  devOrgTargetBranches,
  DevOrgView,
  isDevOrgsChangeCommand,
  isDevOrgsRegistryEnabled,
  isSameOrgId,
  readDevOrgsOutcome,
  sanitizeDevOrgs,
} from "../../utils/pipeline/devOrgsUtils";
import { BranchStrategyMermaidBuilder } from "../../utils/pipeline/branchStrategyMermaidBuilder";
import {
  assertFeatureKeysUsedAndClean,
  assertKeysTranslated,
  readModuleFile,
  REPO_ROOT,
} from "./lwcSourceUtils";

/**
 * Development orgs of the DevOps Pipeline: developer sandboxes and scratch orgs registered by
 * sfdx-hardis (sf hardis:project:dev-org:list), each drawn next to the major branch it targets
 * with the number of Pull Requests it misses.
 *
 * sfdx-hardis is the engine: these tests cover what the extension does with its answer (keep the
 * documented fields, draw the nodes) and the commands it builds for the details window.
 */

const ORG_A = "00D000000000001AAA";
const ORG_B = "00D000000000002AAA";
const ORG_C = "00D000000000003AAA";

function rawOrg(overrides: Record<string, any> = {}): any {
  return {
    orgId: ORG_A,
    orgType: "sandbox",
    name: "dev-alpha",
    alias: "dev-alpha",
    instanceUrl: "https://acme--dev-alpha.sandbox.my.salesforce.com",
    expirationDate: null,
    targetBranch: "integration",
    owner: { name: "Jane Doe", email: "jane@example.com" },
    users: [{ name: "Jane Doe", email: "jane@example.com" }],
    featureBranches: [{ name: "feature/a", lastSeen: "2026-11-01T10:00:00Z" }],
    registeredAt: "2026-10-01T10:00:00Z",
    lastActivityAt: "2026-11-01T10:00:00Z",
    lastBackpromote: null,
    isMine: true,
    stale: false,
    startDate: "2026-10-01T10:00:00Z",
    behind: {
      count: 2,
      oldestMergedAt: "2026-10-10T10:00:00Z",
      oldestDays: 28,
      computedAt: "2026-11-06T10:00:00Z",
      cutOff: false,
      pullRequests: [
        {
          number: 12,
          title: "Older",
          url: "https://github.com/acme/repo/pull/12",
          mergedAt: "2026-10-10T10:00:00Z",
          sourceBranch: "feature/older",
          vehicle: false,
          carried: null,
        },
        {
          number: 15,
          title: "Newer",
          url: "https://github.com/acme/repo/pull/15",
          mergedAt: "2026-10-20T10:00:00Z",
          sourceBranch: "promotion/integration/uat/x",
          vehicle: true,
          carried: [
            {
              number: 14,
              title: "Carried",
              url: "https://github.com/acme/repo/pull/14",
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function devOrgs(raws: any[]): DevOrgView[] {
  return sanitizeDevOrgs({ enabled: true, orgs: raws }).orgs;
}

suite("Development orgs", () => {
  suite("answer of sf hardis:project:dev-org:list", () => {
    test("the pipeline reads the list without --refresh, Refresh adds it", () => {
      assert.strictEqual(
        buildDevOrgListCommand(false),
        "sf hardis:project:dev-org:list --agent",
      );
      assert.strictEqual(
        buildDevOrgListCommand(true),
        "sf hardis:project:dev-org:list --refresh --agent",
      );
    });

    test("a successful answer is the list, with its documented fields only", () => {
      const outcome = readDevOrgsOutcome({
        status: 0,
        result: {
          status: 0,
          devOrgs: {
            enabled: true,
            dashboardUrl: "https://github.com/acme/repo/issues/3",
            currentUser: { name: "Jane", email: "jane@example.com" },
            staleDays: 30,
            orgs: [rawOrg({ secret: "nope" })],
            branches: [],
            warnings: ["one warning"],
          },
        },
      });
      assert.ok("devOrgs" in outcome);
      const view = (outcome as any).devOrgs;
      assert.strictEqual(
        view.dashboardUrl,
        "https://github.com/acme/repo/issues/3",
      );
      assert.strictEqual(view.staleDays, 30);
      assert.deepStrictEqual(view.warnings, ["one warning"]);
      assert.strictEqual(view.orgs.length, 1);
      assert.strictEqual(view.orgs[0].secret, undefined);
      assert.strictEqual(view.orgs[0].nodeName, `org${ORG_A}DevOrg`);
      assert.strictEqual("currentUser" in view, false);
    });

    test("the missing Pull Requests are listed newest first", () => {
      const [org] = devOrgs([rawOrg()]);
      assert.deepStrictEqual(
        org.behind!.pullRequests.map((pullRequest) => pullRequest.number),
        [15, 12],
      );
      assert.strictEqual(org.behind!.pullRequests[0].vehicle, true);
      assert.strictEqual(org.behind!.pullRequests[0].carried!.length, 1);
      assert.strictEqual(org.behind!.pullRequests[1].carried, null);
    });

    test("no git provider token is told apart from other failures", () => {
      const noToken = readDevOrgsOutcome({
        status: 0,
        result: {
          status: 1,
          errorKind: "noGitProvider",
          outputString: "No git provider token",
        },
      });
      assert.deepStrictEqual((noToken as any).error.kind, "noGitProvider");
      const failed = readDevOrgsOutcome({ status: 1, message: "boom" });
      assert.deepStrictEqual((failed as any).error, {
        kind: "other",
        message: "boom",
      });
    });

    test("a turned off registry answers an empty, disabled list", () => {
      const outcome = readDevOrgsOutcome({
        status: 0,
        result: { status: 0, devOrgs: { enabled: false, orgs: [] } },
      });
      assert.strictEqual((outcome as any).devOrgs.enabled, false);
      assert.strictEqual(isDevOrgsRegistryEnabled({}), true);
      assert.strictEqual(
        isDevOrgsRegistryEnabled({ enableDevOrgsRegistry: false }),
        false,
      );
    });

    test("an org without a valid org id is dropped, addresses that are not web ones are removed", () => {
      const orgs = devOrgs([
        rawOrg({ orgId: "not an id" }),
        rawOrg({
          orgId: ORG_B,
          instanceUrl: "javascript:alert(1)",
          behind: {
            count: 1,
            pullRequests: [
              { number: 3, url: "file:///etc/passwd", mergedAt: "x" },
            ],
          },
        }),
      ]);
      assert.strictEqual(orgs.length, 1);
      assert.strictEqual(orgs[0].instanceUrl, "");
      assert.strictEqual(orgs[0].behind!.pullRequests[0].url, "");
    });

    test("an org with no behind yet keeps it null", () => {
      const [org] = devOrgs([rawOrg({ behind: null })]);
      assert.strictEqual(org.behind, null);
    });
  });

  suite("view switch", () => {
    test("no setting keeps a view: the pipeline always opens on the feature branches", () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
      );
      assert.strictEqual(
        packageJson.contributes.configuration.properties[
          "vsCodeSfdxHardis.pipelineDisplayDevOrgs"
        ],
        undefined,
      );
      const js = readModuleFile("pipeline", "pipeline.js");
      assert.match(js, /@track showDevOrgsView = false;/);
      assert.doesNotMatch(js, /setDevOrgsDisplay|displayDevOrgs/);
    });

    test("the header always shows the Feature branches / Dev orgs switch, never the old toggle", () => {
      const html = readModuleFile("pipeline", "pipeline.html");
      assert.match(
        html,
        /<template if:true=\{showViewSwitch\}>[\s\S]*handleShowFeatureBranchesView[\s\S]*handleShowDevOrgsView/,
      );
      assert.doesNotMatch(
        html,
        /handleToggleFeatureBranches|showFeatureBranches/,
      );
      const js = readModuleFile("pipeline", "pipeline.js");
      assert.match(js, /return !!this\.pipelineData\?\.mermaidDiagramDevOrgs;/);
      assert.doesNotMatch(
        js,
        /displayFeatureBranches|pipelineDisplayFeatureBranches/,
      );
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
      );
      assert.strictEqual(
        packageJson.contributes.configuration.properties[
          "vsCodeSfdxHardis.pipelineDisplayFeatureBranches"
        ],
        undefined,
      );
    });

    test("a click on a + node registers an org on its branch, before the other routes", () => {
      const js = readModuleFile("pipeline", "pipeline.js");
      const addRoute = js.indexOf('nodeIdentifier.endsWith("DevOrgAdd")');
      const devOrgRoute = js.indexOf('nodeIdentifier.endsWith("DevOrg")');
      assert.ok(addRoute > 0, "DevOrgAdd route");
      assert.ok(addRoute < devOrgRoute, "DevOrgAdd route first");
      assert.match(
        js,
        /command: `sf hardis:project:dev-org:register --target-branch \$\{slot\.branch\}`/,
      );
    });
  });

  suite("target branches", () => {
    test("developmentBranch then availableTargetBranches, each once, description cut", () => {
      assert.deepStrictEqual(
        devOrgTargetBranches({
          developmentBranch: "integration",
          availableTargetBranches: [
            "integration",
            "preprod,Hotfixes on production",
            "bad branch",
          ],
        }),
        ["integration", "preprod"],
      );
      assert.deepStrictEqual(devOrgTargetBranches({}), []);
    });

    test("the Edit form offers the target branches and the current one, never production otherwise", () => {
      const majors = ["integration", "uat", "preprod", "main"];
      assert.deepStrictEqual(
        devOrgEditBranches(["integration", "preprod"], majors, "uat"),
        ["integration", "preprod", "uat"],
      );
      assert.deepStrictEqual(
        devOrgEditBranches(["integration", "preprod"], majors, "integration"),
        ["integration", "preprod"],
      );
      assert.deepStrictEqual(devOrgEditBranches([], majors, null), majors);
      assert.deepStrictEqual(
        devOrgEditBranches(["integration"], majors, "gone"),
        ["integration"],
      );
    });
  });

  suite("commands of the details window", () => {
    const branches = ["integration", "uat", "main"];

    test("Edit writes the target branch, the owner and the users", () => {
      assert.strictEqual(
        buildDevOrgRegisterCommand(
          {
            orgId: ORG_A,
            targetBranch: "uat",
            owner: "Jane Doe <jane@example.com>",
            users: "Jane Doe <jane@example.com>, john@example.com",
          },
          branches,
        ),
        `sf hardis:project:dev-org:register --org-id ${ORG_A} --target-branch uat --owner "Jane Doe <jane@example.com>" --users "Jane Doe <jane@example.com>, john@example.com" --agent`,
      );
    });

    test("an empty owner keeps the registered one, empty users clear them without an empty argument", () => {
      const command = buildDevOrgRegisterCommand(
        { orgId: ORG_A, targetBranch: "integration", owner: " ", users: "" },
        branches,
      );
      assert.ok(!command.includes("--owner"));
      assert.ok(command.includes('--users ","'));
      assert.ok(!command.includes('""'));
    });

    test("a target branch outside the pipeline, a bad org id or a shell character is refused", () => {
      assert.throws(
        () =>
          buildDevOrgRegisterCommand(
            { orgId: ORG_A, targetBranch: "other", owner: "", users: "" },
            branches,
          ),
        /invalidTargetBranch/,
      );
      assert.throws(
        () =>
          buildDevOrgRegisterCommand(
            { orgId: "00D; rm", targetBranch: "uat", owner: "", users: "" },
            branches,
          ),
        /invalidOrgId/,
      );
      for (const owner of [
        'a"b',
        "$(whoami)",
        "`id`",
        "%PATH%",
        "a\\b",
        "a && b",
      ]) {
        assert.throws(
          () =>
            buildDevOrgRegisterCommand(
              { orgId: ORG_A, targetBranch: "uat", owner, users: "" },
              branches,
            ),
          /invalidCharacters/,
          owner,
        );
      }
    });

    test("Remove names the org by its id", () => {
      assert.strictEqual(
        buildDevOrgRemoveCommand(ORG_A),
        `sf hardis:project:dev-org:remove --org-id ${ORG_A} --agent`,
      );
      assert.throws(() => buildDevOrgRemoveCommand("bad"), /invalidOrgId/);
    });

    test("the list is read again when a command that changes it ends", () => {
      assert.ok(isDevOrgsChangeCommand("hardis:project:dev-org:register"));
      assert.ok(isDevOrgsChangeCommand("hardis:project:dev-org:remove"));
      // The commands that register the org they work with
      assert.ok(isDevOrgsChangeCommand("sf hardis:work:new --agent"));
      assert.ok(isDevOrgsChangeCommand("sf hardis:work:save"));
      assert.ok(
        isDevOrgsChangeCommand("sf hardis:work:backpromote --auto --json"),
      );
      assert.ok(isDevOrgsChangeCommand("sf hardis:org:create"));
      assert.ok(!isDevOrgsChangeCommand("hardis:project:dev-org:list"));
      assert.ok(!isDevOrgsChangeCommand("sf hardis:work:refresh"));
      assert.ok(!isDevOrgsChangeCommand(undefined));
    });

    test("an org id matches its 15 and 18 characters versions", () => {
      assert.ok(isSameOrgId("00D000000000001", ORG_A));
      assert.ok(isSameOrgId(ORG_A, ORG_A));
      assert.ok(!isSameOrgId(ORG_A, ORG_B));
      assert.ok(!isSameOrgId(undefined, ORG_A));
    });
  });

  suite("nodes in the diagram", () => {
    const branches = [
      { branchName: "integration", level: 50, mergeTargets: ["uat"] },
      { branchName: "uat", level: 70, mergeTargets: ["main"] },
      { branchName: "main", level: 100, mergeTargets: [] },
    ].map((branch) => ({
      ...branch,
      instanceUrl: "",
      jobs: [],
      jobsStatus: "unknown",
    }));

    function diagram(
      orgs: DevOrgView[],
      withDevOrgs: boolean,
      onlyMajor = false,
      addBranches: string[] = [],
    ): string {
      return new BranchStrategyMermaidBuilder(
        branches,
        true,
        [],
        null,
        "light",
        3,
        undefined,
        {},
        orgs,
      ).build({
        format: "string",
        withMermaidTag: false,
        onlyMajorBranches: onlyMajor,
        devOrgs: withDevOrgs,
        devOrgAddBranches: addBranches,
      }) as string;
    }

    const orgs = devOrgs([
      rawOrg(),
      rawOrg({
        orgId: ORG_B,
        name: "dev-bravo",
        isMine: false,
        stale: true,
        targetBranch: "uat",
        owner: { name: "John", email: "john@example.com" },
      }),
      rawOrg({ orgId: ORG_C, name: "dev-charlie", behind: null }),
      rawOrg({
        orgId: "00D000000000004AAA",
        name: "elsewhere",
        targetBranch: "not-in-pipeline",
      }),
    ]);

    test("each org is a node left of the branch it targets, linked without arrowhead, the behind count on the line", () => {
      const text = diagram(orgs, true);
      const nodeA = devOrgNodeName(ORG_A);
      assert.match(
        text,
        new RegExp(`${nodeA}\\(\\[".*dev-alpha.*"\\]\\):::salesforceDev\\b`),
      );
      // Name only on the node: no owner, no count bubble (that one means Pull Requests to promote)
      assert.doesNotMatch(text, /Jane Doe/);
      assert.doesNotMatch(
        text,
        new RegExp(`${nodeA}\\(\\[[^\\n]*hardis-node-count`),
      );
      assert.match(
        text,
        new RegExp(
          `${nodeA} -\\.-\\|"<span class='hardis-pill hardis-chip hardis-status-pending hardis-chip-backpromote' data-behind='2' title='[^']+'>[^<]+</span>"\\| integrationBranch\\n`,
        ),
      );
      // No arrowhead on either side: an org never deploys to a branch
      assert.doesNotMatch(text, /<-\.->|DevOrg -\.->/);
      // An org whose missing Pull Requests are not known yet gets a line without chip
      assert.match(
        text,
        new RegExp(`${devOrgNodeName(ORG_C)} -\\.- integrationBranch\\n`),
      );
      assert.match(
        text,
        /subgraph SalesforceDevOrgsintegration \["[^"[\]]+"\]/,
      );
      assert.match(text, /subgraph SalesforceDevOrgsuat /);
      assert.match(text, /style SalesforceDevOrgsintegration /);
      assert.match(
        text,
        /linkStyle [0-9,]+ stroke:#0176d3,stroke-width:1.5px,color:#66788a/,
      );
    });

    test("a stale org and an org whose missing Pull Requests are unknown have their own class", () => {
      const text = diagram(orgs, true);
      assert.match(
        text,
        new RegExp(
          `${devOrgNodeName(ORG_B)}\\(\\[.*\\):::salesforceDevStale\\b`,
        ),
      );
      assert.match(
        text,
        new RegExp(
          `${devOrgNodeName(ORG_C)}\\(\\[.*\\):::salesforceDevUnknown\\b`,
        ),
      );
      assert.match(text, /classDef salesforceDevStale /);
      assert.match(text, /classDef salesforceDevUnknown /);
    });

    test("an org whose target branch is not drawn is left out", () => {
      assert.doesNotMatch(diagram(orgs, true), /elsewhere/);
    });

    test("the Dev orgs view draws every org, mine or not, next to the major branches", () => {
      const text = diagram(orgs, true, true);
      assert.match(text, /dev-alpha/);
      assert.match(text, /dev-bravo/);
      assert.match(text, /subgraph SalesforceDevOrgsintegration /);
    });

    test("a target branch no org targets gets a + node linked to it, the others none", () => {
      const text = diagram(devOrgs([rawOrg()]), true, true, [
        "integration",
        "uat",
        "not-in-pipeline",
      ]);
      assert.match(
        text,
        /uatDevOrgAdd\(\["<span class='hardis-dev-org-add' title='[^']+'>\+<\/span>"\]\):::salesforceDevAdd/,
      );
      assert.match(text, /uatDevOrgAdd -\.- uatBranch\n/);
      assert.doesNotMatch(text, /integrationDevOrgAdd/);
      assert.doesNotMatch(text, /not-in-pipeline/);
      assert.strictEqual((text.match(/DevOrgAdd\(/g) || []).length, 1);
      assert.match(text, /classDef salesforceDevAdd /);
    });

    test("no + node without devOrgs", () => {
      assert.doesNotMatch(
        diagram([], false, true, ["integration"]),
        /DevOrgAdd/,
      );
    });

    test("a cut off count shows a plus", () => {
      const text = diagram(
        devOrgs([
          rawOrg({ behind: { ...rawOrg().behind, count: 7, cutOff: true } }),
        ]),
        true,
      );
      assert.match(text, /data-behind='7\+'/);
    });

    test("without devOrgs, the full and the major branches diagrams are the ones without development orgs", () => {
      const without = diagram([], false);
      assert.strictEqual(diagram(orgs, false), without);
      assert.strictEqual(diagram(orgs, false, true), diagram([], false, true));
      assert.doesNotMatch(without, /DevOrg|salesforceDev|SalesforceDevOrgs/);
    });
  });

  suite("webview", () => {
    test("the details window shows the emails of the owner and the users, their name as tooltip", () => {
      const html = readModuleFile("devOrgDetails", "devOrgDetails.html");
      assert.match(html, /<span title=\{ownerName\}>\{ownerLabel\}<\/span>/);
      assert.match(html, /title=\{user\.name\}>\{user\.label\}</);
      const js = readModuleFile("devOrgDetails", "devOrgDetails.js");
      assert.match(
        js,
        /return this\.devOrg\?\.owner\?\.email \|\| this\.i18n\.devOrgNotSet;/,
      );
      assert.match(js, /label: person\.email,/);
    });

    test("the line to a development org is never animated like a pending job", () => {
      const js = readModuleFile("pipeline", "pipeline.js");
      const skip = js.indexOf(
        'label.querySelector(".hardis-chip-backpromote")',
      );
      const pending = js.indexOf(
        'label.querySelector(".hardis-status-pending")',
      );
      assert.ok(skip > 0, "backpromote chip skipped");
      assert.ok(skip < pending, "skipped before the pending check");
    });

    test("a click on a development org opens its details, before the org node route", () => {
      const js = readModuleFile("pipeline", "pipeline.js");
      const devOrgRoute = js.indexOf('nodeIdentifier.endsWith("DevOrg")');
      const orgRoute = js.indexOf('nodeIdentifier.endsWith("Org")');
      assert.ok(devOrgRoute > 0, "DevOrg route");
      assert.ok(devOrgRoute < orgRoute, "DevOrg route before the Org one");
    });

    test("the details window is a child component driven by props and events", () => {
      const html = readModuleFile("pipeline", "pipeline.html");
      assert.match(
        html,
        /<s-dev-org-details[\s\S]*onrefresh=\{handleDevOrgRefresh\}/,
      );
      const js = readModuleFile("devOrgDetails", "devOrgDetails.js");
      for (const event of [
        "close",
        "refresh",
        "backpromote",
        "save",
        "remove",
      ]) {
        assert.ok(js.includes(`new CustomEvent("${event}"`), event);
      }
    });

    test("the Backpromote panel accepts the org and the parent branch it is opened for", () => {
      const command = fs.readFileSync(
        path.join(REPO_ROOT, "src", "commands", "showBackpromote.ts"),
        "utf8",
      );
      assert.match(command, /targetOrgUsername/);
      assert.match(command, /acceptChoices\(current, requestedChoices\)/);
    });

    test("every label is translated in the 9 locales, used, and clean", () => {
      const sources = [
        readModuleFile("devOrgDetails", "devOrgDetails.js"),
        readModuleFile("devOrgDetails", "devOrgDetails.html"),
        readModuleFile("pipeline", "pipeline.js"),
        readModuleFile("pipeline", "pipeline.html"),
        fs.readFileSync(
          path.join(REPO_ROOT, "src", "commands", "showPipeline.ts"),
          "utf8",
        ),
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "src",
            "utils",
            "pipeline",
            "branchStrategyMermaidBuilder.ts",
          ),
          "utf8",
        ),
      ].join("\n");
      const used = new Set<string>();
      for (const match of sources.matchAll(
        /(?:i18n\.|t\(")((?:devOrg|legendDevOrg|menuDevOrgs|menuRegisterDevOrg)\w*)/g,
      )) {
        used.add(match[1]);
      }
      assert.ok(used.size > 40, `only ${used.size} keys found`);
      assertKeysTranslated(used);
      assertFeatureKeysUsedAndClean(
        (key) =>
          /^(devOrg|legendDevOrg|menuDevOrgsDashboard|menuRegisterDevOrg)/.test(
            key,
          ),
        used,
      );
    });
  });
});
