import * as vscode from "vscode";
import { PipelineDataProvider } from "../pipeline-data-provider";
import { Logger } from "../logger";
import { GitProvider } from "../utils/gitProviders/gitProvider";
import { LwcPanelManager } from "../lwc-panel-manager";
import { LwcUiPanel } from "../webviews/lwc-ui-panel";
import { Commands } from "../commands";
import { showPackageXmlPanel } from "./packageXml";
import { PullRequest } from "../utils/gitProviders/types";
import { TicketProvider } from "../utils/ticketProviders/ticketProvider";
import { Ticket } from "../utils/ticketProviders/types";
import { mapWithConcurrencySettled } from "../utils/concurrency";
import {
  deletePrePostCommand,
  listProjectApexScripts,
  listProjectDataWorkspaces,
  listProjectApexTestClasses,
  saveDeploymentApexTestClasses,
  savePrePostCommand,
} from "../utils/prePostCommandsUtils";
import { getCurrentGitBranch } from "../utils/pipeline/sfdxHardisConfig";
import { handleDeploymentActionPickerMessage } from "../utils/pipeline/deploymentActionPickers";
import {
  getCachedCustomFunctions,
  refreshCustomFunctionsCache,
} from "../utils/customFunctionsUtils";
import {
  execCommandWithProgress,
  execSfdxJson,
  getWorkspaceRoot,
} from "../utils";
import { collectProviderCredentialEnvVars } from "../utils/providerCredentials";
import { t } from "../i18n/i18n";
import path from "path";
import * as fs from "fs";
import simpleGit from "simple-git";
import { listAllOrgs } from "../utils/orgUtils";
import { getChildBranchNames } from "../utils/orgConfigUtils";
import { readSfdxHardisConfig } from "../utils/sfdx-hardis-config-utils";
import {
  isMergedPullRequest,
  isPromotionPullRequest,
  parsePromotionPullRequestIds,
  PromotionBranchConfig,
} from "../utils/pipeline/promotionBranchUtils";

