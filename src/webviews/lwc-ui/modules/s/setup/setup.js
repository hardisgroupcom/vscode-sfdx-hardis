import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

// Status of a dependency -> hue of its .hardis-tile, so the accent of the card
// and the color of its icon always tell the same story (global-theme.css kit)
const STATE_TILE_HUE = {
  ok: "green",
  warning: "amber",
  error: "red",
  info: "cyan",
  neutral: "slate",
};

export default class Setup extends SharedMixin(LightningElement) {
  @track checks = [];
  @track summaryMessage = "";
  @track summaryClass = "info";
  _pendingCheckResolvers = {};
  _autoUpdateDependencies = false;

  // The panel paints before `initialize` comes back from the extension, so the
  // summary starts in the "checking" state rather than falling back to a static
  // gear icon with no message. updateSummary() takes over from the first result.
  _summaryChecking = true;
  _summaryIconName = "utility:sync";
  _summaryState = "neutral";

  // Control visibility of the top-right settings (hide on scroll)
  // (no fixed-position behaviour needed; toggle will live inside header)

  connectedCallback() {
    super.connectedCallback();
    this.summaryMessage = this.t("checkInProgress");
    // Request initialization data (UI should render the list immediately)
    window.sendMessageToVSCode({ type: "requestSetupInit" });
  }

  /**
   * True until the extension has sent the dependency list. The grid is empty in
   * that window, so it shows a spinner instead of a blank page.
   */
  get isLoadingChecks() {
    return !this.checks || this.checks.length === 0;
  }

  @api
  handleMessage(type, data) {
    console.log("Setup component received message:", type, data);
    if (type === "initialize") {
      // Render the static list first (no checking yet) so the UI paints quickly
      this._autoUpdateDependencies =
        data && data.autoUpdateDependencies === true;
      // Full refresh: give auto-update a fresh chance on every re-check cycle
      // (a previous failure may have been fixed outside the panel since)
      this._autoInstallAttemptedIds = new Set();
      this.checks = data.checks.map((c) => ({
        ...c,
        explanation: c.explanation || "",
        installable: typeof c.installable === "boolean" ? c.installable : true,
        uninstallable: c.uninstallable === true,
        prerequisites: c.prerequisites || [],
        checking: false, // per-item checking state
        installed: false,
        hasChecked: false, // becomes true after first checkResult for the item
        upgradeAvailable: false,
        version: c.version || "",
        installing: false,
        uninstalling: false,
      }));

      // compute prerequisites/installDisabled after initial mapping
      this._recomputePrerequisites();

      // Defer starting checks to next tick so the rendered list is visible before heavy checks start
      // Start checks in parallel for each item
      Promise.resolve().then(() => {
        this.checks.forEach((chk) => this._startCheck(chk.id));
      });
    }
    // Receive check result
    else if (type === "checkResult") {
      const { id, res } = data || {};
      // Determine status from res.status (preferred). Fallback to installed flag.
      const status =
        (res && res.status) || (res && res.installed ? "ok" : "missing");

      // update canonical state only; visuals are derived in _updateDependencyCardsState
      this.checks = this.checks.map((c) => {
        if (c.id === id) {
          const upgradeAvailable = !!(
            res &&
            (res.upgradeAvailable === true || status === "outdated")
          );
          const installed = status === "ok" || status === "outdated";
          return {
            ...c,
            ...res,
            status,
            checking: false,
            installing: false,
            uninstalling: false,
            hasChecked: true,
            upgradeAvailable,
            installed,
          };
        }
        return c;
      });

      this.checks = [...this.checks]; // trigger reactivity

      // If someone is waiting for this id's check to complete (install flow), resolve it
      if (this._pendingCheckResolvers && this._pendingCheckResolvers[id]) {
        try {
          this._pendingCheckResolvers[id]({ id, res });
        } catch (e) {
          // ignore
        }
        delete this._pendingCheckResolvers[id];
      }

      // recompute prerequisites and derived display state after the status change
      this._recomputePrerequisites();
    }
    // Receive install result
    else if (type === "installResult") {
      const { id, res } = data || {};
      // The install was never attempted (another update was already running):
      // let auto-update retry it instead of burning its one attempt
      if (res && res.reason === "alreadyRunning") {
        this._autoInstallAttemptedIds.delete(id);
      }
      // After install, re-run the single check to refresh its status
      this._startCheck(id);
    }
    // Receive uninstall result
    else if (type === "uninstallResult") {
      const { id, res } = data || {};
      this._startCheck(id);
    } else if (type === "refresh") {
      // Refresh the entire setup state (e.g. after changing a config)
      if (
        !this.checks.some(
          (c) =>
            c.checking ||
            c.installing ||
            this.installQueueRunning ||
            this._summaryChecking,
        )
      ) {
        window.sendMessageToVSCode({ type: "requestSetupInit" });
      }
    }
  }

