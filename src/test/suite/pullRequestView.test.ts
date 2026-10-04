import * as assert from "assert";
import {
  assertKeysTranslated,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";
import { parsePullRequestNumberFromUrl } from "../../utils/pullRequestUrlUtils";

/**
 * Tests of the Pull Request view of the DevOps Pipeline (sfdx-hardis#2273): the lookup of the
 * Pull Requests explorer, the journey of a Pull Request through the major branches, the modal
 * state saved when a Pull Request is opened from a branch window, and the links of the other
 * panels.
 *
 * s/pullRequestUtils holds no LWC import, so the whole module is run for real: its exports are
 * turned into plain declarations and returned by a function built from its source.
 */

const EXPORTED = [
  "MODAL_STATE_DEFAULTS",
  "captureModalState",
  "applyModalState",
  "lookupState",
  "filterLoadedPullRequests",
  "excludeKnownPullRequests",
  "typedPullRequestNumber",
  "journeyBranchPath",
  "buildPullRequestJourney",
  "journeyPillClass",
  "safeWebUrl",
];

function loadPullRequestUtils(): any {
  const source = readModuleFile(
    "pullRequestUtils",
    "pullRequestUtils.js",
  ).replace(/^export /gm, "");
  return new Function(`${source}\nreturn { ${EXPORTED.join(", ")} };`)();
}

const ORGS = [
  { name: "integration", mergeTargets: ["uat"] },
  { name: "uat", mergeTargets: ["preprod"] },
  { name: "preprod", mergeTargets: ["main"] },
  { name: "main", mergeTargets: [] },
];

function pullRequest(overrides: Record<string, any> = {}): any {
  return {
    id: overrides.number || 128,
    number: 128,
    title: "CRM-1042 Account hierarchy",
    sourceBranch: "feature/CRM-1042-account-hierarchy",
    targetBranch: "integration",
    authorLabel: "Sam Dubois",
    state: "open",
    jobsStatus: "success",
    relatedTickets: [{ id: "CRM-1042" }],
    ...overrides,
  };
}

suite("Pull Request view", () => {
  const utils = loadPullRequestUtils();

  suite("lookup", () => {
    const loaded = [
      pullRequest(),
      pullRequest({
        number: 124,
        title: "CRM-1049 Opportunity stage notifications",
        sourceBranch: "feature/CRM-1049-opportunity",
        authorLabel: "Alex Martin",
        state: "merged",
        relatedTickets: [{ id: "CRM-1049" }],
      }),
      pullRequest({
        number: 130,
        title: "Fix invoice rounding",
        sourceBranch: "fix/CRM-1101-invoice-rounding",
        state: "open",
        relatedTickets: [],
      }),
    ];

    test("matches the title, the branch, the author and the ticket", () => {
      const numbers = (query: string) =>
        utils
          .filterLoadedPullRequests(loaded, query)
          .map((pr: any) => pr.number);
      assert.deepStrictEqual(numbers("opportunity"), [124]);
      assert.deepStrictEqual(numbers("alex"), [124]);
      assert.deepStrictEqual(numbers("crm-1042"), [128]);
      assert.deepStrictEqual(numbers("INVOICE"), [130]);
    });

    test("matches a number by its first digits, with or without #", () => {
      const numbers = (query: string) =>
        utils
          .filterLoadedPullRequests(loaded, query)
          .map((pr: any) => pr.number);
      assert.deepStrictEqual(numbers("#12"), [128, 124]);
      assert.deepStrictEqual(numbers("130"), [130]);
    });

    test("lists open Pull Requests first, then the most recent numbers", () => {
      assert.deepStrictEqual(
        utils.filterLoadedPullRequests(loaded, "").map((pr: any) => pr.number),
        [130, 128, 124],
      );
    });

    test("lists a Pull Request once, and never one a promotion carried away", () => {
      const result = utils.filterLoadedPullRequests(
        [
          ...loaded,
          pullRequest(),
          pullRequest({ number: 90, promotedAway: true }),
        ],
        "",
      );
      assert.deepStrictEqual(
        result.map((pr: any) => pr.number),
        [130, 128, 124],
      );
    });

    test("keeps from the provider only what is not listed already", () => {
      const remote = [pullRequest(), pullRequest({ number: 97 })];
      assert.deepStrictEqual(
        utils
          .excludeKnownPullRequests(remote, loaded)
          .map((pr: any) => pr.number),
        [97],
      );
    });

    test("recognises a typed number only", () => {
      assert.strictEqual(utils.typedPullRequestNumber(" #97 "), 97);
      assert.strictEqual(utils.typedPullRequestNumber("97"), 97);
      assert.strictEqual(utils.typedPullRequestNumber("crm-97"), null);
      assert.strictEqual(utils.typedPullRequestNumber("0"), null);
    });
  });

  suite("journey", () => {
    const states = (steps: any[]) => steps.map((step) => step.state);

    test("follows the first merge target of each branch up to the top", () => {
      assert.deepStrictEqual(utils.journeyBranchPath(ORGS, "integration"), [
        "integration",
        "uat",
        "preprod",
        "main",
      ]);
      assert.deepStrictEqual(utils.journeyBranchPath(ORGS, "feature/x"), []);
    });

    test("stops on a loop of merge targets", () => {
      const loop = [
        { name: "a", mergeTargets: ["b"] },
        { name: "b", mergeTargets: ["a"] },
      ];
      assert.deepStrictEqual(utils.journeyBranchPath(loop, "a"), ["a", "b"]);
    });

    test("an open Pull Request waits everywhere, with the status of its jobs", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ jobsStatus: "failed" }),
        orgs: ORGS,
        windows: {},
      });
      assert.deepStrictEqual(states(steps), [
        "failed",
        "waiting",
        "waiting",
        "waiting",
        "waiting",
      ]);
    });

    test("a merged story is in the branches up to the window that holds it", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "merged" }),
        orgs: ORGS,
        windows: { integration: [], uat: [128] },
      });
      assert.deepStrictEqual(states(steps).slice(1), [
        "merged",
        "merged",
        "waiting",
        "waiting",
      ]);
    });

    test("a merged story found in no window is not guessed beyond its target", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "merged" }),
        orgs: ORGS,
        windows: { integration: [130], uat: [] },
      });
      assert.deepStrictEqual(states(steps).slice(1), [
        "merged",
        "unknown",
        "unknown",
        "unknown",
      ]);
    });

    test("a deployment run and a failed action decide the state of a branch", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "merged" }),
        orgs: ORGS,
        windows: { uat: [128] },
        workflows: [
          { kind: "validation", status: "valid" },
          { kind: "deployment", status: "valid", targetBranch: "integration" },
          { kind: "deployment", status: "valid", targetBranch: "uat" },
        ],
        statuses: [{ orgBranch: "uat", status: "failed" }],
      });
      assert.deepStrictEqual(states(steps), [
        "success",
        "deployed",
        "failed",
        "waiting",
        "waiting",
      ]);
    });

    test("the validation step is the one of the Pull Request, not of its carrier", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "merged" }),
        orgs: ORGS,
        windows: {},
        workflows: [
          { kind: "validation", status: "valid", prNumber: 128 },
          { kind: "validation", status: "invalid", prNumber: 140 },
        ],
      });
      assert.strictEqual(steps[0].state, "success");
    });

    test("names the promotion that carried a story to a branch", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({
          state: "merged",
          alreadyDeployedVia: [{ number: 140, targetBranch: "preprod" }],
        }),
        orgs: ORGS,
        windows: {},
      });
      const preprod = steps.find((step: any) => step.branch === "preprod");
      assert.strictEqual(preprod.state, "merged");
      assert.strictEqual(preprod.carriedBy, 140);
    });

    test("every state has a pill of the status palette", () => {
      for (const state of [
        "waiting",
        "running",
        "pending",
        "success",
        "merged",
        "deployed",
        "failed",
        "unknown",
      ]) {
        assert.match(
          utils.journeyPillClass(state),
          /^hardis-pill hardis-status-(success|failed|running|pending|info|unknown)$/,
        );
      }
    });
  });

  suite("modal state", () => {
    test("restores a window as it was left, whatever happened since", () => {
      const component: any = {};
      utils.applyModalState(component, null);
      component.modalMode = "branch";
      component.modalBranchName = "uat";
      component.modalSelectedPrIds = ["a", "b"];
      component.selectedGoLiveId = "sha1";
      const snapshot = utils.captureModalState(component);

      component.modalSelectedPrIds.push("c");
      utils.applyModalState(component, null);
      assert.deepStrictEqual(component.modalSelectedPrIds, []);
      assert.strictEqual(component.modalBranchName, "");

      utils.applyModalState(component, snapshot);
      assert.deepStrictEqual(component.modalSelectedPrIds, ["a", "b"]);
      assert.strictEqual(component.modalBranchName, "uat");
      assert.strictEqual(component.selectedGoLiveId, "sha1");
    });

    test("never hands the same array to two windows", () => {
      const first: any = {};
      const second: any = {};
      utils.applyModalState(first, null);
      utils.applyModalState(second, null);
      first.modalTickets.push("x");
      assert.deepStrictEqual(second.modalTickets, []);
      assert.deepStrictEqual(utils.MODAL_STATE_DEFAULTS.modalTickets, []);
    });

    test("every field of the list is a field of the component", () => {
      const js = readModuleFile("pipeline", "pipeline.js");
      for (const field of Object.keys(utils.MODAL_STATE_DEFAULTS)) {
        assert.match(
          js,
          new RegExp(`^  (@track )?${field} = `, "m"),
          `MODAL_STATE_DEFAULTS names ${field}, which s/pipeline does not declare`,
        );
      }
    });
  });

  suite("links", () => {
    test("only follows a plain https address", () => {
      assert.strictEqual(
        utils.safeWebUrl("https://ci.example.com/jobs/12"),
        "https://ci.example.com/jobs/12",
      );
      assert.strictEqual(utils.safeWebUrl("javascript:alert(1)"), "");
      // A self-hosted provider is not always served over https
      assert.strictEqual(
        utils.safeWebUrl("http://git.intranet/acme/sf/pull/1"),
        "http://git.intranet/acme/sf/pull/1",
      );
      assert.strictEqual(utils.safeWebUrl("data:text/html,x"), "");
      assert.strictEqual(utils.safeWebUrl('https://x.com/"onclick='), "");
    });

    test("recognises a Pull Request of the repository on every provider", () => {
      const cases: Array<[string, string, number]> = [
        ["https://github.com/acme/sf", "https://github.com/acme/sf/pull/128", 128],
        [
          "https://gitlab.com/acme/sf",
          "https://gitlab.com/acme/sf/-/merge_requests/7#note_1",
          7,
        ],
        [
          "https://dev.azure.com/acme/crm/_git/sf",
          "https://dev.azure.com/acme/crm/_git/sf/pullrequest/42?_a=overview",
          42,
        ],
        [
          "https://bitbucket.org/acme/sf",
          "https://bitbucket.org/acme/sf/pull-requests/9",
          9,
        ],
        ["https://gitea.acme.com/acme/sf.git", "https://gitea.acme.com/acme/sf/pulls/3", 3],
      ];
      for (const [repository, url, expected] of cases) {
        assert.strictEqual(parsePullRequestNumberFromUrl(url, repository), expected);
      }
    });

    test("leaves any other address to the browser", () => {
      const repository = "https://github.com/acme/sf";
      for (const url of [
        "https://github.com/acme/other/pull/128",
        "https://github.com/acme/sf-fork/pull/128",
        "https://github.com/acme/sf/compare/main...feature",
        "https://github.com/acme/sf/issues/128",
        "https://evil.example.com/?next=https://github.com/acme/sf/pull/128",
        "",
      ]) {
        assert.strictEqual(parsePullRequestNumberFromUrl(url, repository), null);
      }
      assert.strictEqual(
        parsePullRequestNumberFromUrl("https://github.com/acme/sf/pull/1", null),
        null,
      );
    });
  });

  suite("wiring", () => {
    const html = readModuleFile("pipeline", "pipeline.html");
    const js = readModuleFile("pipeline", "pipeline.js");

    test("every way to one Pull Request goes through openPullRequestView", () => {
      const direct = js.match(/type: "getPrInfoForModal"/g) || [];
      assert.strictEqual(
        direct.length,
        1,
        "getPrInfoForModal must only be sent by openPullRequestView",
      );
    });

    test("one Pull Request opens on its description, then its comments by kind", () => {
      assert.match(html, /<lightning-tab label=\{i18n\.prGeneralTab\} value="general"/);
      for (const tab of ["validation", "deployment", "megalinter"]) {
        assert.match(html, new RegExp(`<lightning-tab [^>]*value="${tab}"`));
      }
      assert.ok(!html.includes('value="workflows"'), "no Workflows tab");
      assert.match(js, /this\._nextModalTab \|\| "general"/);
      // Only the comments of the Pull Request itself, never those of one that carried it
      assert.match(js, /return pr && pr\.number > 0 \? \[pr\.number\] : \[\];/);
    });

    test("the comments are shown as they are, without a button to unfold them", () => {
      const runs = readModuleFile("workflowRuns", "workflowRuns.html");
      assert.match(runs, /<s-markdown-view markdown=\{row\.body\}>/);
      assert.ok(!/handleToggle|aria-expanded/.test(runs));
    });

    test("Previous and Close both bring back the window the Pull Request was opened from", () => {
      assert.match(html, /label=\{i18n\.prViewPrevious\}[\s\S]*?onclick=\{handleModalPrevious\}/);
      const close = js.slice(
        js.indexOf("  handleClosePRModal() {"),
        js.indexOf("this.showPRModal = false;", js.indexOf("  handleClosePRModal() {")),
      );
      assert.match(close, /this\._modalStack\.length > 0[\s\S]*this\._goBackTo\(/);
    });

    test("the only way out to the git provider is the button of the header", () => {
      assert.ok(!html.includes("singlePRViewButtonLabel"));
      assert.match(
        readModuleFile("pullRequestHeader", "pullRequestHeader.html"),
        /label=\{openOnPlatformLabel\}/,
      );
    });

    test("the comment of a run is rendered through the sanitizer only", () => {
      const view = readModuleFile("markdownView", "markdownView.js");
      assert.match(view, /purify\.sanitize\(/);
      assert.match(view, /ALLOWED_URI_REGEXP: \/\^https\?:/);
      assert.ok(
        !/innerHTML = (?!html)/.test(view),
        "markdownView must only write sanitized HTML",
      );
    });

    test("the other panels hand their Pull Request links to the host", () => {
      assert.match(
        readModuleFile("backpromote", "backpromote.js"),
        /type: "openPullRequest"/,
      );
      assert.match(
        readSourceFile("webviews/lwc-ui-panel.ts"),
        /case "openPullRequest":/,
      );
    });

    test("the labels of the view are translated in every locale", () => {
      const keys = new Set<string>();
      const sources = [
        html,
        js,
        ...["pullRequestLookup", "pullRequestHeader", "workflowRuns", "ticketList"].flatMap(
          (module) => [
            readModuleFile(module, `${module}.html`),
            readModuleFile(module, `${module}.js`),
          ],
        ),
      ];
      for (const source of sources) {
        for (const match of source.matchAll(
          /i18n\.((?:pr(?:Lookup|View|State|Explorer)|journey|workflow|ticket(?:NotFound|ingTool|sAll)|pullRequestsExplorer)\w*)/g,
        )) {
          keys.add(match[1]);
        }
        for (const match of source.matchAll(
          /\bt\(\s*"((?:pr(?:Lookup|View)|journey|workflow|ticketNotFound)\w*)"/g,
        )) {
          keys.add(match[1]);
        }
      }
      assert.ok(keys.size > 25, `only ${keys.size} keys found`);
      assertKeysTranslated(keys);
    });
  });
});