const GIT_PULL_REFUSAL_COOLDOWN_MS = 60 * 60 * 1000;
const promptedRemoteUpdatesByBranch = new Map<string, string>();
const declinedRemotePullPromptUntilByBranch = new Map<string, number>();
const notifiedAutoFixBranchHeadByPullRequest = new Map<string, string>();
async function getOriginBranchUpdateStatus(branchName: string): Promise<{
  remoteHeadSha: string | null;
  hasNewRemoteCommit: boolean;
}> {
  const git = simpleGit(getWorkspaceRoot());
  try {
    await git.raw(["fetch", "origin", branchName]);
    const remoteHeadSha = (await git.revparse([`origin/${branchName}`])).trim();
    const revListOutput = await git.raw([
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...origin/${branchName}`,
    ]);
    const counts = revListOutput.trim().split(/\s+/);
    const behindCount = Number.parseInt(counts[1] || "0", 10);
    return {
      remoteHeadSha,
      hasNewRemoteCommit: Number.isFinite(behindCount) && behindCount > 0,
    };
  } catch (error: any) {
    Logger.log(
      `Unable to check origin/${branchName} update status: ${error?.message || error}`,
    );
    return {
      remoteHeadSha: null,
      hasNewRemoteCommit: false,
    };
  }
}

async function remoteBranchExists(branchName: string): Promise<boolean> {
  const git = simpleGit(getWorkspaceRoot());
  try {
    const result = await git.raw([
      "ls-remote",
      "--heads",
      "origin",
      branchName,
    ]);
    return result.trim().length > 0;
  } catch (error: any) {
    Logger.log(
      `Unable to check remote branch origin/${branchName}: ${error?.message || error}`,
    );
    return false;
  }
}

async function getOriginBranchHeadSha(
  branchName: string,
): Promise<string | null> {
  const git = simpleGit(getWorkspaceRoot());
  try {
    await git.raw(["fetch", "origin", branchName]);
    return (await git.revparse([`origin/${branchName}`])).trim();
  } catch (error: any) {
    Logger.log(
      `Unable to resolve origin/${branchName} head SHA: ${error?.message || error}`,
    );
    return null;
  }
}

function getPullRequestSessionKey(pullRequest: PullRequest): string {
  return String(
    pullRequest.id ||
      pullRequest.number ||
      pullRequest.webUrl ||
      pullRequest.sourceBranch ||
      "unknown-autofix-pr",
  );
}

async function maybeNotifyAutoFixPullRequest(
  autoFixPullRequest: PullRequest,
  autoFixBranchName: string,
  pullRequestLabel: string,
): Promise<void> {
  const autoFixBranchHeadSha = await getOriginBranchHeadSha(autoFixBranchName);
  if (!autoFixBranchHeadSha) {
    return;
  }

  const pullRequestSessionKey = getPullRequestSessionKey(autoFixPullRequest);
  const previousNotifiedSha = notifiedAutoFixBranchHeadByPullRequest.get(
    pullRequestSessionKey,
  );
  if (previousNotifiedSha === autoFixBranchHeadSha) {
    return;
  }
  notifiedAutoFixBranchHeadByPullRequest.set(
    pullRequestSessionKey,
    autoFixBranchHeadSha,
  );

  const openLabel = t("openLabel");
  const action = await vscode.window.showInformationMessage(
    t("autoFixPullRequestDetectedPrompt", {
      prLabel: pullRequestLabel,
      prNumber: autoFixPullRequest.number || "",
    }),
    openLabel,
  );

  if (action === openLabel && autoFixPullRequest.webUrl) {
    await vscode.env.openExternal(vscode.Uri.parse(autoFixPullRequest.webUrl));
  }
}

async function promptToPullOriginBranchUpdate(
  branchName: string,
  pullRequestLabel: string,
  remoteHeadSha: string,
): Promise<void> {
  const now = Date.now();
  const declineCooldownUntil =
    declinedRemotePullPromptUntilByBranch.get(branchName) || 0;
  if (declineCooldownUntil > now) {
    return;
  }
  declinedRemotePullPromptUntilByBranch.delete(branchName);

  if (promptedRemoteUpdatesByBranch.get(branchName) === remoteHeadSha) {
    return;
  }
  promptedRemoteUpdatesByBranch.set(branchName, remoteHeadSha);
  const pullLatestBranchChangesLabel = t("pullLatestBranchChanges");
  const action = await vscode.window.showInformationMessage(
    t("remoteBranchUpdatedPrompt", {
      branch: branchName,
      prLabel: pullRequestLabel,
    }),
    pullLatestBranchChangesLabel,
  );
  if (action !== pullLatestBranchChangesLabel) {
    declinedRemotePullPromptUntilByBranch.set(
      branchName,
      Date.now() + GIT_PULL_REFUSAL_COOLDOWN_MS,
    );
    // Allow a new prompt after the cooldown even if remote HEAD did not change.
    promptedRemoteUpdatesByBranch.delete(branchName);
    return;
  }
  try {
    await vscode.commands.executeCommand("git.pull");
  } catch (error: any) {
    promptedRemoteUpdatesByBranch.delete(branchName);
    Logger.log(
      `Unable to run VS Code Git pull for branch ${branchName}: ${error?.message || error}`,
    );
  }
}

export function registerShowPipeline(commands: Commands) {
  let loadInProgress: Promise<PipelineInfo> | null = null;

  const disposable = vscode.commands.registerCommand(
    "vscode-sfdx-hardis.showPipeline",
    async (deepLink?: any) => {
      // Optional deep-link request: the deployment actions of the current branch (sent by the
      // CLI at the end of hardis:work:save), or one Pull Request (a Pull Request link of another
      // panel). The payload is rebuilt here so nothing else from the message reaches the webview.
      const pipelineDeepLink = buildPipelineDeepLink(deepLink);
      if (pipelineDeepLink) {
        Logger.log(
          `[vscode-sfdx-hardis] pipeline deep link requested: ${pipelineDeepLink.focus} ${pipelineDeepLink.prNumber ? "#" + pipelineDeepLink.prNumber : deepLink.sourceBranch || "(current branch)"}`,
        );
      }

      // Open the panel immediately with spinner flags so the LWC can render
      // partial content while pipeline data is fetched asynchronously.
      const panel = LwcPanelManager.getInstance().getOrCreatePanel(
        "s-pipeline",
        {
          deepLink: pipelineDeepLink,
          mermaidLoading: true,
          prLoading: true,
          imagePaths: {
            git: ["icons", "git.svg"],
            ticket: ["icons", "ticket.svg"],
            github: ["icons", "github.svg"],
            gitlab: ["icons", "gitlab.svg"],
            bitbucket: ["icons", "bitbucket.svg"],
            azure: ["icons", "azure.svg"],
            gitea: ["icons", "gitea.svg"],
            jira: ["icons", "jira.svg"],
            azureboards: ["icons", "azureboards.svg"],
            servicenow: ["icons", "servicenow.svg"],
          },
        },
      );

      panel.updateTitle(t("devOpsPipeline"));

      let pipelineProperties: PipelineInfo | null = null;

      // The deep link travels with the staged payloads: the webview applies
      // the data embedded in its HTML only when no "initialize" message got
      // there first, and every sendInitializationData() call replaces the
      // data re-sent on webviewReady. On a fast load, the pipeline data
      // arrives before the page finished booting, so a deep link carried
      // by the first payload only would be lost and the panel would open on
      // its home view. Consumed by the last stage of the first load.
      let pendingDeepLink = pipelineDeepLink;

      // Staged 3-step pipeline loader:
      // Step 1: spinner flags already sent via getOrCreatePanel init data.
      // Step 2: fast load (no git provider) — renders diagram without PR annotations.
      // Step 3: full load (with git provider) — renders diagram with PRs + populates PR list.
      const loadPipelineStaged = async (opts?: { resetGit?: boolean }) => {
        const stagedT0 = Date.now();
        Logger.logPerf("[pipeline-perf] staged load START (step 2: no git)");
        panel.sendInitializationData({
          mermaidLoading: true,
          prLoading: true,
          deepLink: pendingDeepLink,
        });
        try {
          const fast = await loadAllPipelineInfo({
            browseGitProvider: false,
            resetGit: opts?.resetGit ?? false,
            withProgress: false,
          });
          pipelineProperties = fast;
          Logger.logPerf(
            `[pipeline-perf] STEP 2 done (mermaid without PRs ready): ${Date.now() - stagedT0}ms`,
          );
          // Step 2: render the diagram (no PR annotations yet) with a spinner
          // overlaid on it while the git provider data loads for step 3.
          panel.sendInitializationData({
            ...fast,
            mermaidLoading: false,
            mermaidRefreshing: true,
            prLoading: true,
            deepLink: pendingDeepLink,
          });
          const full = await loadAllPipelineInfo({
            browseGitProvider: true,
            resetGit: opts?.resetGit ?? false,
            withProgress: false,
          });
          pipelineProperties = full;
          Logger.logPerf(
            `[pipeline-perf] STEP 3 done (mermaid with PRs ready): ${Date.now() - stagedT0}ms total`,
          );
          // Step 3: re-render with PR annotations and clear the overlay.
          panel.sendInitializationData({
            ...full,
            mermaidLoading: false,
            mermaidRefreshing: false,
            prLoading: false,
            deepLink: pendingDeepLink,
          });
          // Applied by the webview with this payload: a later staged reload
          // (refresh with git reset) must not open the modal again
          pendingDeepLink = null;
        } catch (e: any) {
          Logger.log(
            "[vscode-sfdx-hardis] pipeline staged load failed: " +
              (e?.message || e),
          );
          panel.sendInitializationData({
            mermaidLoading: false,
            mermaidRefreshing: false,
            prLoading: false,
            loadError: String(e?.message || e),
          });
        }
      };

      // Single-step full reload (used by the Refresh button): load everything
      // including git jobs & PRs and render the diagram once. Unlike the staged
      // loader, it skips the intermediate PR-less render. The refresh spinner is
      // driven by the LWC itself (overlay on the existing diagram for a manual
      // refresh, nothing for an auto/interval refresh), so this routine does NOT
      // push mermaidLoading:true up front — that would replace the diagram.
      const loadPipelineFull = async (opts?: { resetGit?: boolean }) => {
        try {
          const full = await loadAllPipelineInfo({
            browseGitProvider: true,
            resetGit: opts?.resetGit ?? false,
            withProgress: false,
          });
          pipelineProperties = full;
          panel.sendInitializationData({
            ...full,
            mermaidLoading: false,
            mermaidRefreshing: false,
            prLoading: false,
          });
        } catch (e: any) {
          Logger.log(
            "[vscode-sfdx-hardis] pipeline full reload failed: " +
              (e?.message || e),
          );
          panel.sendInitializationData({
            mermaidLoading: false,
            mermaidRefreshing: false,
            prLoading: false,
            loadError: String(e?.message || e),
          });
        }
      };

      function showCommitReminder(prNumber: number, msg: string) {
        if (prNumber === -1) {
          vscode.window.showInformationMessage(msg);
        } else {
          const openGitLabel = t("openGit");
          vscode.window
            .showInformationMessage(msg, openGitLabel)
            .then((action) => {
              if (action === openGitLabel) {
                vscode.commands.executeCommand("workbench.view.scm");
              }
            });
        }
      }

      panel.onMessage(async (type, data) => {
        // Retry after initial load error
        if (type === "retryInit") {
          await loadPipelineStaged();
          return;
        }
        // Refresh (Refresh button) — full single-step reload (mermaid with jobs
        // & PRs), keeps top bar visible; no intermediate PR-less render.
        if (type === "refreshPipeline") {
          ticketDetailsCache.clear();
          await loadPipelineFull();
        }
        // Update panel title
        else if (type === "updatePanelTitle") {
          panel.updateTitle(data.title);
        }
        // Open Package XML Panel
        else if (type === "showPackageXml") {
          // Handle package XML display requests from pipeline
          await showPackageXmlPanel(data);
        }
        // Show Metadata Retriever panel from pipeline quick action
        else if (type === "showMetadataRetriever") {
          try {
            await vscode.commands.executeCommand(
              "vscode-sfdx-hardis.showMetadataRetriever",
            );
          } catch (e) {
            Logger.log(
              `Error executing showMetadataRetriever command: ${String(e)}`,
            );
          }
        }
        // Save Deployment Action
        else if (type === "saveDeploymentAction") {
          // call savePrePostCommand to save the command
          const updatedFile = await savePrePostCommand(
            data.prNumber,
            data.command,
            data.originalCommand,
          );
          Logger.log(
            `Saved deployment action for PR #${data.prNumber}: ${JSON.stringify(
              data.command,
            )}`,
          );
          const prLabel =
            pipelineProperties?.prButtonInfo?.pullRequestLabel ||
            "Pull Request";
          const msg =
            data.prNumber === -1
              ? t("deploymentActionSavedDraft", { prLabel })
              : t("deploymentActionSaved", {
                  prLabel,
                  prNumber: data.prNumber,
                  updatedFile,
                });
          showCommitReminder(data.prNumber, msg);
          warnAboutOtherPullRequest(data);
        }
        // Delete Deployment Action
        else if (type === "deleteDeploymentAction") {
          const updatedFile = await deletePrePostCommand(
            data.prNumber,
            data.commandId,
            data.when,
          );
          Logger.log(
            `Deleted deployment action ${data.commandId} for PR #${data.prNumber}`,
          );
          if (updatedFile) {
            Logger.log(`Updated file after deletion: ${updatedFile}`);
          }
          warnAboutOtherPullRequest(data);
        }
        // Save Deployment Apex Test Classes
        else if (type === "saveDeploymentApexTestClasses") {
          const updatedFile = await saveDeploymentApexTestClasses(
            data.prNumber,
            data.deploymentApexTestClasses,
          );
          Logger.log(
            `Saved deployment apex test classes for PR #${data.prNumber}: ${JSON.stringify(
              data.deploymentApexTestClasses,
            )}`,
          );
          const prLabel =
            pipelineProperties?.prButtonInfo?.pullRequestLabel ||
            "Pull Request";
          const msg =
            data.prNumber === -1
              ? t("apexTestsSavedDraft", { prLabel })
              : t("apexTestsSaved", {
                  prLabel,
                  prNumber: data.prNumber,
                  updatedFile,
                });
          showCommitReminder(data.prNumber, msg);
          warnAboutOtherPullRequest(data);
        }
        // Lazy-load the schedulable classes, batchable classes and communities of the deployment
        // action editor, which the Pipeline Settings panel also opens
        else if (await handleDeploymentActionPickerMessage(panel, type, data)) {
          // Message handled by the shared deployment action pickers
        }
        // Mark as done: recorded by sfdx-hardis in the background, no command panel for it
        else if (type === "markDeploymentActionDone") {
          const outcome = await markDeploymentActionDone(data);
          panel.sendMessage({
            type: "deploymentActionMarkDoneResult",
            data: { key: data?.key, ...outcome },
          });
        }
        // Status of the deployment actions in each org branch, read by sfdx-hardis from the
        // "Deployment Actions" Pull Request comments
        else if (type === "loadDeploymentActionBackpromotes") {
          const prNumber = Number(data?.prNumber);
          panel.sendMessage({
            type: "returnDeploymentActionBackpromotes",
            data: {
              prNumber,
              rows: await loadDeploymentActionBackpromotes(prNumber),
            },
          });
        } else if (type === "loadDeploymentActionStatuses") {
          panel.sendMessage({
            type: "returnDeploymentActionStatuses",
            data: await loadDeploymentActionStatuses(data),
          });
        }
        // Get PR info for modal
        else if (type === "getPrInfoForModal") {
          const gitProvider = await GitProvider.getInstance();
          if (!gitProvider) {
            Logger.log("No Git provider available for getPrInfoForModal");
            // Let the webview know the request failed so it can clear any state
            // (ex: the tab a deep link asked to open) it was holding for the
            // modal that will never open.
            panel.sendMessage({
              type: "returnGetPrInfoForModal",
              data: { notFound: true, requestId: Number(data?.requestId) || 0 },
            });
            return;
          }
          try {
            // A Pull Request known by its number only (lookup, reference, deep link) is read first
            let requestedPr: PullRequest | null = data?.pullRequest
              ? { ...data.pullRequest }
              : null;
            const requestedNumber = Number(data?.prNumber);
            if (
              !requestedPr &&
              Number.isInteger(requestedNumber) &&
              requestedNumber > 0
            ) {
              // The Pull Request the pipeline already loaded carries the jobs of its last commit,
              // which a read by number does not collect
              const loaded: PullRequest[] = [
                ...(((pipelineProperties as any)?.openPullRequests ||
                  []) as PullRequest[]),
                ...(pipelineProperties?.pipelineData?.orgs || []).flatMap(
                  (org: any) => org.pullRequestsInBranchSinceLastMerge || [],
                ),
              ];
              const known = loaded.find(
                (pullRequest) => pullRequest.number === requestedNumber,
              );
              requestedPr = known
                ? { ...known }
                : await gitProvider.getPullRequestByNumber(requestedNumber);
            }
            if (!requestedPr) {
              vscode.window.showWarningMessage(
                t("prViewNotFound", {
                  prLabel:
                    pipelineProperties?.prButtonInfo?.pullRequestLabel ||
                    "Pull Request",
                  number: String(data?.prNumber ?? ""),
                }),
              );
              panel.sendMessage({
                type: "returnGetPrInfoForModal",
                data: {
                  notFound: true,
                  requestId: Number(data?.requestId) || 0,
                },
              });
              return;
            }
            // Get full PR details with tickets and deployment actions
            // Its branch is fetched when its actions file is not in the checked out one, so the
            // window of one Pull Request shows what its branch holds now
            let prList: any[] = [requestedPr];
            prList = await gitProvider.completePullRequestsWithPrePostCommands(
              prList,
              { fetch: true },
            );
            prList = await gitProvider.completePullRequestsWithTickets(prList, {
              fetchDetails: true,
            });
            const prDetails = prList[0];
            // A Pull Request between two major branches (ex: integration ->
            // uat) carries no deployment action of its own: sfdx-hardis runs
            // the actions declared on the feature Pull Requests merged in its
            // source branch since the last promotion. The modal lists those,
            // read-only, instead of proposing to create actions on it.
            const sourceMajorOrg = (
              pipelineProperties?.pipelineData?.orgs || []
            ).find((org: any) => org?.name === prDetails?.sourceBranch);
            if (prDetails && sourceMajorOrg) {
              prDetails.isMajorToMajor = true;
              // Only an open one will carry what waits in its source branch. Once merged or
              // closed, the stories merged in that branch since then are not its own: listing
              // them would offer to run their actions as if this Pull Request had brought them
              prDetails.aggregatedPullRequests =
                prDetails.state === "open" || !prDetails.state
                  ? sourceMajorOrg.pullRequestsInBranchSinceLastMerge || []
                  : [];
            }
            // A promotion Pull Request (promotion/ branch declaring the stories it
            // carries) is read-only like a major-to-major one: it lists the actions,
            // tickets and test classes of the declared Pull Requests. Those are looked
            // up in the windows already loaded, the others are fetched by number.
            const promotionConfig: PromotionBranchConfig | undefined =
              pipelineProperties?.pipelineData?.promotionBranches;
            // What tells a promotion here is what it says of itself: its branch name and the
            // stories its description declares. The setting of the project is not asked: it is
            // read from the files of the branch checked out, and a promotion left with conflict
            // markers in config/.sfdx-hardis.yml makes that file unreadable, which showed the
            // promotion as an ordinary Pull Request carrying nothing.
            if (
              prDetails &&
              !prDetails.isMajorToMajor &&
              isPromotionPullRequest(prDetails, {
                allowedSteps: promotionConfig?.allowedSteps || [],
                enabled: true,
              })
            ) {
              const declared =
                parsePromotionPullRequestIds(prDetails.description) || [];
              const loadedPrs: PullRequest[] = (
                pipelineProperties?.pipelineData?.orgs || []
              ).flatMap(
                (org: any) => org.pullRequestsInBranchSinceLastMerge || [],
              );
              // The stories already loaded cost nothing; the others are fetched in parallel and
              // completed in one batch each. One story at a time meant three serialized provider
              // round trips per declared Pull Request, and a promotion carrying forty of them
              // froze the modal.
              const carried: PullRequest[] = [];
              const unresolved: number[] = [];
              const alreadyLoaded = new Map<number, PullRequest>();
              const toFetch: number[] = [];
              for (const number of declared) {
                const known = loadedPrs.find(
                  (pr: PullRequest) => pr.number === number,
                );
                if (known) {
                  alreadyLoaded.set(number, known);
                } else {
                  toFetch.push(number);
                }
              }
              const fetched = await Promise.all(
                toFetch.map(async (number) => ({
                  number,
                  story: await gitProvider.getPullRequestByNumber(number),
                })),
              );
              const fetchedStories = fetched
                .map((entry) => entry.story)
                .filter((story): story is PullRequest => !!story);
              if (fetchedStories.length > 0) {
                await gitProvider.completePullRequestsWithPrePostCommands(
                  fetchedStories,
                );
                await gitProvider.completePullRequestsWithTickets(
                  fetchedStories,
                  { fetchDetails: true },
                );
              }
              const fetchedByNumber = new Map<number, PullRequest>(
                fetched
                  .filter((entry) => entry.story)
                  .map((entry) => [entry.number, entry.story as PullRequest]),
              );
              for (const number of declared) {
                const story =
                  alreadyLoaded.get(number) || fetchedByNumber.get(number);
                // An open or declined Pull Request cannot be in the branch: the CLI skips it
                // with promotionDeclaredPrNotMerged, and listing its deployment actions as running
                // with this promotion would be wrong
                if (story && isMergedPullRequest(story)) {
                  carried.push(story);
                } else {
                  unresolved.push(number);
                }
              }
              prDetails.isPromotion = true;
              prDetails.promotionPullRequests = declared;
              prDetails.aggregatedPullRequests = carried;
              prDetails.unresolvedPromotionPullRequests = unresolved;
              // The tickets of the carried stories belong to the promotion as well
              const seenTickets = new Set(
                (prDetails.relatedTickets || []).map(
                  (ticket: any) => ticket.id,
                ),
              );
              for (const story of carried) {
                for (const ticket of story.relatedTickets || []) {
                  if (!seenTickets.has(ticket.id)) {
                    seenTickets.add(ticket.id);
                    prDetails.relatedTickets = [
                      ...(prDetails.relatedTickets || []),
                      ticket,
                    ];
                  }
                }
              }
            }
            // The deployment actions and test classes shown come from the local checkout, and an
            // edit is written in it: the view says which branch that is, and whether it is behind
            if (prDetails) {
              (prDetails as any).checkout = await getCheckoutInfo();
              // The id of the request goes back, so the panel can drop a late answer
              (prDetails as any).requestId = Number(data?.requestId) || 0;
            }
            panel.sendMessage({
              type: "returnGetPrInfoForModal",
              data: prDetails || {
                notFound: true,
                requestId: Number(data?.requestId) || 0,
              },
            });
          } catch (e) {
            const prLabel =
              pipelineProperties?.prButtonInfo?.pullRequestLabel ||
              "Pull Request";
            Logger.log(`Error getting ${prLabel} info for modal: ${String(e)}`);
            vscode.window.showErrorMessage(
              t("errorGettingPrInfo", { prLabel }),
            );
            panel.sendMessage({
              type: "returnGetPrInfoForModal",
              data: { notFound: true, requestId: Number(data?.requestId) || 0 },
            });
          }
        }
        // Subject, status and assignee of the tickets of the window on screen
        else if (type === "loadTicketDetails") {
          panel.sendMessage({
            type: "returnTicketDetails",
            data: await loadTicketDetailsForPanel(data),
          });
        }
        // Pull Requests explorer: text search on the git provider, after the Pull Requests the
        // panel already holds have been filtered in the webview
        else if (type === "searchPullRequests") {
          panel.sendMessage({
            type: "returnSearchPullRequests",
            data: await searchPullRequestsForLookup(data),
          });
        }
        // Lazy-load the list of go-lives for a top branch (selector content only)
        else if (type === "loadGoLives") {
          const requestId = data?.requestId || null;
          const branchName = data?.branchName || "";
          try {
            const gitProvider = await GitProvider.getInstance();
            const goLives =
              gitProvider && branchName
                ? await gitProvider.listGoLives(branchName)
                : [];
            panel.sendMessage({
              type: "returnGoLives",
              data: { requestId, branchName, goLives },
            });
          } catch (error: any) {
            Logger.log(
              `Error loading go-lives for branch ${branchName}: ${error?.message || error}`,
            );
            panel.sendMessage({
              type: "returnGoLives",
              data: { requestId, branchName, goLives: [] },
            });
          }
        }
        // Lazy-load the Pull Requests carried by a selected go-live
        else if (type === "loadGoLivePullRequests") {
          const requestId = data?.requestId || null;
          const branchName = data?.branchName || "";
          const mergeCommitId = data?.mergeCommitId || "";
          try {
            const gitProvider = await GitProvider.getInstance();
            let pullRequests: PullRequest[] = [];
            if (gitProvider && branchName && mergeCommitId) {
              const childBranchesNames = await getChildBranchNames(branchName);
              pullRequests = await gitProvider.listPullRequestsInGoLive(
                branchName,
                childBranchesNames,
                mergeCommitId,
              );
              // Enrich like the pipeline load does (tickets + deployment actions)
              await gitProvider.completePullRequestsWithTickets(pullRequests, {
                fetchDetails: true,
              });
              await gitProvider.completePullRequestsWithPrePostCommands(
                pullRequests,
              );
            }
            panel.sendMessage({
              type: "returnGoLivePullRequests",
              data: { requestId, branchName, mergeCommitId, pullRequests },
            });
          } catch (error: any) {
            Logger.log(
              `Error loading go-live pull requests for branch ${branchName} (${mergeCommitId}): ${error?.message || error}`,
            );
            panel.sendMessage({
              type: "returnGoLivePullRequests",
              data: {
                requestId,
                branchName,
                mergeCommitId,
                pullRequests: [],
              },
            });
          }
        }
        // Update VS Code configuration
        else if (type === "updateVsCodeSfdxHardisConfiguration") {
          const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
          await config.update(
            data.configKey,
            data.value,
            vscode.ConfigurationTarget.Global,
          );
          Logger.log(
            `Updated configuration: ${data.configKey} = ${data.value}`,
          );
        }
        // Open org via sf org open, preferring a known username when available
        else if (type === "openOrg") {
          const instanceUrl: string | undefined = data?.instanceUrl;
          const alias: string | undefined = data?.alias;
          const normalizeUrl = (url?: string) =>
            (url || "").replace(/\/*$/, "").toLowerCase();
          let targetOrgUsername: string | undefined;
          if (instanceUrl) {
            try {
              const orgs = await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: t("searchingOrgsForInstanceUrl"),
                  cancellable: false,
                },
                async () => {
                  return await listAllOrgs(false, true);
                },
              );
              const normalizedTarget = normalizeUrl(instanceUrl);
              const match = orgs.find(
                (org) => normalizeUrl(org.instanceUrl) === normalizedTarget,
              );
              if (match?.username) {
                targetOrgUsername = match.username;
              }
            } catch (error: any) {
              Logger.log(
                `Error while listing orgs for openOrg: ${error?.message || error}`,
              );
            }
          }

          let command: string | null = null;
          if (targetOrgUsername) {
            command = `sf org open --target-org ${targetOrgUsername}`;
          } else if (alias) {
            command = `sf org open --target-org ${alias}`;
          }

          if (command) {
            const progressLabel = targetOrgUsername
              ? t("openingOrgNamed", { name: targetOrgUsername })
              : alias
                ? t("openingOrgNamed", { name: alias })
                : t("openingOrg");
            try {
              await execCommandWithProgress(
                command,
                { fail: true, output: true, spinner: true },
                progressLabel,
              );
            } catch (error: any) {
              if (instanceUrl) {
                try {
                  await vscode.env.openExternal(vscode.Uri.parse(instanceUrl));
                  return;
                } catch (fallbackError: any) {
                  vscode.window.showErrorMessage(
                    t("failedToOpenOrgCliAndUrl", {
                      error: fallbackError?.message || fallbackError,
                    }),
                  );
                  return;
                }
              }
              vscode.window.showErrorMessage(
                t("failedToOpenOrg", { error: error?.message || error }),
              );
            }
          } else if (instanceUrl) {
            try {
              await vscode.env.openExternal(vscode.Uri.parse(instanceUrl));
            } catch (error: any) {
              vscode.window.showErrorMessage(
                t("failedToOpenOrgUrl", { error: error?.message || error }),
              );
            }
          } else {
            vscode.window.showWarningMessage(t("unableToOpenOrg"));
          }
        }
        // Authenticate or re-authenticate to Git provider
        else if (type === "connectToGit") {
          const gitProvider = await GitProvider.getInstance();
          if (!gitProvider) {
            vscode.window.showErrorMessage(t("noGitProviderDetected"));
            return;
          }
          Logger.log(
            `Authenticating to Git provider: ${gitProvider.repoInfo?.providerName} at ${gitProvider.repoInfo?.host}`,
          );
          let authRes: boolean | null;
          try {
            authRes = await gitProvider.authenticate();
          } catch (e) {
            const viewLogsLabel = t("viewLogs");
            vscode.window
              .showErrorMessage(t("gitProviderAuthError"), viewLogsLabel)
              .then((action) => {
                if (action === viewLogsLabel) {
                  Logger.showOutputChannel();
                }
              });
            Logger.log(
              `Error during Git provider authentication: ${String(e)}`,
            );
            return;
          }
          if (authRes === true) {
            vscode.window.showInformationMessage(
              t("successfullyConnectedToGitProvider"),
            );
            // Reuse the just-authenticated provider instance instead of rebuilding it
            // (resetGit: false). Rebuilding would re-run initialize() and call
            // getSession({ createIfNone: false }) immediately after the new VS Code
            // sign-in, which can momentarily return no session and wrongly report the
            // provider as not connected.
            await loadPipelineStaged();
          } else if (authRes === false) {
            const viewLogsLabel = t("viewLogs");
            vscode.window
              .showErrorMessage(t("failedConnectGitProvider"), viewLogsLabel)
              .then((action) => {
                if (action === viewLogsLabel) {
                  Logger.showOutputChannel();
                }
              });
          }
        } else if (type === "connectToTicketing") {
          const ticketProvider = await TicketProvider.getInstance({
            reset: true,
            authenticate: true,
          });
          if (!ticketProvider) {
            const pipelineSettingsLabel = t("pipelineConfig");
            vscode.window
              .showErrorMessage(
                t("noTicketingProviderDetected"),
                pipelineSettingsLabel,
              )
              .then((action) => {
                if (action === pipelineSettingsLabel) {
                  vscode.commands.executeCommand(
                    "vscode-sfdx-hardis.showPipelineConfig",
                    null,
                    "Ticketing",
                  );
                }
              });
            return;
          }
          if (!ticketProvider.isAuthenticated) {
            const viewLogsLabel = t("viewLogs");
            vscode.window
              .showErrorMessage(
                t("failedConnectToProvider", {
                  providerName: ticketProvider.getProviderLabel(),
                }),
                viewLogsLabel,
              )
              .then((action) => {
                if (action === viewLogsLabel) {
                  Logger.showOutputChannel();
                }
              });
            return;
          }
          vscode.window.showInformationMessage(
            t("successfullyConnectedToProvider", {
              providerName: ticketProvider.getProviderLabel(),
            }),
          );
          await loadPipelineStaged();
        }
        // Prompt user for Git provider action when already connected
        else if (type === "promptGitProviderAction") {
          const providerName = data?.providerName || "Git";
          const openRemoteLabel = t("openRemoteRepository");
          const disconnectLabel = t("disconnect");
          const choice = await vscode.window.showInformationMessage(
            t("connectedToProviderAction", { providerName }),
            { modal: true },
            openRemoteLabel,
            disconnectLabel,
          );
          if (choice === openRemoteLabel) {
            const gitProvider = await GitProvider.getInstance();
            const repoUrl = gitProvider?.repoInfo?.webUrl || "";
            if (!repoUrl) {
              vscode.window.showWarningMessage(
                t("noWebUrlForRepo", { providerName }),
              );
              return;
            }
            vscode.env.openExternal(vscode.Uri.parse(repoUrl));
          } else if (choice === disconnectLabel) {
            const gitProvider = await GitProvider.getInstance();
            if (gitProvider) {
              await gitProvider.disconnect();
              vscode.window.showInformationMessage(
                t("disconnectedFrom", { providerName }),
              );
              // Refresh pipeline with unauthenticated state
              await loadPipelineStaged({ resetGit: true });
            }
          }
        }
        // Prompt user for Ticketing provider action when already connected
        else if (type === "promptTicketProviderAction") {
          const providerName = data?.providerName || "Ticketing";
          const openProviderLabel = t("openProviderButton", { providerName });
          const disconnectLabel = t("disconnect");
          const choice = await vscode.window.showInformationMessage(
            t("connectedToProviderAction", { providerName }),
            { modal: true },
            openProviderLabel,
            disconnectLabel,
          );
          if (choice === openProviderLabel) {
            const ticketProvider = await TicketProvider.getInstance({
              reset: false,
              authenticate: false,
            });
            if (!ticketProvider) {
              vscode.window.showWarningMessage(
                t("unableToFindTicketingConnection"),
              );
              return;
            }
            const ticketingUrl = await ticketProvider.getTicketingWebUrl();
            if (!ticketingUrl) {
              vscode.window.showWarningMessage(
                t("noWebUrlForTicketing", { providerName }),
              );
              return;
            }
            vscode.env.openExternal(vscode.Uri.parse(ticketingUrl));
          } else if (choice === disconnectLabel) {
            const ticketProvider = await TicketProvider.getInstance({
              reset: false,
              authenticate: false,
            });

            if (ticketProvider) {
              await ticketProvider.disconnect();
              vscode.window.showInformationMessage(
                t("disconnectedFrom", { providerName }),
              );
            } else {
              vscode.window.showWarningMessage(
                t("unableToFindTicketingConnection"),
              );
            }

            // Refresh pipeline with unauthenticated ticketing state
            await loadPipelineStaged();
          }
        }
      });

      // Start the staged background load — panel shows partial content immediately.
      loadPipelineStaged();
    },
  );
  commands.disposables.push(disposable);

  async function loadAllPipelineInfo(
    options: LoadPipelineOptions,
  ): Promise<PipelineInfo> {
    // If a load is already in progress, wait for it to complete
    if (loadInProgress) {
      Logger.log(
        "Pipeline load already in progress, waiting for completion...",
      );
      return await loadInProgress;
    }
    // Start new load and track it
    loadInProgress = processLoadAllPipelineInfo(options);
    try {
      const result = await loadInProgress;
      return result;
    } finally {
      // Clear the in-progress flag when done
      loadInProgress = null;
    }
  }

  async function processLoadAllPipelineInfo(
    options: LoadPipelineOptions,
  ): Promise<PipelineInfo> {
    const withProgress = options?.withProgress ?? true;

    const loadData = async () => {
      const browseGitProvider = options?.browseGitProvider ?? true;
      const resetGit = options?.resetGit ?? false;
      // ── [pipeline-perf] timing instrumentation ──────────────────────────────
      const perfT0 = Date.now();
      let perfLast = perfT0;
      const perfStep = (label: string) => {
        const now = Date.now();
        Logger.logPerf(
          `[pipeline-perf][browseGit=${browseGitProvider}] ${label}: ${now - perfLast}ms (total ${now - perfT0}ms)`,
        );
        perfLast = now;
      };
      Logger.logPerf(
        `[pipeline-perf][browseGit=${browseGitProvider}] loadData START`,
      );
      // Step 2 (browseGitProvider=false) renders the mermaid from local config
      // only — skip the git provider init entirely (its cold detection + token
      // validation costs ~10s on first run). It is initialized in step 3.
      const gitProvider = browseGitProvider
        ? await GitProvider.getInstance(resetGit)
        : null;
      perfStep("GitProvider.getInstance");
      let openPullRequests: PullRequest[] = [];
      let gitAuthenticated = false;
      let currentBranchPullRequest: PullRequest | null = null;
      let autoFixPullRequest: PullRequest | null = null;

      // Determine theme for Mermaid diagram colors
      const config = vscode.workspace.getConfiguration("vsCodeSfdxHardis");
      const colorThemeConfig = config.get("theme.colorTheme", "light");
      const themeConfig = LwcUiPanel.resolveTheme(colorThemeConfig);
      const colorTheme = themeConfig.colorTheme;

      const prButtonInfo: any = {};
      let repoPlatformLabel = "";
      if (gitProvider?.repoInfo) {
        const desc = gitProvider.describeGitProvider();
        prButtonInfo.url = desc.pullRequestsWebUrl;
        prButtonInfo.label = `View ${desc.pullRequestLabel}s on ${desc.providerLabel}`;
        prButtonInfo.icon = gitProvider.repoInfo.providerName;
        prButtonInfo.pullRequestLabel = desc.pullRequestLabel;
        repoPlatformLabel = desc.providerLabel;
      } else {
        prButtonInfo.url = "";
        prButtonInfo.label = t("viewPullRequests");
        prButtonInfo.icon = "";
      }

      if (gitProvider?.isActive) {
        gitAuthenticated = true;
        if (browseGitProvider) {
          openPullRequests = await gitProvider.listOpenPullRequests();
          perfStep("gitProvider.listOpenPullRequests");
          const currentGitBranch = await getCurrentGitBranch();
          if (currentGitBranch) {
            const prActionsFileDraft = path.join(
              getWorkspaceRoot(),
              "scripts",
              "actions",
              ".sfdx-hardis.draft.yml",
            );
            currentBranchPullRequest =
              await gitProvider.getActivePullRequestFromBranch(
                currentGitBranch,
              );
            perfStep("getActivePullRequestFromBranch");
            if (currentBranchPullRequest) {
              if (fs.existsSync(prActionsFileDraft)) {
                // Rename draft file to associate it with the current PR
                const prNumber = currentBranchPullRequest.number;
                const prActionsFileNewName = path.join(
                  getWorkspaceRoot(),
                  "scripts",
                  "actions",
                  `.sfdx-hardis.${prNumber}.yml`,
                );
                await fs.promises.rename(
                  prActionsFileDraft,
                  prActionsFileNewName,
                );
                const commitAndPushLabel = t("commitAndPushFile", {
                  fileName: `.sfdx-hardis.${prNumber}.yml`,
                });
                const openGitLabel = t("openGit");
                vscode.window
                  .showInformationMessage(
                    t("draftActionsFileAssociated", {
                      prLabel: prButtonInfo.pullRequestLabel || "Pull Request",
                      prNumber: currentBranchPullRequest.number,
                    }),
                    commitAndPushLabel,
                    openGitLabel,
                  )
                  .then((action) => {
                    if (
                      action === commitAndPushLabel ||
                      action === openGitLabel
                    ) {
                      vscode.commands.executeCommand("workbench.view.scm");
                    }
                  });
              }
              // Complete with tickets and deployment actions
              const prList =
                await gitProvider.completePullRequestsWithPrePostCommands([
                  currentBranchPullRequest,
                ]);
              const prListWithTickets =
                await gitProvider.completePullRequestsWithTickets(prList, {
                  fetchDetails: true,
                });
              currentBranchPullRequest = prListWithTickets[0];
            } else {
              // No PR found for current branch but draft file exists
              currentBranchPullRequest = {
                id: "",
                authorLabel: "",
                jobsStatus: "unknown",
                number: -1,
                title: t("prLabelNotCreatedYet", {
                  prLabel: prButtonInfo.pullRequestLabel,
                }),
              };
              const prList =
                await gitProvider.completePullRequestsWithPrePostCommands([
                  currentBranchPullRequest,
                ]);
              currentBranchPullRequest = prList[0];
            }

            if (
              currentBranchPullRequest &&
              currentBranchPullRequest.number !== -1
            ) {
              const autoFixBranchName = `auto-fix/${currentGitBranch}`;
              const [originBranchStatus, autoFixBranchOnOrigin] =
                await Promise.all([
                  getOriginBranchUpdateStatus(currentGitBranch),
                  remoteBranchExists(autoFixBranchName),
                ]);

              if (
                originBranchStatus.hasNewRemoteCommit &&
                originBranchStatus.remoteHeadSha
              ) {
                void promptToPullOriginBranchUpdate(
                  currentGitBranch,
                  prButtonInfo.pullRequestLabel || t("pullRequestLabel"),
                  originBranchStatus.remoteHeadSha,
                );
              } else {
                promptedRemoteUpdatesByBranch.delete(currentGitBranch);
              }

              if (autoFixBranchOnOrigin) {
                autoFixPullRequest =
                  openPullRequests.find(
                    (pullRequest) =>
                      pullRequest.sourceBranch === autoFixBranchName,
                  ) ||
                  (await gitProvider.getActivePullRequestFromBranch(
                    autoFixBranchName,
                  ));

                if (autoFixPullRequest) {
                  void maybeNotifyAutoFixPullRequest(
                    autoFixPullRequest,
                    autoFixBranchName,
                    prButtonInfo.pullRequestLabel || t("pullRequestLabel"),
                  );
                }
              }
            } else {
              promptedRemoteUpdatesByBranch.delete(currentGitBranch);
            }
          }
        }
      }
      const featureBranchGroupThreshold = config.get<number>(
        "pipelineFeatureBranchGroupThreshold",
        3,
      );
      const pipelineDataProvider = new PipelineDataProvider();
      const pipelineData = await pipelineDataProvider.getPipelineData(
        gitAuthenticated,
        {
          openPullRequests: openPullRequests,
          browseGitProvider: browseGitProvider,
          colorTheme: colorTheme,
          featureBranchGroupThreshold: featureBranchGroupThreshold,
        },
      );
      perfStep("getPipelineData (mermaid)");

      // Read displayFeatureBranches configuration
      const displayFeatureBranches =
        config.get<boolean>("pipelineDisplayFeatureBranches") ?? true;

      const ticketProvider = await TicketProvider.getInstance({
        reset: false,
        authenticate: false,
      });
      perfStep("TicketProvider.getInstance");
      let ticketAuthenticated = false;
      // Brand name shown in the UI ("Jira", "ServiceNow"), and the separate key
      // of its icon: the label is not always a usable file name ("Azure Boards")
      let ticketProviderName = "";
      let ticketProviderKey = "";
      if (ticketProvider) {
        ticketProviderName = ticketProvider.getProviderLabel();
        ticketProviderKey = ticketProvider.getProviderIconKey();
      }
      if (ticketProvider?.isAuthenticated) {
        ticketAuthenticated = true;
      }

      // Deployment-action modal data (apex scripts, SFDMU workspaces, apex test
      // classes) is only used once the user opens that modal from a PR — never
      // by the mermaid. Load it ONLY in the full pass (browseGitProvider) so the
      // fast step-2 mermaid render is never blocked by scanning the project
      // (listProjectApexTestClasses reads every .cls file).
      const projectApexScripts = browseGitProvider
        ? await listProjectApexScripts()
        : [];
      perfStep("listProjectApexScripts");
      const projectDataWorkspaces = browseGitProvider
        ? await listProjectDataWorkspaces()
        : [];
      perfStep("listProjectDataWorkspaces");
      // Custom functions are deployment action types, so the action editor needs the catalog.
      // Same rule as the lists above: full pass only, the mermaid render never uses it.
      // Listing them costs a whole sfdx-hardis start (several seconds): the load never waits for
      // it. The catalog already read for the current configuration is used at once, else it is
      // read in the background and sent to the panel when it is there.
      const cachedCustomFunctions = getCachedCustomFunctions();
      const customFunctions = cachedCustomFunctions ?? [];
      if (browseGitProvider && cachedCustomFunctions === null) {
        void refreshCustomFunctionsCache().then((functions) => {
          LwcPanelManager.getInstance()
            .getPanel("s-pipeline")
            ?.sendMessage({ type: "customFunctionsLoaded", data: functions });
        });
      }
      perfStep("customFunctions (cache)");

      // Read enableDeploymentApexTestClasses from config/.sfdx-hardis.yml
      const projectHardisConfig = await readSfdxHardisConfig();
      perfStep("readSfdxHardisConfig");
      const enableDeploymentApexTestClasses =
        projectHardisConfig?.enableDeploymentApexTestClasses === true;

      const availableApexTestClasses =
        browseGitProvider && enableDeploymentApexTestClasses
          ? await listProjectApexTestClasses()
          : [];
      perfStep("listProjectApexTestClasses");
      Logger.logPerf(
        `[pipeline-perf][browseGit=${browseGitProvider}] loadData TOTAL: ${Date.now() - perfT0}ms`,
      );

      return {
        pipelineData: pipelineData,
        prButtonInfo: prButtonInfo,
        gitAuthenticated: gitAuthenticated,
        ticketAuthenticated: ticketAuthenticated,
        ticketProviderName: ticketProviderName,
        ticketProviderKey: ticketProviderKey,
        currentBranchPullRequest: currentBranchPullRequest,
        autoFixPullRequest: autoFixPullRequest,
        openPullRequests: openPullRequests,
        repoPlatformLabel: repoPlatformLabel,
        repoInfo: gitProvider?.repoInfo || null,
        displayFeatureBranches: displayFeatureBranches,
        projectApexScripts: projectApexScripts,
        projectSfdmuWorkspaces: projectDataWorkspaces,
        projectCommunities: [],
        customFunctions: customFunctions,
        enableDeploymentApexTestClasses: enableDeploymentApexTestClasses,
        availableApexTestClasses: availableApexTestClasses,
      };
    };

    if (withProgress) {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("loadingPipelineInformation"),
          cancellable: false,
        },
        loadData,
      );
    } else {
      return await loadData();
    }
  }
}

type LoadPipelineOptions = {
  browseGitProvider: boolean;
  resetGit: boolean;
  withProgress?: boolean;
};

type PipelineInfo = {
  pipelineData: any;
  gitAuthenticated: boolean;
  ticketAuthenticated?: boolean;
  ticketProviderName?: string;
  ticketProviderKey?: string;
  prButtonInfo: any;
  currentBranchPullRequest?: PullRequest | null;
  autoFixPullRequest?: PullRequest | null;
  openPullRequests: PullRequest[];
  repoPlatformLabel: string;
  repoInfo?: any;
  displayFeatureBranches: boolean;
  projectApexScripts: any[];
  projectSfdmuWorkspaces: any[];
  projectCommunities: any[];
  customFunctions: any[];
  enableDeploymentApexTestClasses: boolean;
  availableApexTestClasses: string[];
};

/**
 * A change was written for a Pull Request that is not the one of the checked out branch: the
 * panel sends the sentence that says where it went, shown once the file is written. Nothing is
 * said while the Pull Request is only read.
 */
function warnAboutOtherPullRequest(data: any): void {
  const warning = typeof data?.warning === "string" ? data.warning.trim() : "";
  if (warning !== "") {
    vscode.window.showWarningMessage(warning.slice(0, 600));
  }
}

// True once the installed sfdx-hardis refused --with-workflows: not asked again this session
let workflowsFlagRefused = false;

// Ticket details already read in this session, by ticket id: a window opened again, or a
// ticket shared by several branches, costs nothing
const TICKET_DETAILS_TTL_MS = 2 * 60 * 1000;
const ticketDetailsCache = new Map<string, { ticket: Ticket; at: number }>();

/**
 * Subject, status and assignee of some tickets, read from the ticketing tool in the batches of
 * its provider. Asked by the panel when a window shows its tickets, so the diagram never waits
 * for them. The request id goes back so the panel can drop a late answer.
 */
async function loadTicketDetailsForPanel(data: any): Promise<{
  requestId: number;
  tickets: Ticket[];
}> {
  const requestId = Number(data?.requestId) || 0;
  const requested: Ticket[] = (Array.isArray(data?.tickets) ? data.tickets : [])
    .filter((ticket: any) => ticket && typeof ticket.id === "string")
    .slice(0, 500);
  try {
    const ticketProvider = await TicketProvider.getInstance({
      reset: false,
      authenticate: false,
    });
    if (!ticketProvider?.isAuthenticated || requested.length === 0) {
      return { requestId, tickets: [] };
    }
    const now = Date.now();
    const detailed = await mapWithConcurrencySettled(
      requested,
      async (ticket) => {
        const cached = ticketDetailsCache.get(ticket.id);
        if (cached && now - cached.at < TICKET_DETAILS_TTL_MS) {
          return cached.ticket;
        }
        const result =
          (await ticketProvider.completeTicketDetails({ ...ticket })) ?? ticket;
        // A ticket that came back without details (ticketing error, throttling, a provider
        // that has none) is not remembered: it is asked again next time
        if (result.subject) {
          ticketDetailsCache.set(ticket.id, { ticket: result, at: Date.now() });
        }
        return result;
      },
      ticketProvider.batchSizes,
      (err: any, ticket) =>
        Logger.log(
          `completeTicketDetails failed for ticket=${ticket.id}: ${err?.message || err}`,
        ),
    );
    return {
      requestId,
      tickets: detailed.filter((ticket): ticket is Ticket => !!ticket),
    };
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] ticket details not loaded: ${e?.message || e}`,
    );
    return { requestId, tickets: [] };
  }
}

const PULL_REQUEST_VIEW_TABS = [
  "general",
  "carried",
  "tickets",
  "actions",
  "apexTests",
  "validation",
  "deployment",
  "megalinter",
];

/**
 * The deep link the webview is allowed to receive, rebuilt from what the caller sent.
 */
function buildPipelineDeepLink(
  deepLink: any,
): { focus: string; prNumber?: number; tab?: string } | null {
  if (deepLink && deepLink.focus === "deploymentActions") {
    return { focus: "deploymentActions" };
  }
  if (deepLink && deepLink.focus === "explorer") {
    return { focus: "explorer" };
  }
  const prNumber = Number(deepLink?.prNumber);
  if (
    deepLink &&
    deepLink.focus === "pullRequest" &&
    Number.isInteger(prNumber) &&
    prNumber > 0
  ) {
    return {
      focus: "pullRequest",
      prNumber,
      ...(PULL_REQUEST_VIEW_TABS.includes(deepLink.tab)
        ? { tab: deepLink.tab }
        : {}),
    };
  }
  return null;
}

/**
 * The branch checked out in the workspace, and whether origin holds commits it does not have.
 * Never fails: without git information the view simply shows no warning about it.
 */
async function getCheckoutInfo(): Promise<{
  branch: string;
  behindOrigin: boolean;
}> {
  try {
    const git = simpleGit(getWorkspaceRoot());
    const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    if (!branch || branch === "HEAD") {
      return { branch: "", behindOrigin: false };
    }
    // No fetch here: opening a Pull Request must stay instant. The remote-tracking ref is what
    // the last fetch of the panel (or of the user) left.
    const counts = (
      await git.raw([
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...origin/${branch}`,
      ])
    )
      .trim()
      .split(/\s+/);
    const behind = Number.parseInt(counts[1] || "0", 10);
    return { branch, behindOrigin: Number.isFinite(behind) && behind > 0 };
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] checkout status not available: ${e?.message || e}`,
    );
    return { branch: "", behindOrigin: false };
  }
}

/**
 * Text search of Pull Requests on the git provider, for the lookup of the Pull Requests explorer.
 * supported false: the provider cannot search, the lookup then only lists what the panel holds.
 * The request id goes back so the lookup can drop a late answer.
 */
async function searchPullRequestsForLookup(data: any): Promise<{
  requestId: number;
  supported: boolean;
  truncated: boolean;
  pullRequests: PullRequest[];
}> {
  const requestId = Number(data?.requestId) || 0;
  const query = String(data?.query || "")
    .trim()
    .slice(0, 200);
  const empty = {
    requestId,
    supported: true,
    truncated: false,
    pullRequests: [],
  };
  if (query.length < 3) {
    return empty;
  }
  try {
    const gitProvider = await GitProvider.getInstance();
    if (!gitProvider) {
      return { ...empty, supported: false };
    }
    const result = await gitProvider.searchPullRequests(query, { limit: 20 });
    if (!result) {
      return { ...empty, supported: false };
    }
    return {
      requestId,
      supported: true,
      truncated: result.truncated === true,
      pullRequests: result.pullRequests || [],
    };
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Pull Request search failed: ${e?.message || e}`,
    );
    return empty;
  }
}

