import { LightningElement, api, track } from "lwc";

export default class Setup extends LightningElement {
  @track checks = [];
  @track summaryMessage = "";
  @track summaryClass = "";
  _pendingCheckResolvers = {};
  _autoUpdateDependencies = false;

  // Control visibility of the top-right settings (hide on scroll)
  // (no fixed-position behaviour needed; toggle will live inside header)

  connectedCallback() {
    // Request initialization data (UI should render the list immediately)
    window.sendMessageToVSCode({ type: "requestSetupInit" });
  }

  disconnectedCallback() {}

  @api
  handleMessage(type, data) {
    console.log("Setup component received message:", type, data);
    if (type === "initialize") {
      // Render the static list first (no checking yet) so the UI paints quickly
      this._autoUpdateDependencies =
        data && data.autoUpdateDependencies === true;
      this.checks = data.checks.map((c) => ({
        ...c,
        explanation: c.explanation || "",
        installable: typeof c.installable === "boolean" ? c.installable : true,
        prerequisites: c.prerequisites || [],
        checking: false, // per-item checking state
        installed: false,
        hasChecked: false, // becomes true after first checkResult for the item
        upgradeAvailable: false,
        version: c.version || "",
        installing: false,
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
      // After install, re-run the single check to refresh its status
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
      this.summaryMessage = "Check in progress";
      this.summaryClass = "info";
      this._summaryChecking = true;
      this._summaryIconName = "utility:sync";
      this._summaryIconContainer = "status-icon-container neutral";
    } else {
      if (anyChecking) {
        this.summaryMessage = "Check in progress";
        this.summaryClass = "info";
      } else if (anyMissing) {
        this.summaryMessage = "Missing dependencies: Please install them";
        this.summaryClass = "warning";
      } else if (anyOutdated) {
        this.summaryMessage = "Outdated dependencies: Please upgrade them";
        this.summaryClass = "warning";
      } else {
        this.summaryMessage = "You are all set 🤓";
        this.summaryClass = "success";
      }

      // Expose summary-level checking flag (true if any item is checking)
      this._summaryChecking = anyChecking;

      // Choose summary icon based on highest-priority state (checking > missing > outdated > ok)
      if (anyChecking) {
        this._summaryIconName = "utility:sync"; // spinner will be shown in template when checking
        this._summaryIconContainer = "status-icon-container checking";
      } else if (anyMissing) {
        this._summaryIconName = "utility:error";
        this._summaryIconContainer = "status-icon-container error";
      } else if (anyOutdated) {
        this._summaryIconName = "utility:warning";
        this._summaryIconContainer = "status-icon-container warning";
      } else {
        this._summaryIconName = "utility:check";
        this._summaryIconContainer = "status-icon-container success";
      }
    }

    if (
      this._autoUpdateDependencies &&
      this.listInstallCandidates().length > 0 &&
      !anyChecking &&
      !this.installQueueRunning &&
      !this._summaryChecking &&
      this.hasPendingActions
    ) {
      // Automatically run pending installs if the setting is enabled, the queue is not already running, and there are pending actions
      this.runPendingInstalls();
    }

    // Ensure button labels/disabled state reflect the new summary/installQueue states
    this._updateDependencyCardsState();
  }

  // Update per-check computed properties used by template to avoid inline expressions
  _updateDependencyCardsState() {
    this.checks = this.checks.map((c) => {
      // derive primary display status from canonical state
      const status = c.status || "";
      let statusIcon = c.checking ? "utility:sync" : "utility:info";
      let cardClass = c.checking ? "status-card checking" : "status-card";
      let iconContainerClass = c.checking
        ? "status-icon-container checking"
        : "status-icon-container neutral";

      switch (status) {
        case "ok":
          statusIcon = "utility:check";
          cardClass = "status-card installed ok";
          iconContainerClass = "status-icon-container success";
          break;
        case "outdated":
          statusIcon = "utility:warning";
          cardClass = "status-card installed outdated warning";
          iconContainerClass = "status-icon-container warning";
          break;
        case "missing":
          statusIcon = "utility:error";
          cardClass = "status-card not-installed error";
          iconContainerClass = "status-icon-container error";
          break;
        case "error":
          statusIcon = "utility:ban";
          cardClass = "status-card not-installed critical";
          iconContainerClass = "status-icon-container critical";
      }

      let buttonLabel = "ERROR: BUG IN CODE";
      let buttonVariant = "error";
      let buttonAction = "error";
      let buttonDisabled = false;

      if (c.checking || c.installing) {
        buttonLabel = c.checking ? "Checking..." : "Installing...";
        buttonVariant = "neutral";
        ((buttonAction = ""), (buttonDisabled = true));
      } else if (status === "outdated") {
        buttonLabel = "Upgrade";
        buttonVariant = "brand";
        buttonAction = "install";
      } else if (status === "ok") {
        buttonLabel = "Re-check";
        buttonVariant = "neutral";
        buttonAction = "recheck";
      } else if (status === "missing") {
        buttonLabel = c.installable ? "Install" : "Install Instructions";
        buttonVariant = "brand";
        buttonAction = c.installable ? "install" : "instructions";
      } else if (status === "error") {
        buttonLabel = "Fix Instructions";
        buttonVariant = "brand";
        buttonAction = "instructions";
      }

      return {
        ...c,
        statusIcon,
        cardClass,
        iconContainerClass,
        buttonLabel,
        buttonVariant,
        buttonAction,
        buttonDisabled,
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

  // Container class for the icon in the summary card
  get summaryIconContainerClass() {
    return this._summaryIconContainer || "status-icon-container info";
  }

  // boolean flag used by template to hide summary button while checks are running
  get summaryChecking() {
    return !!this._summaryChecking;
  }

  // Flag indicating install queue is running to prevent re-entrancy
  _installQueueRunning = false;

  // Expose whether the install queue is currently running
  get installQueueRunning() {
    return !!this._installQueueRunning;
  }

  // Computed label for the Run button (avoid inline expressions in template)
  get runButtonLabel() {
    return this.installQueueRunning ? "Running..." : "Run pending installs";
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
        const needs = status === "missing" || status === "outdated";
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

  // Run the install queue for all items that need install/upgrade and are installable
  async runPendingInstalls() {
    const installCandidates = this.listInstallCandidates();
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
