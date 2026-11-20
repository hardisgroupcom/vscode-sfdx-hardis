import * as assert from "assert";
import {
  buildReleaseVersionLinks,
  buildReleaseVersionViews,
  findNextVersionFrom,
  getCachedReleaseVersions,
  invalidateReleaseVersionsCache,
  isReleaseVersioningDeclared,
  loadReleaseVersions,
  parseReleaseVersionList,
  ReleaseVersionDeps,
  withReleaseVersionLinks,
} from "../../utils/pipeline/releaseVersionUtils";
import { BranchStrategyMermaidBuilder } from "../../utils/pipeline/branchStrategyMermaidBuilder";

/**
 * Release versioning (sfdx-hardis releaseVersioning): the DevOps Pipeline shows the versions the
 * CLI lists, it never computes one. Covered: reading the answer of
 * sf hardis:project:version:list --json, when the CLI is run (and when it is not), the links built
 * from the repository URL, and the chips of the diagram.
 */

function entry(tag: string, branchName: string | null, extra: any = {}) {
  return {
    tag,
    version: tag.replace(/^v/, ""),
    prerelease: tag.includes("-rc."),
    branchName,
    commit: "ab12cd34ef56",
    deployedAt: "2026-11-17T14:02:11Z",
    org: "https://acme--uat.sandbox.my.salesforce.com",
    pullRequest: 512,
    jobUrl: "https://ci.example.com/jobs/1",
    tagUrl: null,
    releaseUrl: null,
    ...extra,
  };
}

const CLI_RESULT = {
  enabled: true,
  initialVersion: "1.0.0",
  minimumVersion: null,
  branches: [
    {
      branchName: "release/uat",
      role: "first",
      current: entry("v1.6.0-rc.1", "release/uat"),
      nextOnPromotion: [{ sourceBranch: "integration", tag: "v1.6.0-rc.2" }],
    },
    {
      branchName: "main",
      role: "final",
      current: entry("v1.5.0", "main"),
      nextOnPromotion: [{ sourceBranch: "release/uat", tag: "v1.6.0" }],
    },
  ],
  history: [
    entry("v1.6.0-rc.1", "release/uat"),
    entry("v1.5.0", "main"),
    { tag: 12 },
    null,
  ],
};