/**
 * True when sfdx-hardis refused a command line because it does not know one of its flags
 * (oclif: "Nonexistent flag: --with-workflows").
 */
export function isUnknownFlagError(message: string): boolean {
  return /nonexistent flags?\b|unknown flag|unexpected argument/i.test(
    String(message || ""),
  );
}

/**
 * Run sf hardis:project:action:list with these flags and the git provider credentials the command
 * runner also passes. Returns its JSON result, or null when the CLI cannot answer.
 */
async function runActionListJson(
  flags: string,
  purpose: string,
  onError?: (message: string) => void,
): Promise<any | null> {
  let env: Record<string, string> = {};
  try {
    env = await collectProviderCredentialEnvVars();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] ${purpose}: provider credentials not collected: ${e?.message || e}`,
    );
  }
  try {
    const result = await execSfdxJson(
      `sf hardis:project:action:list --with-status ${flags}`,
      {
        fail: false,
        output: false,
        debug: false,
        reuseRecentResult: false,
        env,
      },
    );
    if (result?.status === 0 && result?.result) {
      return result.result;
    }
    const message = String(
      result?.errorMessage || result?.message || "unknown error",
    );
    onError?.(message);
    Logger.log(`[vscode-sfdx-hardis] ${purpose} not available: ${message}`);
  } catch (e: any) {
    onError?.(String(e?.message || e));
    Logger.log(
      `[vscode-sfdx-hardis] ${purpose} not available: ${e?.message || e}`,
    );
  }
  return null;
}

/**
 * Status of the deployment actions of some Pull Requests in each org branch, read by sfdx-hardis
 * from the "Deployment Actions" Pull Request comments. In "Next promotion" mode, the same call also
 * returns the forecast of the promotion (forecastBranch, fromBranch): one CLI process for both.
 * Null statuses when the CLI cannot provide them (older version, no token): the panel then hides
 * the status column. The request id goes back so the panel can drop a late answer.
 */
async function loadDeploymentActionStatuses(data: any): Promise<{
  statuses: Record<string, any[]> | null;
  forecast?: any;
  workflows?: Record<string, any[]> | null;
  requestId: number;
}> {
  const requestId = Number(data?.requestId) || 0;
  // Pull Request numbers, and "draft" for the actions file of a branch without Pull Request
  const numbers = (Array.isArray(data?.prNumbers) ? data.prNumbers : []).filter(
    (prNumber: any) =>
      prNumber === "draft" || (Number.isInteger(prNumber) && prNumber > 0),
  );
  // Pull Request view: the validation, deployment and MegaLinter comments of the Pull Request
  // shown, read by the same sfdx-hardis process as the statuses, for that Pull Request only
  const workflowNumbers: number[] = (
    Array.isArray(data?.workflowPrNumbers) ? data.workflowPrNumbers : []
  ).filter((prNumber: any) => Number.isInteger(prNumber) && prNumber > 0);
  const withWorkflows = workflowNumbers.length > 0;
  // --with-status needs at least one Pull Request: a Pull Request without action still has runs
  if (numbers.length === 0) {
    numbers.push(...workflowNumbers);
  }
  if (numbers.length === 0) {
    return { statuses: {}, requestId };
  }
  const forecastBranch = String(data?.forecastBranch || "");
  const fromBranch = String(data?.fromBranch || "");
  const withForecast =
    /^[\w./-]+$/.test(forecastBranch) && /^[\w./-]+$/.test(fromBranch);
  const flags = (workflows: boolean) =>
    `--pr-ids ${numbers.join(",")}` +
    (workflows
      ? ` --with-workflows --workflow-pr-ids ${workflowNumbers.join(",")}`
      : "") +
    (withForecast
      ? ` --forecast ${forecastBranch} --from-branch ${fromBranch}`
      : "");
  let firstError = "";
  let result = await runActionListJson(
    flags(withWorkflows && !workflowsFlagRefused),
    "Deployment action statuses",
    (message) => {
      firstError = message;
    },
  );
  // A sfdx-hardis older than --with-workflows refuses the flag and answers nothing at all: the
  // statuses are asked again without it, so the Deployment Actions tab keeps its status column.
  // Remembered for the session, so the next Pull Request does not pay two CLI starts: but only
  // when the CLI said it does not know the flag. A throttled provider or a network error also
  // fails the first call, and giving the flag up for those would hide the Validation, Code
  // Quality and Deployment tabs until VS Code is reloaded.
  if (!result && withWorkflows && !workflowsFlagRefused) {
    result = await runActionListJson(
      flags(false),
      "Deployment action statuses (without workflows)",
    );
    if (result && isUnknownFlagError(firstError)) {
      workflowsFlagRefused = true;
    }
  }
  // gitProvider false: no git provider credentials, so the Pull Request comments were not read.
  // Hide the column rather than show every action as "Not run yet"
  if (!result || result.gitProvider === false || !result.statuses) {
    return {
      statuses: null,
      ...(withForecast ? { forecast: null } : {}),
      ...(withWorkflows ? { workflows: result?.workflows || null } : {}),
      requestId,
    };
  }
  return {
    statuses: result.statuses,
    ...(withForecast ? { forecast: result.forecast || null } : {}),
    // null with a CLI older than --with-workflows: the panel then hides its Workflows tab
    ...(withWorkflows ? { workflows: result.workflows || null } : {}),
    requestId,
  };
}

/**
 * The rows of the Backpromotes comment of one Pull Request: the deployment actions run in each
 * developer org, read by sfdx-hardis when a status is expanded in the Deployment Actions tab.
 */
async function loadDeploymentActionBackpromotes(
  prNumber: number,
): Promise<any[]> {
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    return [];
  }
  const result = await runActionListJson(
    `--with-backpromotes --pr-ids ${prNumber}`,
    "Deployment action backpromotes",
  );
  const rows = result?.backpromotes?.[String(prNumber)];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Record a failed or stopped deployment action as done by hand, in the background: the value of
 * every flag comes from the panel, so nothing is asked, and the user only needs the outcome.
 */
async function markDeploymentActionDone(
  data: any,
): Promise<{ ok: boolean; statuses?: Record<string, any[]> }> {
  const prNumber = Number(data?.prNumber);
  // Passed to a command line: refused below unless it only holds plain characters
  const actionId = String(data?.actionId || "");
  const orgBranch = String(data?.orgBranch || "");
  const label = String(data?.label || actionId);
  if (
    !Number.isInteger(prNumber) ||
    prNumber < 1 ||
    !/^[\w .:@/+-]+$/.test(actionId) ||
    !/^[\w./-]+$/.test(orgBranch)
  ) {
    return { ok: false };
  }
  let env: Record<string, string> = {};
  try {
    env = await collectProviderCredentialEnvVars();
  } catch (e: any) {
    Logger.log(
      `[vscode-sfdx-hardis] Mark as done: provider credentials not collected: ${e?.message || e}`,
    );
  }
  // No progress notification and no success message: the button of the panel
  // spins, then the status of the action turns to Done
  const result = await execSfdxJson(
    `sf hardis:project:action:set-status --agent --pr ${prNumber} --action-id "${actionId}" --org-branch ${orgBranch} --status success`,
    {
      fail: false,
      output: false,
      debug: false,
      reuseRecentResult: false,
      env,
    } as any,
  );
  if (result?.status === 0) {
    // sfdx-hardis answers with the statuses of the Pull Request after its write: the panel shows
    // them as they are. Reading them back with action:list costs a second start of the CLI, as
    // long as the write itself. An older sfdx-hardis answers without them, and the panel asks.
    const statuses = result?.result?.statuses;
    return statuses && typeof statuses === "object"
      ? { ok: true, statuses }
      : { ok: true };
  } else {
    vscode.window.showErrorMessage(
      t("deploymentActionMarkDoneError", {
        label,
        message: result?.errorMessage || result?.message || "unknown error",
      }),
    );
  }
  return { ok: false };
}