  // Handler for the header toggle change to persist setting in the host extension
  handleAutoUpdateChange(event) {
    const newValue = event.target.checked;
    this._autoUpdateDependencies = newValue;
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "vsCodeSfdxHardis.autoUpdateDependencies",
        value: newValue,
      },
    });
    // Refresh setup data shortly after change so UI reflects updated config if needed
    setTimeout(() => {
      window.sendMessageToVSCode({ type: "requestSetupInit" });
    }, 3000);
  }

  _startCheck(id) {
    // Set checking=true for the specific item and emit a check request
    this.checks = this.checks.map((c) =>
      c.id === id
        ? {
            ...c,
            checking: true,
          }
        : c,
    );
    // update derived button labels/disabled state so UI reflects checking immediately
    this._updateDependencyCardsState();
    window.sendMessageToVSCode({ type: "checkDependency", data: { id } });
  }

  handleInstall(e) {
    const id = e.currentTarget.dataset.id;
    // mark checking while install happens (will trigger re-check when installResult arrives)
    this.checks = this.checks.map((c) =>
      c.id === id ? { ...c, checking: false, installing: true, status: "" } : c,
    );
    // ensure buttons reflect checking state immediately
    this._updateDependencyCardsState();
    window.sendMessageToVSCode({ type: "installDependency", data: { id } });
  }

  handleUninstall(e) {
    const id = e.currentTarget.dataset.id;
    this.checks = this.checks.map((c) =>
      c.id === id
        ? { ...c, checking: false, uninstalling: true, status: "" }
        : c,
    );
    this._updateDependencyCardsState();
    window.sendMessageToVSCode({ type: "uninstallDependency", data: { id } });
  }

  handleInstructions(e) {
    const id = e.currentTarget.dataset.id;
    window.sendMessageToVSCode({
      type: "showInstructions",
      data: {
        id: id,
        check: JSON.parse(JSON.stringify(this.checks.find((c) => c.id === id))),
      },
    });
  }

  // Unified handler for button actions driven by per-check `buttonAction`
  handleUnifiedAction(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    if (!action) return;
    if (action === "install") {
      // reuse existing install flow
      this.handleInstall({ currentTarget: { dataset: { id } } });
    } else if (action === "recheck") {
      this.handleCheck({ currentTarget: { dataset: { id } } });
    } else if (action === "instructions") {
      this.handleInstructions({ currentTarget: { dataset: { id } } });
    }
  }

  handleCheck(e) {
    const id = e.currentTarget.dataset.id;
    this._startCheck(id);
  }

  // Returns true if all prerequisites (array of ids) are installed
  _prerequisitesMatched(prereqArray) {
    if (!prereqArray || prereqArray.length === 0) return true;
    // Map current checks to a lookup by id
    const lookup = this.checks.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});
    return prereqArray.every((p) => lookup[p] && lookup[p].installed === true);
  }

  // Recompute installDisabled and prerequisitesMatched flags for all checks
  _recomputePrerequisites() {
    // build lookup for checks by id (for installed flag and friendly label)
    const lookup = this.checks.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});

    this.checks = this.checks.map((c) => {
      const prereqArray = Array.isArray(c.prerequisites) ? c.prerequisites : [];
      const matched = this._prerequisitesMatched(prereqArray);
      // candidates that are not installed yet
      const missingCandidates = prereqArray.filter(
        (p) => !(lookup[p] && lookup[p].installed === true),
      );
      // only consider a prerequisite "missing" for user hint if that prerequisite has been checked already
      const missing = missingCandidates.filter(
        (p) => lookup[p] && lookup[p].hasChecked === true,
      );
      const missingFriendly = missing
        .map((p) => (lookup[p] && lookup[p].label ? lookup[p].label : p))
        .join(", ");
      const missingText = missingFriendly.length > 0 ? missingFriendly : null;

      return {
        ...c,
        prerequisitesMatched: matched,
        // keep install disabled while this item is checking, or until prerequisites are matched
        installDisabled: !!c.checking || !matched,
        missingPrerequisites: missing,
        missingPrerequisitesText: missingText,
      };
    });

    // compute a global summary message and class for the top banner
    const anyChecking = this.checks.some((c) => c.checking === true);
    const anyHasChecked = this.checks.some((c) => c.hasChecked === true);
    const anyMissing =
      this.checks.some(
        (c) => c.missingPrerequisites && c.missingPrerequisites.length > 0,
      ) || this.checks.some((c) => c.status === "missing");
    const anyOutdated = this.checks.some(
      (c) => c.upgradeAvailable === true || c.status === "outdated",
    );

    // If we haven't received any check result yet, consider the summary as checking so we don't show "You are all set"
    if (!anyHasChecked) {
      this.summaryMessage = this.t("checkInProgress");
      this.summaryClass = "info";
      this._summaryChecking = true;
      this._summaryIconName = "utility:sync";
      this._summaryState = "neutral";
    } else {
      if (anyChecking) {
        this.summaryMessage = this.t("checkInProgress");
        this.summaryClass = "info";
      } else if (anyMissing) {
        this.summaryMessage = this.t("missingDependencies");
        this.summaryClass = "warning";
      } else if (anyOutdated) {
        this.summaryMessage = this.t("outdatedDependencies");
        this.summaryClass = "warning";
      } else {
        this.summaryMessage = this.t("youAreAllSet");
        this.summaryClass = "success";
      }

      // Expose summary-level checking flag (true if any item is checking)
      this._summaryChecking = anyChecking;

      // Choose summary icon based on highest-priority state (checking > missing > outdated > ok)
      if (anyChecking) {
        this._summaryIconName = "utility:sync"; // spinner will be shown in template when checking
        this._summaryState = "neutral";
      } else if (anyMissing) {
        this._summaryIconName = "utility:error";
        this._summaryState = "error";
      } else if (anyOutdated) {
        this._summaryIconName = "utility:warning";
        this._summaryState = "warning";
      } else {
        this._summaryIconName = "utility:check";
        this._summaryState = "ok";
      }
    }

    // Auto-update tries each dependency at most once per re-check cycle: a
    // failing install re-checks into the same pending status, and retrying it
    // automatically would loop forever (the user can still retry manually).
    // Only the exact filtered list is run and marked: installing unrelated
    // errored cards, or re-running previously failed ones, is manual-only
    const autoInstallCandidates = this.listAutoInstallCandidates().filter(
      (c) => !this._autoInstallAttemptedIds.has(c.id),
    );
    if (
      this._autoUpdateDependencies &&
      autoInstallCandidates.length > 0 &&
      !anyChecking &&
      !this.installQueueRunning &&
      !this._summaryChecking &&
      this.hasPendingActions
    ) {
      // Automatically run pending installs if the setting is enabled, the queue is not already running, and there are pending actions
      autoInstallCandidates.forEach((c) =>
        this._autoInstallAttemptedIds.add(c.id),
      );
      this.runPendingInstalls(autoInstallCandidates);
    }

    // Ensure button labels/disabled state reflect the new summary/installQueue states
    this._updateDependencyCardsState();
  }

  // Update per-check computed properties used by template to avoid inline expressions
  _updateDependencyCardsState() {
    this.checks = this.checks.map((c) => {
      // derive primary display status from canonical state
      const status = c.status || "";
      const busy = c.checking || c.installing || c.uninstalling;
      let statusIcon = busy ? "utility:sync" : "utility:info";
      let state = "neutral";
      if (!busy) {
        switch (status) {
          case "ok":
            statusIcon = "utility:check";
            state = "ok";
            break;
          case "outdated":
            statusIcon = "utility:warning";
            state = "warning";
            break;
          case "missing":
            statusIcon = "utility:error";
            state = "error";
            break;
          case "error":
            // A mandatory upgrade is not a broken dependency: show the same
            // warning icon as an optional upgrade, on the red (required) accent
            if (c.upgradeAvailable === true && c.installable) {
              statusIcon = "utility:warning";
            } else {
              statusIcon = "utility:ban";
            }
            state = "error";
        }
      }
      const cardClass = `hardis-status-card ${state}`;
      const tileClass = `hardis-tile ${STATE_TILE_HUE[state] || "slate"}`;

      let buttonLabel = "ERROR: BUG IN CODE";
      // Colors always come from a tint class on a neutral button: filled SLDS
      // variants are unreadable in one of the two VS Code themes
      let buttonTint = "";
      let buttonAction = "error";
      let buttonDisabled = false;

      if (busy) {
        if (c.uninstalling) {
          buttonLabel = this.t("uninstallingLabel");
        } else if (c.installing) {
          buttonLabel = this.t("installingLabel");
        } else {
          buttonLabel = this.t("checking");
        }
        buttonAction = "";
        buttonDisabled = true;
      } else if (status === "outdated") {
        buttonLabel = this.t("upgradeLabel");
        buttonTint = "hardis-btn-tinted-amber";
        buttonAction = c.id === "node" ? "instructions" : "install";
      } else if (status === "ok") {
        buttonLabel = this.t("recheck");
        buttonAction = "recheck";
      } else if (status === "missing") {
        buttonLabel = c.installable
          ? this.t("installLabel")
          : this.t("installInstructions");
        buttonTint = "hardis-btn-tinted-blue";
        buttonAction = c.installable ? "install" : "instructions";
      } else if (status === "error") {
        // A mandatory upgrade (ex: sfdx-hardis older than the minimal version)
        // is still an upgrade: run the install command instead of sending the
        // user to generic fix instructions
        if (c.upgradeAvailable === true && c.installable) {
          buttonLabel = this.t("upgradeLabel");
          buttonTint = "hardis-btn-tinted-amber";
          buttonAction = "install";
        } else {
          buttonLabel = this.t("fixInstructions");
          buttonTint = "hardis-btn-tinted-blue";
          buttonAction = "instructions";
        }
      }
      const buttonClass = buttonTint;

      // Uninstall button is offered for non-recommended plugins that are
      // currently installed (status "ok", "outdated", or "error" with a known
      // version). Hidden while any action is in flight on this card.
      const showUninstallButton =
        c.uninstallable === true &&
        !busy &&
        (status === "ok" || status === "outdated" || status === "error") &&
        !!c.version;

      return {
        ...c,
        isBusy: busy,
        statusIcon,
        cardClass,
        tileClass,
        buttonLabel,
        buttonClass,
        buttonAction,
        buttonDisabled,
        showUninstallButton,
        uninstallLabel: this.t("uninstallLabel"),
      };
    });
    this.checks = [...this.checks];
  }

  // ...existing code...

  get summaryBoxClass() {
    const base = "setup-status-box";
    return this.summaryClass ? `${base} ${this.summaryClass}` : base;
  }

  // Icon name exposed to template when not checking
  get summaryIconName() {
    return this._summaryIconName || "utility:setup";
  }

  // State of the summary card, shared by its accent and its tile
  get summaryState() {
    return this._summaryState || "info";
  }

  get summaryCardClass() {
    return `hardis-status-card ${this.summaryState}`;
  }

  get summaryTileClass() {
    return `hardis-tile ${STATE_TILE_HUE[this.summaryState] || "slate"}`;
  }

  // boolean flag used by template to hide summary button while checks are running
  get summaryChecking() {
    return !!this._summaryChecking;
  }

  // Flag indicating install queue is running to prevent re-entrancy
  _installQueueRunning = false;

  // Dependencies already auto-installed once in this panel session, so a
  // failing install is not retried in a loop by the auto-update setting
  _autoInstallAttemptedIds = new Set();

  // Expose whether the install queue is currently running
  get installQueueRunning() {
    return !!this._installQueueRunning;
  }

  // Computed label for the Run button (avoid inline expressions in template)
  get runButtonLabel() {
    return this.installQueueRunning
      ? this.t("running")
      : this.t("runPendingInstalls");
  }

  // Computed disabled state for the Run button
  get runButtonDisabled() {
    // disable while queue runs or while summary-level checking is in progress
    return this.installQueueRunning || !!this._summaryChecking;
  }

  // Compute whether there are pending actions (install/upgrade) excluding manual installs like node/git
  get hasPendingActions() {
    return (
      this.checks &&
      this.checks.some((c) => {
        const status = c.status || (c.installed ? "ok" : "missing");
        // "error" with an upgrade available is a mandatory upgrade
        // (ex: sfdx-hardis older than the minimal version)
        const needs =
          status === "missing" ||
          status === "outdated" ||
          (status === "error" && c.upgradeAvailable === true);
        if (!needs) return false;
        // Exclude manual-only installs
        if (c.id === "node" || c.id === "git") return false;
        return !!c.installable;
      })
    );
  }

  listInstallCandidates() {
    const installCandidates = this.checks.filter((c) => {
      if (!c.installable) {
        return false;
      }
      if (c.id === "node" || c.id === "git") {
        return false;
      }
      if (
        c.status === "missing" ||
        c.status === "outdated" ||
        c.status === "error"
      ) {
        return true;
      }
      return false;
    });
    return installCandidates;
  }

  // Candidates auto-update is allowed to install unattended: dependencies that
  // genuinely need an install (missing, outdated, or a mandatory upgrade).
  // Other error cards (transient check failures, e.g. npm registry unreachable)
  // are left alone: reinstalling cannot fix them
  listAutoInstallCandidates() {
    return this.listInstallCandidates().filter(
      (c) =>
        c.status === "missing" ||
        c.status === "outdated" ||
        (c.status === "error" && c.upgradeAvailable === true),
    );
  }

  // Run the install queue for all items that need install/upgrade and are
  // installable. `candidates` restricts the queue to an explicit list (used by
  // auto-update); anything else (the button click event) runs the full list
  async runPendingInstalls(candidates = null) {
    const installCandidates = Array.isArray(candidates)
      ? candidates
      : this.listInstallCandidates();
    if (installCandidates.length === 0) {
      const manualInstallCandidates = this.checks.filter((c) => {
        if (
          (c.status === "missing" ||
            c.status === "outdated" ||
            c.status === "error") &&
          !c.installable
        ) {
          return true;
        }
        return false;
      });
      if (manualInstallCandidates.length > 0) {
        const firstCandidate = manualInstallCandidates[0];
        this.handleInstructions({
          currentTarget: { dataset: { id: firstCandidate.id } },
        });
      }
      return;
    }
    if (this.installQueueRunning) {
      return;
    }
    this._installQueueRunning = true;
    this._updateDependencyCardsState();
    for (const chk of installCandidates) {
      if (chk && chk.id) {
        // Await each install to serialize them
        await new Promise((resolve) => {
          // Store a resolver so the checkResult handler can resolve when the check completes
          if (!this._pendingCheckResolvers) this._pendingCheckResolvers = {};
          this._pendingCheckResolvers[chk.id] = resolve;
          // Trigger the install (which will trigger a check when done)
          this.handleInstall({ currentTarget: { dataset: { id: chk.id } } });
        });
        // Small delay between installs to avoid overwhelming the server
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    this._installQueueRunning = false;
    this._updateDependencyCardsState();
  }
}
