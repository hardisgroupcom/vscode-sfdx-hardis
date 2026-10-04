import * as assert from "assert";
import { GitProvider } from "../../utils/gitProviders/gitProvider";
import { GitProviderGitHub } from "../../utils/gitProviders/gitProviderGitHub";
import { GitProviderGitea } from "../../utils/gitProviders/gitProviderGitea";
import { GitProviderGitlab } from "../../utils/gitProviders/gitProviderGitlab";
import { GitProviderBitbucket } from "../../utils/gitProviders/gitProviderBitbucket";
import { GitProviderMock } from "../../utils/gitProviders/gitProviderMock";
import { newAzureProviderStub } from "./azureProviderStub";

// The Pull Requests explorer of the DevOps Pipeline asks the git provider for the Pull Requests
// matching a text. These tests pin what every provider owes it: open and merged Pull Requests
// only, no jobs, never more than the limit, the typed text never able to rewrite the request, and
// an API error answered with an empty result instead of an exception.
suite("Pull Request search", () => {
  const assertLight = (pullRequests: any[]) => {
    for (const pullRequest of pullRequests) {
      assert.deepStrictEqual(pullRequest.jobs, []);
      assert.strictEqual(pullRequest.jobsStatus, "unknown");
      assert.strictEqual(pullRequest.relatedTickets, undefined);
      assert.strictEqual(pullRequest.deploymentActions, undefined);
    }
  };

  suite("Base class", () => {
    test("a provider without a search answers null", async () => {
      const provider: any = Object.create(GitProvider.prototype);
      provider.repoInfo = null;
      assert.strictEqual(await provider.searchPullRequests("login"), null);
    });
  });

  suite("GitHub", () => {
    const buildProvider = (
      graphql: (document: string, variables: any) => Promise<any>,
      providerName = "github",
    ) => {
      const provider: any = Object.create(GitProviderGitHub.prototype);
      provider.repoInfo = { owner: "acme", repo: "repo", providerName };
      provider.gitHubClient = { graphql };
      provider.logApiCall = async () => {};
      return provider;
    };

    const node = (number: number, overrides: any = {}) => ({
      number,
      title: `Story ${number}`,
      state: "OPEN",
      merged: false,
      mergedAt: null,
      createdAt: "2026-09-01T10:00:00Z",
      updatedAt: "2026-09-02T10:00:00Z",
      url: `https://github.com/acme/repo/pull/${number}`,
      body: "Some description",
      headRefName: `features/story-${number}`,
      baseRefName: "integration",
      author: { login: "romain" },
      ...overrides,
    });

    test("drops the closed Pull Requests that were not merged and maps the branches", async () => {
      const provider = buildProvider(async () => ({
        search: {
          nodes: [
            node(1),
            node(2, { state: "CLOSED" }),
            node(3, {
              state: "MERGED",
              merged: true,
              mergedAt: "2026-09-03T10:00:00Z",
            }),
            // What the search returns for a result that is not a Pull Request
            {},
          ],
        },
      }));

      const result = await provider.searchPullRequests("story");

      assert.strictEqual(result.truncated, false);
      assert.deepStrictEqual(
        result.pullRequests.map((pullRequest: any) => pullRequest.number),
        [1, 3],
      );
      const [open, merged] = result.pullRequests;
      assert.strictEqual(open.state, "open");
      assert.strictEqual(open.sourceBranch, "features/story-1");
      assert.strictEqual(open.targetBranch, "integration");
      assert.strictEqual(open.authorLabel, "romain");
      assert.strictEqual(open.webUrl, "https://github.com/acme/repo/pull/1");
      assert.strictEqual(open.mergeDate, undefined);
      assert.strictEqual(merged.state, "merged");
      assert.strictEqual(merged.mergeDate, "2026-09-03T10:00:00Z");
      assertLight(result.pullRequests);
    });

    test("sends the typed text as a variable, each word quoted and escaped", async () => {
      const calls: { document: string; variables: any }[] = [];
      const provider = buildProvider(async (document, variables) => {
        calls.push({ document, variables });
        return { search: { nodes: [] } };
      });

      await provider.searchPullRequests('repo:other/repo say "hi" back\\slash');

      assert.strictEqual(calls.length, 1, "one request for the whole search");
      assert.ok(
        !calls[0].document.includes("other/repo"),
        "the typed text must not be written into the GraphQL document",
      );
      assert.strictEqual(
        calls[0].variables.q,
        'repo:acme/repo is:pr "repo:other/repo" "say" "\\"hi\\"" "back\\\\slash" in:title,body',
      );
    });

    test("never returns more than the limit, 20 by default", async () => {
      const provider = buildProvider(async () => ({
        search: {
          nodes: Array.from({ length: 60 }, (_, i) => node(i + 1)),
        },
      }));
      assert.strictEqual(
        (await provider.searchPullRequests("story")).pullRequests.length,
        20,
      );
      assert.strictEqual(
        (await provider.searchPullRequests("story", { limit: 5 })).pullRequests
          .length,
        5,
      );
    });

    test("an API error is an empty result, not an exception", async () => {
      const provider = buildProvider(async () => {
        throw new Error("Bad credentials");
      });
      assert.deepStrictEqual(await provider.searchPullRequests("story"), {
        pullRequests: [],
        truncated: false,
      });
    });

    test("does not send a GraphQL query to a provider that is not GitHub", async () => {
      let called = false;
      const provider = buildProvider(async () => {
        called = true;
        return {};
      }, "gitea");
      assert.strictEqual(await provider.searchPullRequests("story"), null);
      assert.strictEqual(called, false);
    });
  });

  suite("Gitea", () => {
    test("searches the issues of type pulls, then reads the kept ones for their branches", async () => {
      const requests: { route: string; params: any }[] = [];
      const read: number[] = [];
      const provider: any = Object.create(GitProviderGitea.prototype);
      provider.repoInfo = {
        owner: "acme",
        repo: "repo",
        providerName: "gitea",
      };
      provider.logApiCall = async () => {};
      provider.gitHubClient = {
        request: async (route: string, params: any) => {
          requests.push({ route, params });
          return {
            data: [
              { number: 1, state: "open", pull_request: { merged: false } },
              { number: 2, state: "closed", pull_request: { merged: false } },
              { number: 3, state: "closed", pull_request: { merged: true } },
            ],
          };
        },
      };
      provider.getPullRequestByNumber = async (number: number) => {
        read.push(number);
        return {
          id: number,
          number,
          title: `Story ${number}`,
          state: number === 3 ? "merged" : "open",
          authorLabel: "romain",
          sourceBranch: `features/story-${number}`,
          targetBranch: "integration",
          jobsStatus: "unknown",
        };
      };

      const result = await provider.searchPullRequests("story");

      assert.strictEqual(requests[0].route, "GET /repos/{owner}/{repo}/issues");
      assert.strictEqual(requests[0].params.type, "pulls");
      assert.strictEqual(requests[0].params.state, "all");
      assert.strictEqual(requests[0].params.q, "story");
      assert.deepStrictEqual(read, [1, 3], "the closed one is not read again");
      assert.strictEqual(
        result.pullRequests[1].sourceBranch,
        "features/story-3",
      );
      assertLight(result.pullRequests);
    });
  });

  suite("GitLab", () => {
    const buildProvider = (all: (params: any) => Promise<any[]>) => {
      const provider: any = Object.create(GitProviderGitlab.prototype);
      provider.gitlabProjectId = 42;
      provider.gitlabClient = { MergeRequests: { all } };
      provider.logApiCall = async () => {};
      return provider;
    };

    const mergeRequest = (iid: number, state: string) => ({
      id: 1000 + iid,
      iid,
      title: `Story ${iid}`,
      description: "Some description",
      state,
      web_url: `https://gitlab.com/acme/repo/-/merge_requests/${iid}`,
      author: { username: "mariia" },
      source_branch: `features/story-${iid}`,
      target_branch: "integration",
      merged_at: state === "merged" ? "2026-09-03T10:00:00Z" : null,
    });

    test("searches the title and the description, without a state, and keeps opened and merged", async () => {
      const calls: any[] = [];
      const provider = buildProvider(async (params) => {
        calls.push(params);
        return [
          mergeRequest(1, "opened"),
          mergeRequest(2, "closed"),
          mergeRequest(3, "merged"),
          mergeRequest(4, "locked"),
        ];
      });

      const result = await provider.searchPullRequests("story");

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].search, "story");
      assert.strictEqual(calls[0].in, "title,description");
      assert.strictEqual(calls[0].state, undefined);
      assert.strictEqual(calls[0].maxPages, 1, "gitbeaker must not walk pages");
      assert.deepStrictEqual(
        result.pullRequests.map((pullRequest: any) => [
          pullRequest.number,
          pullRequest.state,
        ]),
        [
          [1, "open"],
          [3, "merged"],
        ],
      );
      assert.strictEqual(
        result.pullRequests[0].sourceBranch,
        "features/story-1",
      );
      assert.strictEqual(result.pullRequests[0].targetBranch, "integration");
      assert.strictEqual(result.pullRequests[0].authorLabel, "mariia");
      assert.strictEqual(
        result.pullRequests[1].mergeDate,
        "2026-09-03T10:00:00Z",
      );
      assertLight(result.pullRequests);
    });

    test("an API error is an empty result, not an exception", async () => {
      const provider = buildProvider(async () => {
        throw new Error("500");
      });
      assert.deepStrictEqual(await provider.searchPullRequests("story"), {
        pullRequests: [],
        truncated: false,
      });
    });
  });

  suite("Bitbucket", () => {
    const buildProvider = (list: (params: any) => Promise<any>) => {
      const provider: any = Object.create(GitProviderBitbucket.prototype);
      provider.workspace = "acme";
      provider.repoSlug = "repo";
      provider.bitbucketClient = { pullrequests: { list } };
      provider.logApiCall = async () => {};
      return provider;
    };

    test("builds a filter on title, description and state", async () => {
      const calls: any[] = [];
      const provider = buildProvider(async (params) => {
        calls.push(params);
        return {
          data: {
            values: [
              {
                id: 7,
                title: "Story 7",
                description: "Some description",
                state: "MERGED",
                author: { display_name: "Victor" },
                links: {
                  html: {
                    href: "https://bitbucket.org/acme/repo/pull-requests/7",
                  },
                },
                source: { branch: { name: "features/story-7" } },
                destination: { branch: { name: "integration" } },
                updated_on: "2026-09-03T10:00:00Z",
              },
            ],
          },
        };
      });

      const result = await provider.searchPullRequests("story", { limit: 5 });

      assert.strictEqual(
        calls[0].q,
        '(title ~ "story" OR description ~ "story") AND (state = "OPEN" OR state = "MERGED")',
      );
      assert.strictEqual(calls[0].pagelen, 5);
      assert.strictEqual(result.pullRequests[0].state, "merged");
      assert.strictEqual(
        result.pullRequests[0].sourceBranch,
        "features/story-7",
      );
      assert.strictEqual(result.pullRequests[0].targetBranch, "integration");
      assert.strictEqual(
        result.pullRequests[0].mergeDate,
        "2026-09-03T10:00:00Z",
      );
      assertLight(result.pullRequests);
    });

    test("escapes the double quotes and the backslashes of the typed text", async () => {
      const calls: any[] = [];
      const provider = buildProvider(async (params) => {
        calls.push(params);
        return { data: { values: [] } };
      });

      await provider.searchPullRequests('x" OR state = "DECLINED\\');

      const escaped = 'x\\" OR state = \\"DECLINED\\\\';
      assert.strictEqual(
        calls[0].q,
        `(title ~ "${escaped}" OR description ~ "${escaped}") AND (state = "OPEN" OR state = "MERGED")`,
      );
    });

    test("an API error is an empty result, not an exception", async () => {
      const provider = buildProvider(async () => {
        throw new Error("401");
      });
      assert.deepStrictEqual(await provider.searchPullRequests("story"), {
        pullRequests: [],
        truncated: false,
      });
    });
  });

  suite("Azure DevOps", () => {
    const ACTIVE = 1;
    const ABANDONED = 2;
    const COMPLETED = 3;

    const buildProvider = (
      pagesByCall: (skip: number, top: number) => any[],
      calls: { criteria: any; skip: number; top: number }[] = [],
    ) => {
      const provider = newAzureProviderStub();
      provider.gitApi = {
        getPullRequests: async (
          _repo: string,
          criteria: any,
          _project: string,
          _maxCommentLength: any,
          skip: number,
          top: number,
        ) => {
          calls.push({ criteria, skip, top });
          const page = pagesByCall(skip, top);
          if (page instanceof Error) {
            throw page;
          }
          return page;
        },
      };
      return provider;
    };

    const pullRequest = (id: number, overrides: any = {}) => ({
      pullRequestId: id,
      title: `PR ${id}`,
      description: "",
      sourceRefName: `refs/heads/features/branch-${id}`,
      targetRefName: "refs/heads/integration",
      status: ACTIVE,
      createdBy: { displayName: "Victor" },
      ...overrides,
    });

    test("filters in the extension on title, description and source branch, without the abandoned", async () => {
      const calls: any[] = [];
      const provider = buildProvider(
        () => [
          pullRequest(1, { title: "Add the LOGIN page" }),
          pullRequest(2, { description: "Fixes the login flow" }),
          pullRequest(3, {
            sourceRefName: "refs/heads/features/login-rework",
            status: COMPLETED,
            closedDate: new Date("2026-09-03T10:00:00Z"),
          }),
          pullRequest(4, { title: "Login, abandoned", status: ABANDONED }),
          pullRequest(5, { title: "Unrelated" }),
        ],
        calls,
      );

      const result = await provider.searchPullRequests("login");

      assert.strictEqual(calls.length, 1, "a short page ends the walk");
      assert.strictEqual(calls[0].criteria.status, 4, "status All");
      assert.strictEqual(calls[0].top, 100);
      assert.strictEqual(result.truncated, false);
      assert.deepStrictEqual(
        result.pullRequests.map((pr: any) => [pr.number, pr.state]),
        [
          [1, "open"],
          [2, "open"],
          [3, "merged"],
        ],
      );
      assert.strictEqual(
        result.pullRequests[2].sourceBranch,
        "features/login-rework",
      );
      assert.strictEqual(result.pullRequests[2].targetBranch, "integration");
      assert.strictEqual(
        result.pullRequests[2].mergeDate,
        "2026-09-03T10:00:00.000Z",
      );
      assert.strictEqual(result.pullRequests[0].authorLabel, "Victor");
      assert.strictEqual(
        result.pullRequests[0].webUrl,
        "https://dev.azure.com/acme/Project/_git/repo/pullrequest/1",
      );
      assertLight(result.pullRequests);
    });

    test("stops after 3 pages of 100 and says the search was partial", async () => {
      const calls: any[] = [];
      // Every page is full: the repository has more Pull Requests than the search reads
      const provider = buildProvider(
        (skip, top) =>
          Array.from({ length: top }, (_, i) => pullRequest(skip + i + 1)),
        calls,
      );

      const result = await provider.searchPullRequests("branch-30", {
        limit: 500,
      });

      assert.deepStrictEqual(
        calls.map((call) => call.skip),
        [0, 100, 200],
      );
      assert.strictEqual(result.truncated, true);
      // The last Pull Request read is the 300th: nothing past the third page is searched
      assert.deepStrictEqual(
        result.pullRequests.map((pr: any) => pr.number),
        [30, 300],
      );
    });

    test("does not page again for the next keystrokes", async () => {
      const calls: any[] = [];
      const provider = buildProvider(
        () => [pullRequest(1, { title: "Login" }), pullRequest(2)],
        calls,
      );

      const first = await provider.searchPullRequests("log");
      const second = await provider.searchPullRequests("login");
      const other = await provider.searchPullRequests("PR 2");

      assert.strictEqual(calls.length, 1, "one listing for three searches");
      assert.strictEqual(first.pullRequests.length, 1);
      assert.strictEqual(second.pullRequests.length, 1);
      assert.strictEqual(other.pullRequests[0].number, 2);
    });

    test("pages again once the kept list is older than a minute", async () => {
      const calls: any[] = [];
      const provider = buildProvider(() => [pullRequest(1)], calls);

      await provider.searchPullRequests("PR");
      provider.searchListCache.fetchedAt = Date.now() - 61 * 1000;
      await provider.searchPullRequests("PR");

      assert.strictEqual(calls.length, 2);
    });

    test("an API error is an empty result, and is not kept", async () => {
      const calls: any[] = [];
      let failing = true;
      const provider = buildProvider(
        () => (failing ? (new Error("TF400733") as any) : [pullRequest(1)]),
        calls,
      );

      assert.deepStrictEqual(await provider.searchPullRequests("PR"), {
        pullRequests: [],
        truncated: false,
      });
      failing = false;
      const result = await provider.searchPullRequests("PR");

      assert.strictEqual(calls.length, 2, "the failed listing was not cached");
      assert.strictEqual(result.pullRequests.length, 1);
    });
  });

  suite("Mock", () => {
    test("filters the fixture Pull Requests on title, description and branch", async () => {
      const provider: any = Object.create(GitProviderMock.prototype);
      const fixturePullRequest = (number: number, overrides: any = {}) => ({
        id: number,
        number,
        title: `Story ${number}`,
        state: "open",
        authorLabel: "romain",
        sourceBranch: `features/story-${number}`,
        targetBranch: "integration",
        jobs: [{ name: "check", status: "success" }],
        jobsStatus: "success",
        ...overrides,
      });
      provider.fixture = {
        openPullRequests: [
          fixturePullRequest(1, { title: "Login page" }),
          fixturePullRequest(2, { state: "declined", title: "Login, dropped" }),
          fixturePullRequest(3),
        ],
        mergedPullRequestsByBranch: {
          integration: [
            fixturePullRequest(4, {
              state: "merged",
              sourceBranch: "features/login-rework",
            }),
          ],
        },
        mergedPullRequestsIntoBranch: {
          // The same Pull Request listed twice must come back once
          integration: [
            fixturePullRequest(4, {
              state: "merged",
              sourceBranch: "features/login-rework",
            }),
          ],
        },
      };

      const result = await provider.searchPullRequests("LOGIN");

      assert.deepStrictEqual(
        result.pullRequests.map((pullRequest: any) => pullRequest.number),
        [1, 4],
      );
      assertLight(result.pullRequests);
    });
  });
});
