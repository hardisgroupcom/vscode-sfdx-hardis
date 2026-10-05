#!/usr/bin/env node

/**
 * Captures the GitHub beat of the DevOps Pipeline showcase GIF
 * (docs/assets/images/sfdx-hardis-pipeline-view.gif in sfdx-hardis): the diff of a
 * real Pull Request, then the click that merges it.
 *
 * The harness of `yarn screenshots` only drives VS Code, with no network. These
 * pages are real GitHub pages, taken once from a throwaway private repository and
 * committed as stills in test/fixtures/screenshot/showcase/github, so the GIF can
 * be recorded again offline. Run this script only to refresh them.
 *
 * What it does:
 *   1. Creates the private repository when it is missing (gh), and pushes
 *      test/fixtures/screenshot/showcase/repo/base to main and integration.
 *   2. Pushes repo/feature on a feature branch and opens a Pull Request to
 *      integration. A merged Pull Request cannot be merged again, so every run
 *      opens a new one.
 *   3. Drives one tab of an already running Chrome over the DevTools Protocol
 *      (started with --remote-debugging-port=9222 and signed in to GitHub),
 *      takes the stills and clicks "Merge pull request". It opens its own tab and
 *      closes that tab only.
 *
 * The stills show the MyCompany-CRM universe of the documentation: the owner, the
 * repository name and the Pull Request number are rewritten in the page before
 * each capture. The author stays the account that ran the script.
 *
 * Usage:
 *   node scripts/capture-github-merge.js
 *
 * Environment:
 *   SHOWCASE_REPO   name of the throwaway repository (sfdx-hardis-showcase-pr)
 *   CDP_URL         debugging endpoint of Chrome (http://127.0.0.1:9222)
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const WebSocket = require("ws");

const repoRoot = path.resolve(__dirname, "..");
const SHOWCASE_DIR = path.join(
  repoRoot,
  "test",
  "fixtures",
  "screenshot",
  "showcase",
);
const OUT_DIR = path.join(SHOWCASE_DIR, "github");
const REPO = process.env.SHOWCASE_REPO || "sfdx-hardis-showcase-pr";
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

// What the stills show instead of the throwaway repository
const SHOWN_OWNER = "mycompany";
const SHOWN_REPO = "salesforce-crm";
const SHOWN_PR_NUMBER = 130;
const FEATURE_BRANCH = "feature/CRM-1070-agentforce-case-triage";
const PR_TITLE = "CRM-1070 Agentforce case triage agent";
const PR_BODY = [
  "A Case Triage agent reads every new case, finds its category and sends it to the right queue.",
  "",
  "- New agent `Case_Triage_Agent` and its permission set",
  "- `CaseTriageService` can be called by the agent",
  "",
  "Agentforce must be activated before the deployment, and the agent after it:",
  "both are declared as deployment actions.",
].join("\n");

// Size of a still, in device pixels: the panel of a harness recording, once the title bar and
// the side bar are cropped out (see CAPTURE_WIDTH and SIDE_BAR_WIDTH in src/test/ui)
const DEVICE_SCALE_FACTOR = 1.25;
const STILL_WIDTH = 1485;
const STILL_HEIGHT = 982;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyDir(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

/** Repository, branches and a fresh Pull Request. Returns its owner and number. */
function preparePullRequest() {
  const owner = run("gh", ["api", "user", "-q", ".login"]);
  const slug = `${owner}/${REPO}`;
  try {
    run("gh", ["repo", "view", slug, "--json", "name"]);
  } catch {
    console.log(`Creating the private repository ${slug}`);
    run("gh", [
      "repo",
      "create",
      slug,
      "--private",
      "--description",
      "Throwaway repository of the vscode-sfdx-hardis documentation captures",
    ]);
  }
  // A run that stopped before its merge left its Pull Request open
  const open = JSON.parse(
    run("gh", ["pr", "list", "--repo", slug, "--json", "number"]) || "[]",
  );
  for (const pullRequest of open) {
    run("gh", ["pr", "close", String(pullRequest.number), "--repo", slug]);
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfh-showcase-"));
  const git = (...args) => run("git", args, { cwd: workDir });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", `https://github.com/${slug}.git`);
  copyDir(path.join(SHOWCASE_DIR, "repo", "base"), workDir);
  git("add", "-A");
  git("commit", "-q", "-m", "Initial project");
  // Both branches start again from the same commit: the Pull Request of a
  // previous run is merged, and its changes must be a diff again
  git("push", "-q", "--force", "origin", "main");
  git("push", "-q", "--force", "origin", "main:integration");
  git("checkout", "-q", "-b", FEATURE_BRANCH);
  copyDir(path.join(SHOWCASE_DIR, "repo", "feature"), workDir);
  git("add", "-A");
  git("commit", "-q", "-m", PR_TITLE);
  git("push", "-q", "--force", "origin", FEATURE_BRANCH);
  const url = run("gh", [
    "pr",
    "create",
    "--repo",
    slug,
    "--base",
    "integration",
    "--head",
    FEATURE_BRANCH,
    "--title",
    PR_TITLE,
    "--body",
    PR_BODY,
  ]);
  fs.rmSync(workDir, { recursive: true, force: true });
  const number = Number(url.split("/").pop());
  console.log(`Pull Request ${url}`);
  return { owner, number, url };
}

/** One tab of the running Chrome, driven over the DevTools Protocol */
class Tab {
  static async open(url) {
    const response = await fetch(
      `${CDP_URL}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT" },
    );
    const target = await response.json();
    const tab = new Tab(target);
    await tab.connect();
    return tab;
  }

  constructor(target) {
    this.target = target;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.target.webSocketDebuggerUrl, {
        perMessageDeflate: false,
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      const waiting = this.pending.get(message.id);
      if (!waiting) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiting.reject(new Error(message.error.message));
      } else {
        waiting.resolve(message.result);
      }
    });
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: Math.round(STILL_WIDTH / DEVICE_SCALE_FACTOR),
      height: Math.round(STILL_HEIGHT / DEVICE_SCALE_FACTOR),
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      mobile: false,
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result?.result?.value;
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await sleep(1500);
    await this.waitFor("document.readyState === 'complete'", "page load");
    await sleep(2500);
  }

  async waitFor(expression, what, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await this.evaluate(expression).catch(() => null);
      if (value) {
        return value;
      }
      await sleep(400);
    }
    throw new Error(`Timeout waiting for ${what}`);
  }

  /** Center of a visible button, in device pixels of a still, scrolled into view first */
  async buttonPoint(text) {
    const find = `(() => {
      const wanted = ${JSON.stringify(text)};
      const element = [...document.querySelectorAll("button, summary, a")].find(
        (candidate) =>
          candidate.textContent.trim() === wanted &&
          candidate.getClientRects().length > 0 &&
          !candidate.disabled,
      );
      if (!element) {
        return null;
      }
      element.scrollIntoView({ block: "center" });
      return true;
    })()`;
    await this.waitFor(find, `the "${text}" button`);
    await sleep(800);
    const point = await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(text)};
      const element = [...document.querySelectorAll("button, summary, a")].find(
        (candidate) =>
          candidate.textContent.trim() === wanted &&
          candidate.getClientRects().length > 0,
      );
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        box: [rect.x - 6, rect.y - 6, rect.width + 12, rect.height + 12],
      };
    })()`);
    return {
      x: Math.round(point.x * DEVICE_SCALE_FACTOR),
      y: Math.round(point.y * DEVICE_SCALE_FACTOR),
      // The frame the caption of the still is drawn around
      box: point.box.map((value) => Math.round(value * DEVICE_SCALE_FACTOR)),
    };
  }

  async click(point) {
    const x = point.x / DEVICE_SCALE_FACTOR;
    const y = point.y / DEVICE_SCALE_FACTOR;
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
    }
  }

  /** The owner in the page header only (the author keeps their name), the rest everywhere */
  async showUniverse(owner, number) {
    await this.evaluate(`(() => {
      const replaceIn = (root, pairs) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          let value = node.nodeValue;
          for (const [from, to] of pairs) {
            if (value.includes(from)) {
              value = value.split(from).join(to);
            }
          }
          if (value !== node.nodeValue) {
            node.nodeValue = value;
          }
        }
      };
      // The header of the site only: the header of the Pull Request names its author
      const siteHeader =
        document.querySelector("header[role='banner'], .AppHeader") ||
        document.querySelector("header");
      if (siteHeader) {
        replaceIn(siteHeader, [[${JSON.stringify(owner)}, ${JSON.stringify(SHOWN_OWNER)}]]);
      }
      replaceIn(document.body, [
        [${JSON.stringify(REPO)}, ${JSON.stringify(SHOWN_REPO)}],
        ["#${number}", "#${SHOWN_PR_NUMBER}"],
      ]);
      // The number next to the title is split over several nodes
      const numbered = [...document.body.querySelectorAll("*")].filter(
        (element) => element.textContent.trim() === "#${number}",
      );
      for (const element of numbered) {
        if (!numbered.some((other) => other !== element && element.contains(other))) {
          element.textContent = "#${SHOWN_PR_NUMBER}";
        }
      }
      // The merge commit title names the owner and the number, in a field
      for (const field of document.querySelectorAll("input[type='text'], textarea")) {
        const value = field.value
          .split("#${number} ").join("#${SHOWN_PR_NUMBER} ")
          .split(${JSON.stringify(owner + "/")}).join(${JSON.stringify(SHOWN_OWNER + "/")});
        if (value !== field.value) {
          field.value = value;
        }
      }
      // No personal e-mail address in a documentation image
      for (const option of document.querySelectorAll("select option")) {
        if (option.textContent.includes("@")) {
          option.textContent = ${JSON.stringify(owner + "@users.noreply.github.com")};
        }
      }
    })()`);
  }

  async still(name, owner, number) {
    await this.showUniverse(owner, number);
    await sleep(300);
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const file = path.join(OUT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(result.data, "base64"));
    console.log(`  ${file}`);
    return `${name}.png`;
  }

  async close() {
    this.socket.close();
    await fetch(`${CDP_URL}/json/close/${this.target.id}`).catch(() => {});
  }
}

