import * as assert from "assert";
import {
  assertKeysTranslated,
  extractMember,
  readModuleFile,
  readSourceFile,
} from "./lwcSourceUtils";
import {
  isSafeJobUrl,
  looksLikePullRequestUrl,
  parsePullRequestNumberFromUrl,
} from "../../utils/pullRequestUrlUtils";

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
  "MODAL_LOADING_FLAGS",
  "resetModalLoadingFlags",
  "captureModalState",
  "applyModalState",
  "lookupState",
  "filterLoadedPullRequests",
  "filterPullRequestList",
  "excludeKnownPullRequests",
  "typedPullRequestNumber",
  "journeyBranchPath",
  "buildPullRequestJourney",
  "journeyPillClass",
  "journeyPathStep",
  "runningJobRows",
  "safeWebUrl",
  "isTrustedCommentImage",
  "buildArtifactEntries",
  "formatFileSize",
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

    test("recognizes a typed number only", () => {
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

    test("a vehicle stops at the branch it is merged into", () => {
      // A promotion from uat lands in preprod and never goes to main: the stories it carries
      // do, in another vehicle
      for (const flags of [{ isPromotion: true }, { isMajorToMajor: true }]) {
        const steps = utils.buildPullRequestJourney({
          pr: pullRequest({ state: "open", targetBranch: "preprod", ...flags }),
          orgs: ORGS,
          windows: {},
        });
        assert.deepStrictEqual(
          steps.map((step: any) => step.branch),
          ["preprod", "preprod"],
        );
        assert.deepStrictEqual(
          steps.map((step: any) => step.kind),
          ["validation", "branch"],
        );
      }
      // A story with the same target goes on to the top
      const story = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "open", targetBranch: "preprod" }),
        orgs: ORGS,
        windows: {},
      });
      assert.ok(story.length > 2);
    });

    test("a promotion is told by what it declares, whatever the project setting says", () => {
      const host = readSourceFile("commands/showPipeline.ts");
      assert.match(
        host,
        /isPromotionPullRequest\(prDetails, \{\s*allowedSteps: promotionConfig\?\.allowedSteps \|\| \[\],\s*enabled: true,\s*\}\)/,
      );
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

    test("names the Pull Request that carried the story to every branch it reached", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({
          state: "merged",
          mergeDate: "2026-10-01T10:00:00.000Z",
        }),
        orgs: ORGS,
        // Reached preprod: listed in its window
        windows: { preprod: [128] },
        vehicles: [
          // Merged before the story was in integration: it did not carry it
          {
            number: 130,
            state: "merged",
            sourceBranch: "integration",
            targetBranch: "uat",
            mergeDate: "2026-09-30T10:00:00.000Z",
          },
          {
            number: 135,
            state: "merged",
            sourceBranch: "integration",
            targetBranch: "uat",
            mergeDate: "2026-10-02T10:00:00.000Z",
          },
          {
            number: 137,
            state: "merged",
            sourceBranch: "integration",
            targetBranch: "uat",
            mergeDate: "2026-10-03T10:00:00.000Z",
          },
          {
            number: 141,
            state: "merged",
            sourceBranch: "uat",
            targetBranch: "preprod",
            mergeDate: "2026-10-04T10:00:00.000Z",
          },
          {
            number: 150,
            state: "open",
            sourceBranch: "preprod",
            targetBranch: "main",
          },
        ],
      });
      assert.deepStrictEqual(
        steps.map((step: any) => [
          step.branch,
          step.kind,
          step.carriedBy,
          step.carrierOpen,
        ]),
        [
          ["integration", "validation", null, false],
          // Its own merge took it to its target branch
          ["integration", "branch", null, false],
          ["uat", "branch", 135, false],
          ["preprod", "branch", 141, false],
          // Not there yet: the open merge that will take it
          ["main", "branch", 150, true],
        ],
      );
    });

    test("a promotion that declares the story is its carrier, open or merged", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({
          state: "merged",
          mergeDate: "2026-10-01T10:00:00.000Z",
        }),
        orgs: ORGS,
        windows: { uat: [128] },
        vehicles: [
          {
            number: 139,
            state: "merged",
            sourceBranch: "promotion/integration/uat/2026-10-02-0900",
            targetBranch: "uat",
            mergeDate: "2026-10-02T10:00:00.000Z",
            promotionPullRequests: [128, 131],
          },
          // Another promotion toward preprod, for other stories
          {
            number: 142,
            state: "open",
            sourceBranch: "promotion/uat/preprod/2026-10-03-0900",
            targetBranch: "preprod",
            promotionPullRequests: [131],
          },
          {
            number: 143,
            state: "open",
            sourceBranch: "promotion/uat/preprod/2026-10-03-1000",
            targetBranch: "preprod",
            promotionPullRequests: [128],
          },
        ],
      });
      const byBranch = (branch: string) =>
        steps.find(
          (step: any) => step.kind === "branch" && step.branch === branch,
        );
      assert.strictEqual(byBranch("uat").carriedBy, 139);
      assert.strictEqual(byBranch("uat").carrierOpen, false);
      assert.strictEqual(byBranch("preprod").carriedBy, 143);
      assert.strictEqual(byBranch("preprod").carrierOpen, true);
      // Nothing is known about the step after the next one
      assert.strictEqual(byBranch("main").carriedBy, null);
    });

    test("never guesses a carrier when no date says which merge it was", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "merged" }),
        orgs: ORGS,
        windows: { uat: [128] },
        vehicles: [
          {
            number: 135,
            state: "merged",
            sourceBranch: "integration",
            targetBranch: "uat",
            mergeDate: "2026-10-02T10:00:00.000Z",
          },
        ],
      });
      assert.strictEqual(
        steps.find((step: any) => step.key === "branch-uat").carriedBy,
        null,
      );
    });

    test("the checks of an open Pull Request move its validation step", () => {
      const running = utils.buildPullRequestJourney({
        pr: pullRequest({ jobsStatus: "failed" }),
        orgs: ORGS,
        windows: {},
        runningJobs: {
          pullRequest: [
            { kind: "codeQuality", status: "running", name: "Mega-Linter" },
            { kind: "validation", status: "pending", name: "Simulate" },
            { kind: "deployment", status: "running", name: "Not a check" },
          ],
          branches: {},
        },
      });
      assert.strictEqual(running[0].state, "running");
      assert.strictEqual(running[0].runningJobs.length, 2);

      const queued = utils.buildPullRequestJourney({
        pr: pullRequest(),
        orgs: ORGS,
        windows: {},
        runningJobs: {
          pullRequest: [
            { kind: "validation", status: "pending", name: "Simulate" },
          ],
          branches: {},
        },
      });
      assert.strictEqual(queued[0].state, "pending");
    });

    test("a job that just ended no longer moves the step, whatever the list still says", () => {
      const steps = utils.buildPullRequestJourney({
        // Read with the list of Pull Requests, up to a minute ago
        pr: pullRequest({ jobsStatus: "running" }),
        orgs: ORGS,
        windows: {},
        workflows: [{ kind: "validation", status: "valid" }],
        runningJobs: { pullRequest: [], branches: {} },
      });
      assert.strictEqual(steps[0].state, "success");
      // While the provider did not answer yet, the list is all there is
      const before = utils.buildPullRequestJourney({
        pr: pullRequest({ jobsStatus: "running" }),
        orgs: ORGS,
        windows: {},
        runningJobs: null,
      });
      assert.strictEqual(before[0].state, "running");
    });

    test("a deployment started after the merge is the one of the Pull Request", () => {
      const deployment = {
        kind: "deployment",
        status: "running",
        name: "deploy_to_org",
        webUrl: "https://git.example.com/jobs/9",
        startedAt: "2026-10-01T10:01:00.000Z",
      };
      const journey = (overrides: Record<string, any> = {}) =>
        utils.buildPullRequestJourney({
          pr: pullRequest({
            state: "merged",
            mergeDate: "2026-10-01T10:00:00.000Z",
          }),
          orgs: ORGS,
          windows: { integration: [128] },
          runningJobs: {
            pullRequest: [],
            branches: { integration: [deployment] },
          },
          ...overrides,
        });
      const integration = (steps: any[]) =>
        steps.find((step: any) => step.key === "branch-integration");

      assert.strictEqual(integration(journey()).state, "running");
      assert.deepStrictEqual(integration(journey()).runningJobs, [deployment]);

      // Started before the merge: the deployment of an earlier Pull Request
      const earlier = journey({
        runningJobs: {
          pullRequest: [],
          branches: {
            integration: [
              { ...deployment, startedAt: "2026-10-01T09:50:00.000Z" },
            ],
          },
        },
      });
      assert.strictEqual(integration(earlier).state, "merged");

      // Its deployment has its result: what runs now deploys a later merge
      const settledWorkflows = [
        {
          kind: "deployment",
          targetBranch: "integration",
          status: "valid",
          date: "2026-10-01T10:05:00.000Z",
        },
      ];
      const settledJobs = {
        pullRequest: [],
        branches: {
          integration: [
            { ...deployment, startedAt: "2026-10-01T11:00:00.000Z" },
          ],
        },
      };
      const settled = journey({
        workflows: settledWorkflows,
        arrivals: {
          integration: ["2026-10-01T10:00:00.000Z", "2026-10-01T10:58:00.000Z"],
        },
        runningJobs: settledJobs,
      });
      assert.strictEqual(integration(settled).state, "deployed");
      assert.deepStrictEqual(integration(settled).runningJobs, []);
      // Nothing was merged since: the same deployment is being run again
      const rerun = journey({
        workflows: settledWorkflows,
        arrivals: { integration: ["2026-10-01T10:00:00.000Z"] },
        runningJobs: settledJobs,
      });
      assert.strictEqual(integration(rerun).state, "running");

      // A check of the branch is no deployment
      const check = journey({
        runningJobs: {
          pullRequest: [],
          branches: { integration: [{ ...deployment, kind: "validation" }] },
        },
      });
      assert.strictEqual(integration(check).state, "merged");
    });

    test("the deployment of a later branch counts from the merge of its carrier", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({
          state: "merged",
          mergeDate: "2026-10-01T10:00:00.000Z",
          alreadyDeployedVia: [
            {
              number: 140,
              targetBranch: "uat",
              mergeDate: "2026-10-03T10:00:00.000Z",
            },
          ],
        }),
        orgs: ORGS,
        windows: {},
        runningJobs: {
          pullRequest: [],
          branches: {
            uat: [
              {
                kind: "deployment",
                status: "pending",
                name: "deploy_to_org",
                startedAt: "2026-10-03T10:00:30.000Z",
              },
            ],
          },
        },
      });
      const uat = steps.find((step: any) => step.key === "branch-uat");
      assert.strictEqual(uat.state, "pending");
      const rows = utils.runningJobRows(steps);
      assert.deepStrictEqual(rows.validation, []);
      assert.deepStrictEqual(
        rows.deployment.map((row: any) => [
          row.kind,
          row.targetBranch,
          row.carriedBy,
          row.status,
        ]),
        [["deployment", "uat", 140, "pending"]],
      );
    });

    test("the running checks go to their tab", () => {
      const rows = utils.runningJobRows(
        utils.buildPullRequestJourney({
          pr: pullRequest(),
          orgs: ORGS,
          windows: {},
          runningJobs: {
            pullRequest: [
              { kind: "codeQuality", status: "running", name: "Mega-Linter" },
              { kind: "validation", status: "running", name: "Simulate" },
            ],
            branches: {},
          },
        }),
      );
      assert.deepStrictEqual(
        [rows.validation, rows.megalinter, rows.deployment].map((list: any[]) =>
          list.map((row: any) => `${row.kind}:${row.name}:${row.targetBranch}`),
        ),
        [
          ["validation:Simulate:integration"],
          ["megalinter:Mega-Linter:integration"],
          [],
        ],
      );
    });

    test("a step whose job is going on moves, a step being read does not", () => {
      assert.match(
        utils.journeyPathStep("running").stepClass,
        /hardis-path-running hardis-path-moving$/,
      );
      assert.match(
        utils.journeyPathStep("pending").stepClass,
        /hardis-path-pending hardis-path-moving$/,
      );
      for (const state of ["success", "deployed", "failed", "waiting"]) {
        assert.doesNotMatch(
          utils.journeyPathStep(state).stepClass,
          /hardis-path-moving/,
        );
      }
      assert.doesNotMatch(
        utils.journeyPathStep("running", true).stepClass,
        /hardis-path-moving/,
      );
    });

    test("a Pull Request closed without being merged goes to no branch", () => {
      const steps = utils.buildPullRequestJourney({
        pr: pullRequest({ state: "closed" }),
        orgs: ORGS,
        windows: {},
      });
      assert.deepStrictEqual(
        steps.map((step: any) => step.kind),
        ["validation"],
      );
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

    test("a restored window never waits for an answer that was dropped", () => {
      const component: any = {};
      utils.applyModalState(component, null);
      component.ticketDetailsLoading = true;
      component.actionStatusesLoading = true;
      const snapshot = utils.captureModalState(component);
      for (const flag of utils.MODAL_LOADING_FLAGS) {
        assert.ok(
          !(flag in snapshot),
          flag + " must not be part of a saved window",
        );
      }
      utils.resetModalLoadingFlags(component);
      assert.strictEqual(component.ticketDetailsLoading, false);
      assert.strictEqual(component.actionStatusesLoading, false);
      const js = readModuleFile("pipeline", "pipeline.js");
      for (const flag of utils.MODAL_LOADING_FLAGS) {
        assert.match(js, new RegExp("^  (@track )?" + flag + " = ", "m"));
      }
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

    test("recognizes a Pull Request of the repository on every provider", () => {
      const cases: Array<[string, string, number]> = [
        [
          "https://github.com/acme/sf",
          "https://github.com/acme/sf/pull/128",
          128,
        ],
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
        [
          "https://gitea.acme.com/acme/sf.git",
          "https://gitea.acme.com/acme/sf/pulls/3",
          3,
        ],
      ];
      for (const [repository, url, expected] of cases) {
        assert.strictEqual(
          parsePullRequestNumberFromUrl(url, repository),
          expected,
        );
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
        assert.strictEqual(
          parsePullRequestNumberFromUrl(url, repository),
          null,
        );
      }
      assert.strictEqual(
        parsePullRequestNumberFromUrl(
          "https://github.com/acme/sf/pull/1",
          null,
        ),
        null,
      );
    });
  });

  suite("job files", () => {
    const files = (paths: string[]) =>
      paths.map((path, index) => ({ path, sizeBytes: (index + 1) * 1024 }));
    const manyFiles = files([
      "megalinter-reports/linters_logs/APEX-SUCCESS.log",
      "megalinter-reports/linters_logs/FLOW-WARNING.log",
      "megalinter-reports/IDE-config/.vscode/extensions.json",
      "megalinter-reports/IDE-config.txt",
      "megalinter-reports/megalinter-report.json",
      "megalinter-reports/megalinter.log",
      "megalinter-reports/a.csv",
      "megalinter-reports/b.csv",
      "megalinter-reports/c.csv",
      "megalinter-reports/d.csv",
      "mega-linter.log",
    ]);

    test("a few files are listed all at once, with their path", () => {
      const listing = utils.buildArtifactEntries(
        files(["xls/deployment-components.xlsx", "deploy-result.json"]),
      );
      assert.strictEqual(listing.byFolder, false);
      assert.deepStrictEqual(listing.crumbs, []);
      assert.deepStrictEqual(
        listing.entries.map((entry: any) => [entry.label, entry.isFolder]),
        [
          ["xls/deployment-components.xlsx", false],
          ["deploy-result.json", false],
        ],
      );
      assert.strictEqual(
        utils.buildArtifactEntries(
          files(new Array(10).fill("a").map((name, index) => name + index)),
        ).byFolder,
        false,
      );
    });

    test("more than ten files are browsed folder by folder, folders first", () => {
      const root = utils.buildArtifactEntries(manyFiles);
      assert.strictEqual(root.byFolder, true);
      assert.deepStrictEqual(
        root.entries.map((entry: any) => [
          entry.label,
          entry.isFolder,
          entry.fileCount,
        ]),
        [
          ["megalinter-reports", true, 10],
          ["mega-linter.log", false, undefined],
        ],
      );
      assert.deepStrictEqual(root.crumbs, [{ label: "", path: "" }]);

      const reports = utils.buildArtifactEntries(
        manyFiles,
        "megalinter-reports",
      );
      assert.deepStrictEqual(
        reports.entries
          .filter((entry: any) => entry.isFolder)
          .map((entry: any) => [entry.path, entry.fileCount]),
        [
          ["megalinter-reports/IDE-config", 1],
          ["megalinter-reports/linters_logs", 2],
        ],
      );
      assert.strictEqual(
        reports.entries.filter((entry: any) => !entry.isFolder).length,
        7,
      );
      // A file keeps its full path, the one opened, under the name of its folder
      assert.deepStrictEqual(
        reports.entries.find((entry: any) => entry.label === "megalinter.log")
          .path,
        "megalinter-reports/megalinter.log",
      );

      const logs = utils.buildArtifactEntries(
        manyFiles,
        "megalinter-reports/linters_logs/",
      );
      assert.deepStrictEqual(logs.crumbs, [
        { label: "", path: "" },
        { label: "megalinter-reports", path: "megalinter-reports" },
        { label: "linters_logs", path: "megalinter-reports/linters_logs" },
      ]);
      assert.strictEqual(logs.entries.length, 2);
    });

    test("a folder is not confused with another one that starts like it", () => {
      const listing = utils.buildArtifactEntries(
        [...manyFiles, { path: "megalinter-reports-old/x.log", sizeBytes: 1 }],
        "megalinter-reports",
      );
      assert.ok(
        !listing.entries.some((entry: any) => entry.path.includes("-old")),
      );
    });

    test("anything that is not a list of files gives an empty list", () => {
      for (const value of [null, undefined, "x", [{ path: "" }, null]]) {
        assert.deepStrictEqual(utils.buildArtifactEntries(value).entries, []);
      }
    });

    test("sizes read as a person writes them", () => {
      assert.strictEqual(utils.formatFileSize(512), "512 B");
      assert.strictEqual(utils.formatFileSize(48 * 1024), "48 KB");
      assert.strictEqual(utils.formatFileSize(1.25 * 1024 * 1024), "1.3 MB");
      assert.strictEqual(utils.formatFileSize(undefined), "0 B");
    });

    test("only a plain job address reaches the command line", () => {
      for (const url of [
        "https://github.com/acme/my-repo/actions/runs/123456",
        "https://gitlab.acme.com/group/sub/project/-/jobs/987",
        "http://gitlab.internal:8080/group/project/-/jobs/987",
        "https://dev.azure.com/acme/My%20Project/_build/results?buildId=42&view=results",
      ]) {
        assert.strictEqual(isSafeJobUrl(url), true, url);
      }
      for (const url of [
        'https://github.com/acme/repo/actions/runs/1" && calc "',
        "https://github.com/acme/repo/actions/runs/1 --debug",
        "https://github.com/acme/repo/actions/runs/$(whoami)",
        "https://github.com/acme/repo/actions/runs/`whoami`",
        "https://github.com/acme/repo/actions/runs/1;ls",
        "https://github.com/acme/repo/actions/runs/1|more",
        "file:///etc/passwd",
        "",
        null,
      ]) {
        assert.strictEqual(isSafeJobUrl(url), false, String(url));
      }
    });

    test("the Files button sits after Open comment, only when the files can be downloaded", () => {
      const runsHtml = readModuleFile("workflowRuns", "workflowRuns.html");
      assert.ok(
        runsHtml.indexOf("i18n.workflowOpenComment") <
          runsHtml.indexOf("onclick={handleFilesClick}"),
      );
      assert.match(
        runsHtml,
        /<template if:true=\{row\.showFiles\}>\s*<button[^>]*onclick=\{handleFilesClick\}/,
      );
      const runsJs = readModuleFile("workflowRuns", "workflowRuns.js");
      assert.match(
        runsJs,
        /const showFiles = this\.artifactsSupported === true && !!jobUrl;/,
      );
      // The three tabs give their list the answers and the capability
      const html = readModuleFile("pipeline", "pipeline.html");
      assert.strictEqual(
        html.split("artifacts-supported={artifactsSupported}").length - 1,
        3,
      );
      assert.strictEqual(html.split("artifacts={jobArtifacts}").length - 1, 3);
    });

    test("the files are downloaded by sfdx-hardis, in agent mode, for a checked address", () => {
      const host = readSourceFile("commands/showPipeline.ts");
      const loader = host.slice(
        host.indexOf("async function loadJobArtifacts("),
      );
      assert.ok(
        loader.indexOf("if (!isSafeJobUrl(jobUrl))") <
          loader.indexOf("execSfdxJson("),
      );
      assert.match(
        loader,
        /sf hardis:git:artifacts:download --agent --job-url "\$\{jobUrl\}"/,
      );
    });

    test("the capability goes with the runs, also when no action status came back", () => {
      const host = readSourceFile("commands/showPipeline.ts");
      // Once with the statuses, once without: the runs are shown in both cases
      assert.strictEqual(
        (
          host.match(
            /artifactsSupported: result\??\.artifactsSupported === true/g,
          ) || []
        ).length,
        2,
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

    test("the window opens with the click, before the Pull Request is read", () => {
      const body = js.slice(
        js.indexOf("  openPullRequestView({"),
        js.indexOf("  _openPendingPullRequestWindow("),
      );
      const opens = body.indexOf(
        "this._openPendingPullRequestWindow(pr, number)",
      );
      const asks = body.indexOf('type: "getPrInfoForModal"');
      assert.ok(opens > 0, "openPullRequestView opens the pending window");
      assert.ok(
        opens < asks,
        "the window is opened before the extension is asked",
      );
      // What the panel already holds is shown above the spinner
      assert.ok(html.includes("if:true={showPendingPullRequestHeader}"));
      // No such Pull Request: the window opened by the click is closed again
      assert.match(
        js,
        /if \(openedByClick\) \{\s+this\.handleClosePRModal\(\);/,
      );
    });

    test("a line says the statuses are loading, where the switch and the totals will be", () => {
      const loading = html.indexOf("if:true={showActionsHeadLoading}");
      const head = html.indexOf("if:true={showActionsHead}");
      assert.ok(loading > 0, "the loading line is in the template");
      assert.ok(loading < head, "it stands where the head will be");
      assert.match(
        js,
        /get showActionsHeadLoading\(\) \{\s+return \(\s+this\.modalActions\.length > 0 &&\s+!this\.modalActionStatuses &&\s+this\.actionStatusesLoading/,
      );
    });

    test("one Pull Request opens on its description, then its comments by kind", () => {
      assert.match(
        html,
        /<lightning-tab [^>]*label=\{i18n\.prGeneralTab\} value="general"/,
      );
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
      assert.match(
        html,
        /label=\{i18n\.prViewPrevious\}[\s\S]*?onclick=\{handleModalPrevious\}/,
      );
      const close = js.slice(
        js.indexOf("  handleClosePRModal() {"),
        js.indexOf(
          "this.showPRModal = false;",
          js.indexOf("  handleClosePRModal() {"),
        ),
      );
      assert.match(
        close,
        /this\._modalStack\.length > 0[\s\S]*this\._goBackTo\(/,
      );
    });

    test("the only way out to the git provider is the button of the header", () => {
      assert.ok(!html.includes("singlePRViewButtonLabel"));
      assert.match(
        readModuleFile("pullRequestHeader", "pullRequestHeader.html"),
        /label=\{openOnPlatformLabel\}/,
      );
    });

    test("the diagram never waits for the details of the tickets", () => {
      const orgConfig = readSourceFile("utils/orgConfigUtils.ts");
      assert.ok(
        !/completePullRequestsWithTickets\([^)]*\{\s*fetchDetails: true/.test(
          orgConfig,
        ),
        "the branch windows must not read ticket details while the pipeline loads",
      );
      // A window asks for them when it is shown, and says it is waiting
      assert.match(js, /_requestTicketDetails\(pullRequests\);/);
      assert.match(js, /type: "loadTicketDetails"/);
      assert.match(
        html,
        /<s-ticket-list[\s\S]*?loading=\{ticketDetailsLoading\}/,
      );
      assert.match(
        readSourceFile("commands/showPipeline.ts"),
        /type === "loadTicketDetails"/,
      );
    });

    test("a vehicle Pull Request lists what it carries in a second tab", () => {
      // A promotion, or a merge between two major branches
      const view = (state: Record<string, any>): any =>
        Object.assign(
          new Function(
            `return {
              ${extractMember(js, "get showCarriedPrTab()")},
              ${extractMember(js, "get modalCarriedPullRequests()")},
              ${extractMember(js, "get modalCarriedPrsTabLabel()")}
            };`,
          )(),
          {
            isSinglePRMode: true,
            i18n: { pullRequestLabel: "Pull Request" },
            t: (key: string, vars: Record<string, any>) =>
              `${key}:${vars.prLabel}:${vars.count}`,
            ["_mapPrsWithIcons"]: (prs: any[]) =>
              prs.map((pr) => ({ ...pr, numberLabel: `#${pr.number}` })),
          },
          state,
        );
      const carried = [{ number: 454 }, { number: 491 }];
      const vehicle = view({
        modalIsMajorPr: true,
        modalPullRequests: [{ number: 501, aggregatedPullRequests: carried }],
      });
      assert.strictEqual(vehicle.showCarriedPrTab, true);
      assert.deepStrictEqual(
        vehicle.modalCarriedPullRequests.map((pr: any) => pr.numberLabel),
        ["#454", "#491"],
      );
      assert.strictEqual(
        vehicle.modalCarriedPrsTabLabel,
        "prModalPrsTab:Pull Request:2",
      );
      // The same rows at each render, or the table would be drawn again every time
      assert.strictEqual(
        vehicle.modalCarriedPullRequests,
        vehicle.modalCarriedPullRequests,
      );
      // A story carries nothing: no tab
      const story = view({
        modalIsMajorPr: false,
        modalPullRequests: [{ number: 454 }],
      });
      assert.strictEqual(story.showCarriedPrTab, false);
      assert.deepStrictEqual(story.modalCarriedPullRequests, []);
      // Second tab, right after General, and each row opens its Pull Request in the panel
      assert.match(
        html,
        /value="general"[\s\S]*?<template if:true=\{showCarriedPrTab\}>\s*<lightning-tab[^>]*value="carried"[\s\S]*?<s-pull-request-list\s+pull-requests=\{modalCarriedPullRequests\}[\s\S]*?onopen=\{handleOpenPullRequestRef\}[\s\S]*?<template if:true=\{showPRTab\}>/,
      );
      assert.match(
        readSourceFile("commands/showPipeline.ts"),
        /PULL_REQUEST_VIEW_TABS = \[\s*"general",\s*"carried",/,
      );
    });

    test("the filter of a list matches every word typed, the carrier included", () => {
      const list = [
        {
          number: 124,
          title: "Opportunity stage notifications",
          authorLabel: "Sam Dubois",
          sourceBranch: "feature/CRM-1049-opportunity",
          relatedTickets: [{ id: "CRM-1049" }],
          carriedByPullRequest: {
            number: 125,
            sourceBranch: "promotion/integration/uat/2026-08-20-0930",
          },
        },
        {
          number: 129,
          title: "Fix invoice rounding",
          authorLabel: "Nadia Ferreira",
          sourceBranch: "fix/CRM-1101-invoice-rounding",
          relatedTickets: [{ id: "CRM-1101" }],
        },
        { number: 12, title: "Lead scoring", authorLabel: "Sam Dubois" },
      ];
      const numbers = (query: string) =>
        utils.filterPullRequestList(list, query).map((pr: any) => pr.number);
      // Nothing typed: the list itself, not a copy that would redraw the rows
      assert.strictEqual(utils.filterPullRequestList(list, "  "), list);
      assert.deepStrictEqual(numbers("#129"), [129]);
      assert.deepStrictEqual(numbers("invoice"), [129]);
      assert.deepStrictEqual(numbers("crm-1049"), [124]);
      assert.deepStrictEqual(numbers("sam"), [124, 12]);
      // What #125 brought, by its number or by its branch
      assert.deepStrictEqual(numbers("#125"), [124]);
      assert.deepStrictEqual(numbers("promotion/integration"), [124]);
      // Every word has to match
      assert.deepStrictEqual(numbers("sam lead"), [12]);
      assert.deepStrictEqual(numbers("sam invoice"), []);
      assert.deepStrictEqual(utils.filterPullRequestList(null, "x"), []);
    });

    test("a story names the Pull Request that carried it, by its number", () => {
      const listJs = readModuleFile("pullRequestList", "pullRequestList.js");
      const rows = Object.assign(
        new Function(
          "safeWebUrl",
          `return { ${extractMember(listJs, "get rows()")} };`,
        )((value: string) => value || ""),
        {
          selectable: false,
          showStatus: false,
          ["_selectedNumbers"]: [],
          t: (key: string, vars: Record<string, string>) =>
            `${key}:${vars.branch || vars.number}`,
          filtered: [
            {
              number: 124,
              relatedTickets: [{ id: "CRM-1049", url: "https://t/CRM-1049" }],
              carriedByPullRequest: {
                number: 125,
                sourceBranch: "promotion/integration/uat/2026-08-20-0930",
              },
              promotionLabel: "Carried by promotion/integration/uat/...",
            },
            { number: 125, promotionLabel: "Promotion of 4 Pull Request(s)" },
            { number: 129 },
          ],
        },
      ).rows;
      // The number is short where the branch is not, and it opens that Pull Request
      assert.strictEqual(rows[0].carriedNumber, 125);
      assert.strictEqual(rows[0].carriedLabel, "prCarriedByPromotion:#125");
      assert.strictEqual(
        rows[0].carriedTitle,
        "promotion/integration/uat/2026-08-20-0930",
      );
      assert.strictEqual(rows[0].promotionLabel, "");
      assert.deepStrictEqual(
        rows[0].tickets.map((ticket: any) => ticket.id),
        ["CRM-1049"],
      );
      // A promotion keeps its own pill, a story merged straight into the branch has none
      assert.strictEqual(rows[1].carriedNumber, 0);
      assert.strictEqual(
        rows[1].promotionLabel,
        "Promotion of 4 Pull Request(s)",
      );
      assert.strictEqual(rows[2].carriedNumber, 0);
      assert.strictEqual(rows[2].promotionLabel, "");
      const listHtml = readModuleFile(
        "pullRequestList",
        "pullRequestList.html",
      );
      assert.match(
        listHtml,
        /<template if:true=\{row\.carriedNumber\}>\s*<button[^>]*data-pr-number=\{row\.carriedNumber\}[^>]*onclick=\{handleOpen\}/,
      );
      assertKeysTranslated(
        new Set([
          "prListFilterPlaceholder",
          "prListNoMatch",
          "prListSelectAll",
          "prListSelectRow",
          "prListShownCount",
          "prListVehiclesFilter",
        ]),
      );
    });

    test("the lists of the view take their colors from the panel, not from the VS Code theme", () => {
      // The panel has a theme of its own: under a dark VS Code and a light panel, a background
      // read from the VS Code theme left the titles of the search results dark on dark
      for (const [folder, file] of [
        ["pullRequestLookup", "pullRequestLookup.css"],
        ["pullRequestList", "pullRequestList.css"],
      ]) {
        const css = readModuleFile(folder, file);
        assert.doesNotMatch(
          css,
          /(background|color):[^;]*var\(--vscode-(?!focusBorder)/,
          `${file} paints with a color of the VS Code theme`,
        );
      }
      const lookup = readModuleFile(
        "pullRequestLookup",
        "pullRequestLookup.css",
      );
      const dropdown = lookup.slice(lookup.indexOf(".lookup-dropdown {"));
      const rule = dropdown.slice(0, dropdown.indexOf("\n}"));
      assert.match(rule, /background: light-dark\(/);
      assert.match(rule, /\n\s*color: var\(--slds-g-color-neutral-base-15\);/);
    });

    test("a link that is not a Pull Request opens without waiting for the git provider", () => {
      for (const url of [
        "https://github.com/acme/crm/pull/128",
        "https://gitea.acme.com/acme/crm/pulls/128",
        "https://gitlab.acme.com/acme/crm/-/merge_requests/128#note_4",
        "https://dev.azure.com/acme/crm/_git/crm/pullrequest/128",
        "https://bitbucket.org/acme/crm/pull-requests/128/diff",
      ]) {
        assert.strictEqual(looksLikePullRequestUrl(url), true, url);
      }
      for (const url of [
        "https://acme.my.salesforce.com/lightning/setup/DeployStatus/home",
        "https://github.com/acme/crm/compare/main...uat",
        "https://github.com/acme/crm/pulls",
        "",
        null,
      ]) {
        assert.strictEqual(looksLikePullRequestUrl(url), false, String(url));
      }
      const panelSource = readSourceFile("webviews/lwc-ui-panel.ts");
      const handler = panelSource.slice(
        panelSource.indexOf("private async handleOpenPullRequest("),
      );
      // The shape is tested before the git provider module is loaded
      assert.ok(
        handler.indexOf("looksLikePullRequestUrl(url)") <
          handler.indexOf("utils/gitProviders/gitProvider"),
      );
    });

    test("the workflows flag is only given up when the CLI does not know it", () => {
      const host = readSourceFile("commands/showPipeline.ts");
      const isUnknownFlagError = new Function(
        `return ${host
          .slice(
            host.indexOf("function isUnknownFlagError("),
            host.indexOf("/**", host.indexOf("function isUnknownFlagError(")),
          )
          .replace("(message: string): boolean", "(message)")}`,
      )();
      assert.strictEqual(
        isUnknownFlagError(
          "Nonexistent flag: --with-workflows\nSee more help with --help",
        ),
        true,
      );
      // A provider that throttles, a network error, a timeout: the flag is asked again next time
      for (const message of [
        "429 Too Many Requests",
        "getaddrinfo ENOTFOUND gitlab.acme.com",
        "unknown error",
        "",
      ]) {
        assert.strictEqual(isUnknownFlagError(message), false, message);
      }
      assert.match(
        host,
        /if \(result && isUnknownFlagError\(firstError\)\) \{\s*workflowsFlagRefused = true;/,
      );
    });

    test("the running jobs are asked for a Pull Request whose window is not shown yet", () => {
      const messages: any[] = [];
      const view = (pr: any, overrides: Record<string, any> = {}) =>
        Object.assign(
          new Function(
            "window",
            "lookupState",
            "journeyBranchPath",
            `return { ${extractMember(js, "_requestRunningJobs()")} };`,
          )(
            { sendMessageToVSCode: (message: any) => messages.push(message) },
            utils.lookupState,
            utils.journeyBranchPath,
          ),
          {
            // A Pull Request opened by a link is read before its window is displayed
            showPRModal: false,
            singlePullRequest: pr,
            gitAuthenticated: true,
            explorerMode: false,
            pipelineData: { orgs: ORGS },
            ["_runningJobsRequestId"]: 0,
            ["_stopRunningJobsPoll"]: () => undefined,
            ...overrides,
          },
        );
      view(pullRequest())._requestRunningJobs();
      assert.deepStrictEqual(messages.pop(), {
        type: "loadPullRequestRunningJobs",
        data: { prNumber: 128, open: true, branches: [], requestId: 1 },
      });
      // Merged: the deployments of the branches it goes through
      view(pullRequest({ state: "merged" }))._requestRunningJobs();
      assert.deepStrictEqual(messages.pop().data.branches, [
        "integration",
        "uat",
        "preprod",
        "main",
      ]);
      // A vehicle ends in the branch it is merged into
      view(
        pullRequest({
          state: "merged",
          targetBranch: "uat",
          isPromotion: true,
        }),
      )._requestRunningJobs();
      assert.deepStrictEqual(messages.pop().data.branches, ["uat"]);
      // Nothing to ask without a git provider, for a closed one, or for a draft
      view(pullRequest(), { gitAuthenticated: false })._requestRunningJobs();
      view(pullRequest({ state: "closed" }))._requestRunningJobs();
      view(pullRequest({ number: -1 }))._requestRunningJobs();
      assert.strictEqual(messages.length, 0);
    });

    test("coming back to a Pull Request asks for the comments it was left without", () => {
      const requests: number[] = [];
      const runningJobsRequests: number[] = [];
      const back = (state: Record<string, any>) => {
        const view = Object.assign(
          new Function(
            "applyModalState",
            "resetModalLoadingFlags",
            `return { ${extractMember(js, "_goBackTo(index)")} };`,
          )(
            (target: any, saved: any) => Object.assign(target, saved),
            () => undefined,
          ),
          {
            ["_modalStack"]: [{ state }],
            ["_prViewRequestId"]: 1,
            actionStatusRequestId: 1,
            modalPullRequests: [],
            ["_requestActionStatuses"]: () => requests.push(1),
            ["_requestTicketDetails"]: () => undefined,
            // The jobs still going on are always asked again: they changed meanwhile
            ["_requestRunningJobs"]: () => runningJobsRequests.push(1),
            ["_showModalTab"]: () => undefined,
            ["_loadGoLives"]: () => undefined,
          },
        );
        view._goBackTo(0);
      };
      // Left before its comments arrived, and it carries no action
      back({
        modalMode: "singlePR",
        modalActions: [],
        modalWorkflows: null,
        workflowPrNumbers: [128],
      });
      assert.strictEqual(requests.length, 1);
      // Its comments were there: nothing to ask
      back({
        modalMode: "singlePR",
        modalActions: [],
        modalWorkflows: [],
        workflowPrNumbers: [128],
      });
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(runningJobsRequests.length, 2);
      // A branch window has no comment tab
      back({
        modalMode: "branch",
        modalActions: [],
        modalWorkflows: null,
        workflowPrNumbers: [],
      });
      assert.strictEqual(requests.length, 1);
    });

    test("the explorer drops the Pull Request that was still being read", () => {
      const explorer = extractMember(js, "handleOpenExplorer()");
      assert.ok(
        explorer.indexOf("this._prViewRequestId += 1;") > -1 &&
          explorer.indexOf("this._prViewRequestId += 1;") <
            explorer.indexOf("this.showPRModal = true;"),
      );
    });

    test("only the banners of sfdx-hardis and MegaLinter are loaded as images", () => {
      const root = "https://raw.githubusercontent.com/";
      for (const url of [
        root +
          "hardisgroupcom/sfdx-hardis/refs/heads/main/docs/assets/images/cloudity-banner.png",
        root +
          "hardisgroupcom/sfdx-hardis/refs/heads/main/docs/assets/images/pr-banner-validation-success.png",
        root + "oxsecurity/megalinter/main/docs/assets/images/ox-banner.png",
        "https://github.com/oxsecurity/megalinter/raw/main/docs/assets/images/ox-banner.png",
      ]) {
        assert.strictEqual(utils.isTrustedCommentImage(url), true, url);
      }
      for (const url of [
        // Another repository, another host, a look-alike, or a way out of the folder
        root + "someone/else/main/docs/assets/images/pixel.png",
        "https://example.com/hardisgroupcom/sfdx-hardis/main/docs/assets/images/a.png",
        root + "hardisgroupcom/sfdx-hardis-fork/main/docs/assets/images/a.png",
        root +
          "hardisgroupcom/sfdx-hardis/main/docs/assets/images/../../../x.png",
        root +
          "hardisgroupcom/sfdx-hardis/main/docs/assets/images/a.png?who=me",
        root + "hardisgroupcom/sfdx-hardis/main/docs/assets/images/a.svg",
        "http://raw.githubusercontent.com/oxsecurity/megalinter/main/docs/assets/images/ox-banner.png",
        "data:image/png;base64,AAAA",
        "",
        null,
      ]) {
        assert.strictEqual(
          utils.isTrustedCommentImage(url),
          false,
          String(url),
        );
      }
      const view = readModuleFile("markdownView", "markdownView.js");
      // Kept only when trusted, replaced by its alternative text otherwise
      assert.match(
        view,
        /isTrustedCommentImage\(node\.getAttribute\("src"\)\)\s*\)\s*\{\s*return;\s*\}\s*const alt =/,
      );
    });

    test("the journey is a path: filled once reached, pale while ahead", () => {
      const look = (state: string) => utils.journeyPathStep(state).look;
      assert.deepStrictEqual(["success", "deployed", "merged"].map(look), [
        "done",
        "done",
        "done",
      ]);
      assert.strictEqual(look("failed"), "failed");
      assert.strictEqual(look("running"), "running");
      assert.strictEqual(look("pending"), "pending");
      // Not started, or not known: still ahead, never a guess
      assert.deepStrictEqual(["waiting", "unknown", "anything"].map(look), [
        "ahead",
        "ahead",
        "ahead",
      ]);
      assert.strictEqual(
        utils.journeyPathStep("deployed").stepClass,
        "hardis-path-step hardis-path-done",
      );
      // A sign for what ended, a dot for what is going on, nothing for what has not started
      assert.strictEqual(utils.journeyPathStep("deployed").mark, "\u2713");
      assert.strictEqual(utils.journeyPathStep("failed").mark, "\u2715");
      assert.strictEqual(utils.journeyPathStep("running").dot, true);
      assert.strictEqual(utils.journeyPathStep("waiting").dot, false);
      assert.strictEqual(utils.journeyPathStep("waiting").mark, "");
      // A result still being read is grey, whatever is known so far, with a dot that says so
      const loading = utils.journeyPathStep("unknown", true);
      assert.strictEqual(loading.look, "ahead");
      assert.strictEqual(loading.dot, true);
      assert.match(loading.dotClass, /hardis-path-dot-loading/);
      assert.strictEqual(utils.journeyPathStep("pending", true).look, "ahead");
      const header = readModuleFile(
        "pullRequestHeader",
        "pullRequestHeader.html",
      );
      // The name of a step is never cut, and its state is not written next to it: the color
      // and the mark say it, the tooltip and the screen reader text spell it out
      assert.match(
        header,
        /<span class="slds-assistive-text">\{step\.stateLabel\}<\/span>/,
      );
      const theme = readSourceFile("../resources/global-theme.css");
      const stepRule = theme.slice(theme.indexOf(".hardis-path-step {"));
      assert.match(stepRule.slice(0, stepRule.indexOf("}")), /flex: 1 0 auto;/);
      const nameRule = theme.slice(theme.indexOf(".hardis-path-name {"));
      assert.doesNotMatch(
        nameRule.slice(0, nameRule.indexOf("}")),
        /ellipsis|overflow/,
      );
      // An ordered list, and the Pull Request that carried a step still opens from it
      assert.match(
        header,
        /<ol class="hardis-path">[\s\S]*?<li key=\{step\.key\} class=\{step\.stepClass\} title=\{step\.title\}>[\s\S]*?data-pr-number=\{step\.carriedBy\} onclick=\{handleOpenCarrier\}/,
      );
    });

    test("a step waiting for the results says so, and nothing is warned about while reading", () => {
      assert.match(
        html,
        /<s-pull-request-header[\s\S]*?loading=\{journeyLoading\}/,
      );
      const header = readModuleFile(
        "pullRequestHeader",
        "pullRequestHeader.js",
      );
      assert.match(header, /this\.loading && step\.state === "unknown"/);
      // The warning about someone else's Pull Request only shows while editing, or once saved
      assert.ok(!html.includes("if:true={showNotOwnPrNote}"));
      assert.match(html, /if:true=\{showNotOwnPrEditNote\}/);
      assert.strictEqual(
        (js.match(/warning: this\.notOwnPrWarning/g) || []).length,
        3,
      );
    });

    test("actions read from another branch cannot be changed from the window", () => {
      const view = (source: string | undefined, extra: any = {}) => {
        const instance = new Function(
          `return {
            ${extractMember(js, "get modalActionsFromBranch()")},
            ${extractMember(js, "get modalActionsReadOnly()")},
            ${extractMember(js, "get showAddActionButton()")},
            ${extractMember(js, "get canEditApexTestsOfPr()")},
            ${extractMember(js, "get actionsFromBranchNote()")}
          };`,
        )();
        return Object.assign(instance, {
          modalMode: "singlePR",
          modalIsMajorPr: false,
          modalActionsAggregated: false,
          prLabel: "Pull Request",
          modalPullRequests: [
            {
              number: 505,
              deploymentActionsSource: source,
              deploymentActionsBranch: "feature/story",
            },
          ],
          t: (key: string, vars: any) =>
            `${key}:${vars.branch || vars.prLabel}`,
          ...extra,
        });
      };
      // The file of the checked out branch, or a Pull Request loaded before this field existed
      for (const source of ["workingTree", undefined]) {
        assert.strictEqual(view(source).modalActionsFromBranch, false);
        assert.strictEqual(view(source).showAddActionButton, true);
        assert.strictEqual(view(source).canEditApexTestsOfPr, true);
        assert.strictEqual(view(source).modalActionsReadOnly, false);
      }
      const fromBranch = view("branch");
      assert.strictEqual(fromBranch.showAddActionButton, false);
      assert.strictEqual(fromBranch.canEditApexTestsOfPr, false);
      assert.strictEqual(fromBranch.modalActionsReadOnly, true);
      assert.strictEqual(
        fromBranch.actionsFromBranchNote,
        "prViewActionsFromBranch:feature/story",
      );
      assert.strictEqual(
        view("unreadable").actionsFromBranchNote,
        "prViewActionsUnreadable:Pull Request",
      );
      assert.strictEqual(view("unreadable").showAddActionButton, false);
      // A branch window is not concerned: its rows were already read-only
      assert.strictEqual(
        view("branch", { modalMode: "branch" }).modalActionsFromBranch,
        false,
      );
      // The note is on both tabs, the action dialog opens read-only, and no row offers to
      // delete, or to run through sfdx-hardis an action the checked out branch does not hold
      assert.strictEqual(
        (html.match(/if:true=\{modalActionsFromBranch\}/g) || []).length,
        2,
      );
      assert.match(html, /read-only=\{modalActionsReadOnly\}/);
      assert.match(
        html,
        /if:true=\{canEditApexTestsOfPr\}>\s*<lightning-button[\s\S]*?onclick=\{handleEditApexTests\}/,
      );
      assert.match(js, /if \(!this\.modalActionsReadOnly\) \{/);
      // In any window, a row read from another branch offers nothing that goes through
      // sfdx-hardis with its definition: run, retry, move, record ahead or in another org
      assert.match(
        js,
        /outOfCheckout: \["branch", "unreadable"\]\.includes\(\s*pr\.deploymentActionsSource,?\s*\)/,
      );
      assert.match(js, /const runnable =\s*!row\.outOfCheckout &&/);
      assert.match(js, /myPrNumber !== row\.prNumber && !row\.outOfCheckout/);
      assert.strictEqual(
        (js.match(/row\.prNumber > 0 && !row\.outOfCheckout/g) || []).length,
        2,
      );
      assert.match(
        js,
        /if \(row\.outOfCheckout\) \{[\s\S]{0,160}\} else if \(forecast\.forecast === "waiting" \|\| busy\)/,
      );
    });

    test("the description is shown without the links to the sfdx-hardis comments", () => {
      const view = new Function(
        `return { ${extractMember(js, "get singlePullRequestDescription()")} };`,
      )();
      view.singlePullRequest = {
        description:
          "<!-- sfdx-hardis nav-start -->\n[Validation](https://x) | [Deployment](https://y)\n<!-- sfdx-hardis nav-end -->\n\nMy story",
      };
      assert.strictEqual(view.singlePullRequestDescription, "My story");
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
        ...[
          "pullRequestLookup",
          "pullRequestHeader",
          "workflowRuns",
          "ticketList",
        ].flatMap((module) => [
          readModuleFile(module, `${module}.html`),
          readModuleFile(module, `${module}.js`),
        ]),
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