suite("Release versioning", () => {
  suite("answer of the CLI", () => {
    test("anything but a version list is refused", () => {
      for (const raw of [null, undefined, "x", {}, { enabled: "yes" }]) {
        assert.strictEqual(parseReleaseVersionList(raw), null);
      }
    });

    test("a version list is read, malformed entries are dropped", () => {
      const list = parseReleaseVersionList(CLI_RESULT)!;
      assert.strictEqual(list.enabled, true);
      assert.strictEqual(list.branches.length, 2);
      assert.strictEqual(list.history.length, 2);
      assert.strictEqual(list.branches[0].current?.prerelease, true);
      assert.strictEqual(list.branches[1].current?.prerelease, false);
      assert.strictEqual(list.history[0].pullRequest, 512);
    });

    test("only a branch config declaring releaseVersioning: true enables it", () => {
      assert.strictEqual(isReleaseVersioningDeclared([]), false);
      assert.strictEqual(
        isReleaseVersioningDeclared([{}, { releaseVersioning: false }]),
        false,
      );
      assert.strictEqual(
        isReleaseVersioningDeclared([{}, { releaseVersioning: true }]),
        true,
      );
    });

    test("branches named after their config file match the git names of the CLI", () => {
      const list = parseReleaseVersionList(CLI_RESULT);
      const views = buildReleaseVersionViews(list, [
        "integration",
        "release__uat",
        "main",
      ]);
      assert.deepStrictEqual(Object.keys(views).sort(), [
        "main",
        "release__uat",
      ]);
      assert.strictEqual(views.release__uat.current?.tag, "v1.6.0-rc.1");
      assert.strictEqual(
        findNextVersionFrom(views.main, "release__uat")?.tag,
        "v1.6.0",
      );
      assert.strictEqual(findNextVersionFrom(views.main, "integration"), null);
    });

    test("a disabled list gives no view", () => {
      const list = parseReleaseVersionList({ ...CLI_RESULT, enabled: false });
      assert.deepStrictEqual(buildReleaseVersionViews(list, ["main"]), {});
    });

    test("a tag in the tag format of its branch is shown as the CLI names it", () => {
      const custom = entry("v1.6.0-pi2-it4-uat-rc1", "release/uat", {
        version: "1.6.0-rc.1",
        prerelease: true,
        variables: { PI: "2", IT: 4, bad: { x: 1 } },
      });
      const list = parseReleaseVersionList({
        ...CLI_RESULT,
        branches: [
          { ...CLI_RESULT.branches[0], current: custom },
          CLI_RESULT.branches[1],
        ],
        history: [custom, entry("v1.5.0", "main")],
      })!;
      const current = list.branches[0].current!;
      assert.strictEqual(current.tag, "v1.6.0-pi2-it4-uat-rc1");
      assert.strictEqual(current.version, "1.6.0-rc.1");
      assert.strictEqual(current.prerelease, true);
      assert.deepStrictEqual(current.variables, { PI: "2", IT: "4" });
      // An older CLI sends no variables
      assert.deepStrictEqual(list.history[1].variables, {});
      assert.strictEqual(
        buildReleaseVersionLinks(current.tag, true, {
          providerName: "gitlab",
          webUrl: "https://gitlab.com/acme/crm",
        }).tagUrl,
        "https://gitlab.com/acme/crm/-/tags/v1.6.0-pi2-it4-uat-rc1",
      );
    });
  });

  suite("links built from the repository URL", () => {
    test("each provider gets its tag link, Releases only for plain versions on GitHub and GitLab", () => {
      const github = {
        providerName: "github",
        webUrl: "https://github.com/acme/crm",
      };
      assert.deepStrictEqual(
        buildReleaseVersionLinks("v1.5.0", false, github),
        {
          tagUrl: "https://github.com/acme/crm/tree/v1.5.0",
          releaseUrl: "https://github.com/acme/crm/releases/tag/v1.5.0",
        },
      );
      assert.strictEqual(
        buildReleaseVersionLinks("v1.5.0-rc.1", true, github).releaseUrl,
        null,
      );
      const gitlab = {
        providerName: "gitlab",
        webUrl: "https://gitlab.com/acme/crm/",
      };
      assert.deepStrictEqual(
        buildReleaseVersionLinks("v1.5.0", false, gitlab),
        {
          tagUrl: "https://gitlab.com/acme/crm/-/tags/v1.5.0",
          releaseUrl: "https://gitlab.com/acme/crm/-/releases/v1.5.0",
        },
      );
      assert.deepStrictEqual(
        buildReleaseVersionLinks("v1.5.0", false, {
          providerName: "azure",
          webUrl: "https://dev.azure.com/acme/crm/_git/crm",
        }),
        {
          tagUrl: "https://dev.azure.com/acme/crm/_git/crm?version=GTv1.5.0",
          releaseUrl: null,
        },
      );
      assert.deepStrictEqual(
        buildReleaseVersionLinks("v1.5.0", false, {
          providerName: "bitbucket",
          webUrl: "https://bitbucket.org/acme/crm",
        }),
        {
          tagUrl: "https://bitbucket.org/acme/crm/src/v1.5.0",
          releaseUrl: null,
        },
      );
    });

    test("an unsafe tag or an unknown repository gives no link", () => {
      const github = {
        providerName: "github",
        webUrl: "https://github.com/acme/crm",
      };
      assert.deepStrictEqual(
        buildReleaseVersionLinks("v1 && x", false, github),
        {
          tagUrl: null,
          releaseUrl: null,
        },
      );
      assert.deepStrictEqual(
        buildReleaseVersionLinks("v1.5.0", false, {
          providerName: "github",
          webUrl: "",
        }),
        { tagUrl: null, releaseUrl: null },
      );
    });

    test("the list is completed in a copy, links given by the CLI are kept", () => {
      const list = parseReleaseVersionList({
        ...CLI_RESULT,
        history: [
          entry("v1.5.0", "main", { tagUrl: "https://example.com/own-link" }),
        ],
      })!;
      const completed = withReleaseVersionLinks(list, {
        providerName: "github",
        webUrl: "https://github.com/acme/crm",
      })!;
      assert.strictEqual(
        completed.history[0].tagUrl,
        "https://example.com/own-link",
      );
      assert.strictEqual(
        completed.history[0].releaseUrl,
        "https://github.com/acme/crm/releases/tag/v1.5.0",
      );
      assert.strictEqual(
        completed.branches[0].current?.tagUrl,
        "https://github.com/acme/crm/tree/v1.6.0-rc.1",
      );
      // The cached answer is not changed
      assert.strictEqual(list.branches[0].current?.tagUrl, null);
      assert.strictEqual(withReleaseVersionLinks(list, null), list);
    });
  });

  suite("when the CLI is run", () => {
    let runs = 0;
    const deps = (
      declared: boolean,
      answer: () => Promise<any>,
    ): ReleaseVersionDeps => ({
      workspaceRoot: "/workspace",
      isDeclared: async () => declared,
      runVersionList: async () => {
        runs++;
        return await answer();
      },
    });

    setup(() => {
      runs = 0;
      invalidateReleaseVersionsCache();
    });

    teardown(() => {
      invalidateReleaseVersionsCache();
    });

    test("never when no branch declares the feature", async () => {
      const result = await loadReleaseVersions(
        {},
        deps(false, async () => CLI_RESULT),
      );
      assert.strictEqual(result, null);
      assert.strictEqual(runs, 0);
    });

    test("once per session: reloads reuse the answer, a forced load asks again", async () => {
      const d = deps(true, async () => CLI_RESULT);
      const first = await loadReleaseVersions({}, d);
      const second = await loadReleaseVersions({}, d);
      assert.strictEqual(runs, 1);
      assert.strictEqual(first, second);
      assert.strictEqual(getCachedReleaseVersions("/workspace"), first);
      assert.strictEqual(getCachedReleaseVersions("/other"), null);
      await loadReleaseVersions({ force: true }, d);
      assert.strictEqual(runs, 2);
    });

    test("two loads at the same time share one CLI process", async () => {
      const d = deps(true, async () => CLI_RESULT);
      const [a, b] = await Promise.all([
        loadReleaseVersions({}, d),
        loadReleaseVersions({}, d),
      ]);
      assert.strictEqual(runs, 1);
      assert.strictEqual(a, b);
    });

    test("a failure (old CLI, error) shows nothing and is not retried at each reload", async () => {
      const failing = deps(true, async () => {
        throw new Error("hardis:project:version:list is not a sf command");
      });
      assert.strictEqual(await loadReleaseVersions({}, failing), null);
      assert.strictEqual(await loadReleaseVersions({}, failing), null);
      assert.strictEqual(runs, 1);
      const nullAnswer = deps(true, async () => null);
      assert.strictEqual(
        await loadReleaseVersions({ force: true }, nullAnswer),
        null,
      );
      assert.strictEqual(runs, 2);
    });
  });

  suite("diagram", () => {
    const branches = [
      { branchName: "integration", level: 50, mergeTargets: ["release__uat"] },
      { branchName: "release__uat", level: 70, mergeTargets: ["main"] },
      { branchName: "main", level: 100, mergeTargets: [] },
    ].map((branch) => ({
      ...branch,
      orgType: branch.branchName === "main" ? "prod" : "other",
      instanceUrl: "",
      jobs: [],
      jobsStatus: "unknown",
    }));

    function diagram(withVersions: boolean): string {
      const views = withVersions
        ? buildReleaseVersionViews(parseReleaseVersionList(CLI_RESULT), [
            "integration",
            "release__uat",
            "main",
          ])
        : {};
      return new BranchStrategyMermaidBuilder(
        branches,
        false,
        [],
        null,
        "light",
        3,
        undefined,
        {},
        [],
        views,
      ).build({ format: "string", withMermaidTag: false }) as string;
    }

    test("versioned branches and their orgs show their version, promotions the next one", () => {
      const text = diagram(true);
      const line = (start: string) =>
        text.split("\n").find((l) => l.trim().startsWith(start)) || "";
      // Release candidate outlined, plain version filled
      assert.match(
        line("release_uatBranch("),
        /hardis-version-rc'[^>]*>v1\.6\.0-rc\.1</,
      );
      assert.match(
        line("mainBranch("),
        /hardis-version-released'[^>]*>v1\.5\.0</,
      );
      // The org of a versioned branch shows the installed version
      assert.match(line("release_uatOrg("), /hardis-version-installed/);
      // Nothing on the non-versioned branch and its org
      assert.doesNotMatch(line("integrationBranch("), /hardis-version/);
      assert.doesNotMatch(line("integrationOrg("), /hardis-version/);
      // The next version on the promotion edges (the unit host loads no translation: t() answers
      // the key, so the chip text is not checked here)
      assert.match(line("integrationBranch ==>"), /hardis-version-next'/);
      assert.match(line("release_uatBranch ==>"), /hardis-version-next'/);
      // A chip tooltip never holds a character mermaid would break on
      for (const title of text.match(/title='[^']*'/g) || []) {
        assert.doesNotMatch(title, /&#|"/, title);
      }
    });

    test("without versions, the diagram is unchanged", () => {
      assert.doesNotMatch(diagram(false), /hardis-version/);
    });
  });
});