async function main() {
  const { owner, number, url } = preparePullRequest();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // GitHub needs a moment before the diff and the merge box of a new Pull Request are ready
  await sleep(6000);
  const tab = await Tab.open("about:blank");
  const stills = [];
  try {
    await tab.goto(`${url}/files`);
    stills.push({
      file: await tab.still("1-files-changed", owner, number),
      ms: 3400,
      caption: { text: "Reviewed in your git provider, as any Pull Request" },
    });

    await tab.goto(url);
    // The still shows a Pull Request ready to merge: its checks are over
    await tab
      .waitFor(
        `document.body.innerText.includes("All checks have passed")`,
        "the checks",
        180000,
      )
      .catch(() => console.log("  the checks did not all pass in 3 minutes"));
    const merge = await tab.buttonPoint("Merge pull request");
    stills.push({
      file: await tab.still("2-merge-box", owner, number),
      ms: 3200,
      click: { x: merge.x, y: merge.y },
      caption: {
        text: "Merge when the checks are green",
        box: merge.box,
        side: "below",
      },
    });
    await tab.click(merge);

    const confirm = await tab.buttonPoint("Confirm merge");
    stills.push({
      file: await tab.still("3-confirm-merge", owner, number),
      ms: 2400,
      click: { x: confirm.x, y: confirm.y },
      caption: { text: "Confirm the merge", box: confirm.box, side: "right" },
    });
    await tab.click(confirm);

    await tab.waitFor(
      `document.body.innerText.includes("Pull request successfully merged and closed")`,
      "the merge",
      60000,
    );
    await sleep(2000);
    stills.push({
      file: await tab.still("4-merged", owner, number),
      ms: 3200,
      caption: { text: "Merged: your CI/CD pipeline takes over" },
    });
  } finally {
    await tab.close();
  }
  fs.writeFileSync(
    path.join(OUT_DIR, "timeline.json"),
    `${JSON.stringify({ width: STILL_WIDTH, height: STILL_HEIGHT, stills }, null, 2)}\n`,
  );
  console.log(`Merged ${url}, ${stills.length} stills in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
