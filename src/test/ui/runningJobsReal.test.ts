import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension, recordSentMessages, waitFor } from "./uiTestUtils";
import { CdpWindow, captureWindowTo, inWebview } from "./cdpWindow";

/**
 * The jobs still running in the Pull Request view against a REAL git provider: which jobs a
 * provider lists for a pipeline that is going on, what they are named and where their link
 * leads is about what the provider answers, which no mock can tell.
 *
 * It only reads. The job has to be running when the suite starts: start it first (a commit on
 * the Pull Request, a re-run of its checks, a merge), then run the suite while it is going on.
 *
 *   SFDX_HARDIS_REAL_RUNNING_JOBS=true
 *   SFDX_HARDIS_LAB_WORKSPACE             a clone of the repository, opened as the workspace
 *   SFDX_HARDIS_REAL_RUNNING_JOBS_PR      number of the Pull Request
 *   SFDX_HARDIS_REAL_RUNNING_JOBS_EXPECT  kinds that must be found, comma separated
 *                                         (validation, codeQuality, deployment). Empty when
 *                                         only the journey of a carried story is checked
 *   SFDX_HARDIS_REAL_RUNNING_JOBS_CARRIED optional "<story number>:<carrier number>", a merged
 *                                         story and the Pull Request that took it to a later
 *                                         branch: its journey must name it
 *   SFDX_HARDIS_REAL_RUNNING_JOBS_DURATIONS optional tabs (validation, megalinter, deployment),
 *                                         comma separated, whose finished job must say how long
 *                                         it took
 *   SFDX_HARDIS_REAL_RUNNING_JOBS_SHOTS   optional folder for captures of the panel
 *   plus the token of the provider in the environment (GITHUB_TOKEN...)
 *
 *   yarn dev && yarn compile && node ./out/test/runUiTest.js
 */

const REAL_MODE = process.env.SFDX_HARDIS_REAL_RUNNING_JOBS === "true";
const LWC_ID = "s-pipeline";
const WAIT_FOR_JOB_MS = 300000;
const TAB_OF_KIND: Record<string, string> = {
  validation: "validation",
  codeQuality: "megalinter",
  deployment: "deployment",
};

