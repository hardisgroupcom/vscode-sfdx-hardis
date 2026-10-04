import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { activateExtension, waitFor } from "./uiTestUtils";
import { GitProvider } from "../../utils/gitProviders/gitProvider";
import { TicketProvider } from "../../utils/ticketProviders/ticketProvider";

/**
 * UI integration tests of the Pull Request view and of the Pull Requests explorer of the DevOps
 * Pipeline (sfdx-hardis#2273), against the git and ticketing provider fixtures of the
 * documentation screenshots.
 *
 * The webview DOM is not reachable from the extension host: the tests drive the extension side
 * of the panel the way the LWC does, and read what it answers.
 */

const LWC_ID = "s-pipeline";
const FIXTURES = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "test",
  "fixtures",
  "screenshot",
);

/** Records the messages the extension sends to the webview of a panel. */
function recordSentMessages(panel: any): any[] {
  const sent: any[] = [];
  const original = panel.sendMessage.bind(panel);
  panel.sendMessage = (message: any) => {
    sent.push(message);
    original(message);
  };
  return sent;
}

suite("Pull Request view UI tests", function () {
  let panelManager: any;
  let panel: any;
  let sent: any[] = [];
  const envBefore = {
    git: process.env.SFDX_HARDIS_MOCK_GIT_PROVIDER_FILE,
    ticket: process.env.SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE,
  };

  async function resetProviders(): Promise<void> {
    await GitProvider.getInstance(true);
    await TicketProvider.getInstance({ reset: true, authenticate: false });
  }

  async function openPipeline(deepLink?: any): Promise<any> {
    await vscode.commands.executeCommand(
      "vscode-sfdx-hardis.showPipeline",
      deepLink,
    );
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      10000,
      "pipeline panel to open",
    );
    sent = recordSentMessages(panel);
    return waitFor(
      () => {
        const data = panel.getInitializationData();
        return data && data.prLoading === false && data.pipelineData
          ? data
          : null;
      },
      60000,
      "the pipeline to be loaded with its Pull Requests",
    );
  }

  /** Sends a message the way the LWC does, and waits for the answer of the given type */
  async function ask(message: any, answerType: string): Promise<any> {
    const from = sent.length;
    panel.simulateWebviewMessage(message);
    const answer = await waitFor(
      () => sent.slice(from).find((entry) => entry.type === answerType),
      30000,
      `${answerType} to be sent`,
    );
    return answer.data;
  }

  suiteSetup(async function () {
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
    process.env.SFDX_HARDIS_MOCK_GIT_PROVIDER_FILE = path.join(
      FIXTURES,
      "git-provider-mock.json",
    );
    process.env.SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE = path.join(
      FIXTURES,
      "ticket-provider-mock.json",
    );
    await resetProviders();
    panelManager.disposePanel(LWC_ID);
  });

  suiteTeardown(async function () {
    panelManager?.disposePanel(LWC_ID);
    for (const [key, value] of [
      ["SFDX_HARDIS_MOCK_GIT_PROVIDER_FILE", envBefore.git],
      ["SFDX_HARDIS_MOCK_TICKET_PROVIDER_FILE", envBefore.ticket],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await resetProviders();
  });

  // The Pull Requests of a branch window, completed the way the pipeline load completes them
  let windowTickets: any[] = [];

  test("a branch window is completed with the ids of its tickets, not their details", async function () {
    await openPipeline();
    const gitProvider = await GitProvider.getInstance();
    assert.ok(gitProvider, "the mocked git provider is active");
    const pullRequests =
      await gitProvider!.listPullRequestsInBranchSinceLastMerge(
        "integration",
        "uat",
        [],
      );
    assert.ok(pullRequests.length > 0, "the fixture has merged Pull Requests");
    await gitProvider!.completePullRequestsWithTickets(pullRequests, {
      fetchDetails: false,
    });
    windowTickets = pullRequests.flatMap((pr: any) => pr.relatedTickets || []);
    assert.ok(windowTickets.length > 0, "tickets are found from their text");
    assert.ok(
      windowTickets.every((ticket: any) => !ticket.subject),
      "no ticket is read from the ticketing tool to draw the diagram",
    );
  });

  test("a window asks for the details of its tickets, and gets them", async function () {
    const answer = await ask(
      {
        type: "loadTicketDetails",
        data: { requestId: 5, tickets: windowTickets },
      },
      "returnTicketDetails",
    );
    assert.strictEqual(answer.requestId, 5);
    assert.strictEqual(answer.tickets.length, windowTickets.length);
    assert.ok(
      answer.tickets.some((ticket: any) => !!ticket.subject),
      "the subjects come back",
    );
  });

  test("a Pull Request is read by its number, with its tickets and the id of the request", async function () {
    const answer = await ask(
      { type: "getPrInfoForModal", data: { prNumber: 128, requestId: 7 } },
      "returnGetPrInfoForModal",
    );
    assert.strictEqual(answer.number, 128);
    assert.strictEqual(answer.requestId, 7);
    assert.ok(answer.checkout, "the checked out branch is described");
    assert.ok(
      (answer.relatedTickets || []).some((ticket: any) => !!ticket.subject),
      "the tickets of one Pull Request come with their details",
    );
  });

  test("a number that does not exist is answered as not found, never left without answer", async function () {
    const answer = await ask(
      { type: "getPrInfoForModal", data: { prNumber: 987654, requestId: 8 } },
      "returnGetPrInfoForModal",
    );
    assert.deepStrictEqual(answer, { notFound: true, requestId: 8 });
  });

  test("the lookup searches the git provider and gets its request id back", async function () {
    const answer = await ask(
      {
        type: "searchPullRequests",
        data: { query: "hierarchy", requestId: 3 },
      },
      "returnSearchPullRequests",
    );
    assert.strictEqual(answer.requestId, 3);
    assert.strictEqual(answer.supported, true);
    assert.ok(
      answer.pullRequests.some((pr: any) => pr.number === 128),
      "the Pull Request whose title holds the word is found",
    );
    // Under 3 characters nothing is asked to the provider
    const short = await ask(
      { type: "searchPullRequests", data: { query: "hi", requestId: 4 } },
      "returnSearchPullRequests",
    );
    assert.deepStrictEqual(short.pullRequests, []);
  });

  test("a Pull Request link of a panel opens the view of the panel already loaded, without reloading it", async function () {
    const webUrl = (await GitProvider.getInstance())?.repoInfo?.webUrl;
    assert.ok(webUrl, "the fixture names its repository");
    const initBefore = panel.getInitializationData();
    const answer = await ask(
      { type: "openPullRequest", data: { url: `${webUrl}/pull/124` } },
      "openPullRequestView",
    );
    assert.deepStrictEqual(answer, { prNumber: 124 });
    assert.strictEqual(
      panel.getInitializationData(),
      initBefore,
      "the pipeline was not loaded again",
    );
  });

  test("a deep link only carries what the panel is allowed to receive", async function () {
    const explorer = await openPipeline({ focus: "explorer", extra: "x" });
    assert.ok(explorer.pipelineData);
    const from = sent.length;
    void from;
    panelManager.disposePanel(LWC_ID);
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline", {
      focus: "pullRequest",
      prNumber: 128,
      tab: "not-a-tab",
      command: "rm -rf",
    });
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      10000,
      "pipeline panel to open",
    );
    const first = await waitFor(
      () => panel.getInitializationData(),
      10000,
      "the first payload of the panel",
    );
    assert.deepStrictEqual(first.deepLink, {
      focus: "pullRequest",
      prNumber: 128,
    });
  });
});