suite("Running jobs on a real git provider", function () {
  this.timeout(WAIT_FOR_JOB_MS * 4);

  let panelManager: any;
  let panel: any;
  let sent: any[] = [];
  let jobs: any[] = [];
  const prNumber = Number(process.env.SFDX_HARDIS_REAL_RUNNING_JOBS_PR || "");
  const expected = (process.env.SFDX_HARDIS_REAL_RUNNING_JOBS_EXPECT || "")
    .split(",")
    .map((kind) => kind.trim())
    .filter(Boolean);
  const shotsDir = process.env.SFDX_HARDIS_REAL_RUNNING_JOBS_SHOTS || "";

  const openView = async (tab: string) => {
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline", {
      focus: "pullRequest",
      prNumber,
      tab,
    });
  };

  // What the tab shown says of its running jobs, read in the webview itself
  const runningRows = () =>
    inWebview(`
      const rows = deepAll(panelDocument, ".hardis-list")
        .filter((row) => row.offsetParent !== null)
        .filter((row) => row.querySelector(".hardis-status-running, .hardis-status-pending"))
        .filter((row) => !row.querySelector(".hardis-list-detail"))
        .map((row) => ({
          title: (row.querySelector(".hardis-list-title") || {}).textContent || "",
          meta: (row.querySelector(".hardis-list-meta") || {}).textContent || "",
          status: (row.querySelector(".hardis-pill") || {}).textContent || "",
          url: (row.querySelector("button[data-url]") || { dataset: {} }).dataset.url || "",
          bar: !!row.querySelector(".hardis-progress-track.indeterminate"),
        }));
      return rows.length > 0 ? rows : null;
    `);

  const journeySteps = () =>
    inWebview(`
      const steps = deepAll(panelDocument, ".hardis-path-step")
        .filter((step) => step.offsetParent !== null)
        .map((step) => ({
          text: step.textContent.replace(/\\s+/g, " ").trim(),
          classes: step.className,
          animation: getComputedStyle(step).animationName,
        }));
      return steps.length > 0 ? steps : null;
    `);

  suiteSetup(async function () {
    if (!REAL_MODE) {
      this.skip();
    }
    assert.ok(
      prNumber > 0,
      "SFDX_HARDIS_REAL_RUNNING_JOBS_PR must be a Pull Request number",
    );
    assert.ok(
      expected.every((kind) => TAB_OF_KIND[kind]),
      "SFDX_HARDIS_REAL_RUNNING_JOBS_EXPECT names the kinds to find",
    );
    const api = await activateExtension();
    panelManager = api.getLwcPanelManager();
  });

  test("the git provider lists the jobs going on, each one with its kind and its page", async function () {
    // Nothing is running: only the journey of a carried story is checked
    if (expected.length === 0) {
      this.skip();
    }
    await openView(TAB_OF_KIND[expected[0]]);
    panel = await waitFor(
      () => panelManager.getPanel(LWC_ID),
      60000,
      "the pipeline panel to open",
    );
    sent = recordSentMessages(panel);
    // The panel asks for them once the Pull Request is shown, with the branches of its path:
    // its own request is the one read here, so the branches are the ones the panel worked out
    const describeAnswers = setInterval(() => {
      const answers = sent.filter(
        (message) => message?.type === "returnPullRequestRunningJobs",
      );
      const last = answers[answers.length - 1];
      console.log(
        `      ${answers.length} answer(s) so far, last: ${JSON.stringify(last?.data || null)}`,
      );
      const types: Record<string, number> = {};
      for (const message of sent) {
        types[message?.type] = (types[message?.type] || 0) + 1;
      }
      console.log(`      sent to the panel: ${JSON.stringify(types)}`);
      void inWebview(`
        return {
          modal: deepAll(panelDocument, ".slds-modal").length,
          steps: deepAll(panelDocument, ".hardis-path-step").length,
          title: (deepAll(panelDocument, ".slds-modal__title")[0] || {}).textContent || "",
          spinner: deepAll(panelDocument, "lightning-spinner").length,
        };
      `).then((state) => console.log(`      panel: ${JSON.stringify(state)}`));
    }, 30000);
    const answer = await waitFor<any>(
      () => {
        const answers = sent.filter(
          (message) =>
            message?.type === "returnPullRequestRunningJobs" &&
            message?.data?.prNumber === prNumber,
        );
        const last = answers[answers.length - 1];
        const found = last
          ? [
              ...(last.data.pullRequest || []),
              ...Object.values<any[]>(last.data.branches || {}).flat(),
            ]
          : [];
        return expected.every((kind) =>
          found.some((job: any) => job.kind === kind),
        )
          ? last
          : null;
      },
      WAIT_FOR_JOB_MS,
      `running jobs of kind ${expected.join(", ")}`,
    ).finally(() => clearInterval(describeAnswers));
    jobs = [
      ...(answer.data.pullRequest || []).map((job: any) => ({
        ...job,
        where: "pull request",
      })),
      ...Object.entries<any[]>(answer.data.branches || {}).flatMap(
        ([branch, list]) => list.map((job) => ({ ...job, where: branch })),
      ),
    ];
    for (const job of jobs) {
      console.log(
        `      [${job.where}] ${job.kind} ${job.status} "${job.name}"${job.parentName ? ` of "${job.parentName}"` : ""} started ${job.startedAt} ${job.webUrl}`,
      );
      assert.match(String(job.webUrl), /^https?:\/\//, "a job has its page");
      assert.ok(["running", "pending"].includes(job.status), job.status);
      assert.ok(
        ["validation", "codeQuality", "deployment"].includes(job.kind),
        job.kind,
      );
      assert.strictEqual("raw" in job, false, "no provider payload");
    }
  });

  test("each tab shows its running job above the comments, with the link to the job", async function () {
    if (!CdpWindow.portFromEnv() || expected.length === 0) {
      this.skip();
    }
    for (const kind of expected) {
      const urls = jobs
        .filter((job) => job.kind === kind)
        .map((job) => job.webUrl);
      await openView(TAB_OF_KIND[kind]);
      // The tab takes a moment to replace the one shown before: the rows are the ones of this
      // tab once one of them links to a job of its kind
      const rows: any[] = await waitFor<any>(
        async () => {
          const found = await runningRows();
          return Array.isArray(found) &&
            found.some((row: any) => urls.includes(row.url))
            ? found
            : null;
        },
        WAIT_FOR_JOB_MS,
        `the ${kind} tab to link to the job the provider listed`,
      );
      for (const row of rows) {
        console.log(
          `      ${kind} tab: "${row.title}" | ${row.meta} | ${row.status} | ${row.url} | bar ${row.bar}`,
        );
      }
      // The job says for how long it has been going on, and the count moves
      const elapsedOf = (found: any[]) =>
        (found || []).find((row: any) => urls.includes(row.url))?.meta || "";
      assert.match(elapsedOf(rows), /\d+s elapsed/, "elapsed time of the job");
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const later = elapsedOf(await runningRows());
      console.log(`      ${kind} tab, 2.5 seconds later: ${later}`);
      assert.match(later, /\d+s elapsed/);
      assert.notStrictEqual(later, elapsedOf(rows), "the elapsed time moves");
      // Give the tab the time to be drawn before it is captured
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await captureWindowTo(shotsDir, `running-jobs-${kind}`);
    }
  });

  test("the step of the journey moves while its job is going on", async function () {
    if (!CdpWindow.portFromEnv() || expected.length === 0) {
      this.skip();
    }
    const steps: any[] = await waitFor<any>(
      async () => {
        const found = await journeySteps();
        return Array.isArray(found) &&
          found.some((step: any) => /hardis-path-moving/.test(step.classes))
          ? found
          : null;
      },
      WAIT_FOR_JOB_MS,
      "a moving step",
    );
    for (const step of steps) {
      console.log(
        `      step "${step.text}" ${step.classes} animation=${step.animation}`,
      );
    }
    const moving = steps.filter((step) =>
      /hardis-path-moving/.test(step.classes),
    );
    for (const step of moving) {
      assert.strictEqual(step.animation, "hardis-path-sweep");
    }
    // A check moves the validation step, a deployment moves the step of its branch
    assert.strictEqual(
      moving.some((step) => /^Validation/.test(step.text)),
      expected.some((kind) => kind !== "deployment"),
    );
  });

  test("a finished job says how long it took", async function () {
    const tabs = (process.env.SFDX_HARDIS_REAL_RUNNING_JOBS_DURATIONS || "")
      .split(",")
      .map((tab) => tab.trim())
      .filter(Boolean);
    if (tabs.length === 0 || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    for (const tab of tabs) {
      await openView(tab);
      panel = await waitFor(
        () => panelManager.getPanel(LWC_ID),
        60000,
        "the pipeline panel to open",
      );
      if (sent.length === 0) {
        sent = recordSentMessages(panel);
      }
      const rows: any[] = await waitFor<any>(
        async () => {
          // The webview of a panel that just opened may not answer yet
          const found = await inWebview(`
            const rows = deepAll(panelDocument, ".hardis-list")
              .filter((row) => row.offsetParent !== null)
              .filter((row) => !row.querySelector(".hardis-status-running, .hardis-status-pending"))
              .map((row) => ({
                title: (row.querySelector(".hardis-list-title") || {}).textContent || "",
                meta: (row.querySelector(".hardis-list-meta") || {}).textContent || "",
                status: (row.querySelector(".hardis-pill") || {}).textContent || "",
                url: (row.querySelector("button[data-url]") || { dataset: {} }).dataset.url || "",
              }));
            return rows.length > 0 ? rows : null;
          `).catch(() => null);
          return Array.isArray(found) &&
            // The rows are the ones of this tab once their title says so
            found.some(
              (row: any) =>
                /Duration (\d+h )?(\d+m )?\d+s/.test(row.meta) &&
                row.title
                  .toLowerCase()
                  .startsWith(tab === "megalinter" ? "megalinter" : tab),
            )
            ? found
            : null;
        },
        WAIT_FOR_JOB_MS / 2,
        `a finished job with its duration in the ${tab} tab`,
      );
      for (const row of rows) {
        console.log(
          `      ${tab} tab: "${row.title}" | ${row.meta} | ${row.status} | ${row.url}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await captureWindowTo(shotsDir, `job-duration-${tab}`);
    }
    for (const message of sent.filter(
      (item) => item?.type === "returnJobDurations",
    )) {
      console.log(`      durations: ${JSON.stringify(message.data.durations)}`);
    }
  });

  test("the journey of a carried story names the Pull Request that carried it", async function () {
    const [story, carrier] = (
      process.env.SFDX_HARDIS_REAL_RUNNING_JOBS_CARRIED || ""
    )
      .split(":")
      .map(Number);
    if (!(story > 0) || !(carrier > 0) || !CdpWindow.portFromEnv()) {
      this.skip();
    }
    await vscode.commands.executeCommand("vscode-sfdx-hardis.showPipeline", {
      focus: "pullRequest",
      prNumber: story,
      tab: "general",
    });
    const steps: any[] = await waitFor<any>(
      async () => {
        const found = await journeySteps();
        return Array.isArray(found) &&
          found.some((step: any) => step.text.includes(`#${carrier}`))
          ? found
          : null;
      },
      WAIT_FOR_JOB_MS / 2,
      `a step naming #${carrier}`,
    );
    for (const step of steps) {
      console.log(`      step "${step.text}" ${step.classes}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await captureWindowTo(shotsDir, `journey-carried-${story}`);
  });
});
