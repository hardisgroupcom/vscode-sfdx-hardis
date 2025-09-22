import { LightningElement, api, track } from "lwc";

export default class Setup extends LightningElement {
  @track checks = [];
  @track summaryMessage = '';
  @track summaryClass = '';

  connectedCallback() {
    // Request initialization data (UI should render the list immediately)
    window.sendMessageToVSCode({ type: "requestSetupInit" });
  }

  disconnectedCallback() {
  }

  @api
  handleMessage(type, data) {
    console.log("Setup component received message:", type, data);
    if (type === "initialize") {
        // Render the static list first (no checking yet) so the UI paints quickly
        this.checks = data.checks.map((c) => ({
          explanation: c.explanation || "",
          installable: typeof c.installable === "boolean" ? c.installable : true,
          prerequisites: c.prerequisites || [],
          checking: false, // per-item checking state
          installed: false,
          hasChecked: false, // becomes true after first checkResult for the item
          upgradeAvailable: false,
          // prefer a provided version or empty string
          version: c.version || "",
          // default status visuals so markup can render immediately
          // use server-provided iconName when available
          statusIcon: c.iconName || "utility:info",
          statusClassSuffix: "info",
          cardClass: "status-card not-installed",
          // icon container class (colorized) — spinner controlled by chk.checking
          iconContainerClass: "status-icon-container info",
          // action label shown on primary button (avoids ternaries in template)
          actionLabel: "Install",
          ...c,
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
      debugger;
      const { id, res } = data || {};
      // Determine status from res.status (preferred). Fallback to installed flag.
      const status = (res && res.status) || (res && res.installed ? "ok" : "missing");

      // update single check atomically; mark hasChecked and compute upgradeAvailable if appropriate
      this.checks = this.checks.map((c) => {
        if (c.id === id) {
          // The server performs version/outdated detection; prefer status field
          const upgradeAvailable = !!(res && (res.upgradeAvailable === true || status === "outdated"));

          // Map status to visual classes and labels
          let statusIcon = "utility:info";
          let statusClassSuffix = "info";
          let cardClass = "status-card not-installed";
          let iconContainerClass = "status-icon-container info";
          let installed = false;
          let newActionLabel = "Install";

          switch (status) {
            case "ok":
              statusIcon = "utility:check";
              statusClassSuffix = "success";
              cardClass = "status-card installed ok";
              iconContainerClass = "status-icon-container success";
              installed = true;
              newActionLabel = "Re-check";
              break;
            case "outdated":
              statusIcon = "utility:warning";
              statusClassSuffix = "warning";
              cardClass = "status-card installed outdated";
              iconContainerClass = "status-icon-container warning";
              installed = true; // still installed but outdated
              newActionLabel = "Upgrade";
              break;
            case "missing":
              statusIcon = "utility:error";
              statusClassSuffix = "warning";
              cardClass = "status-card not-installed missing";
              iconContainerClass = "status-icon-container warning";
              installed = false;
              newActionLabel = "Install";
              break;
            case "error":
              statusIcon = "utility:error";
              statusClassSuffix = "error";
              cardClass = "status-card not-installed error";
              iconContainerClass = "status-icon-container neutral";
              installed = false;
              newActionLabel = c.installable ? "Install" : "Instructions";
              break;
            default:
              // fallback
              statusIcon = res && res.iconName ? res.iconName : c.iconName || "utility:info";
              statusClassSuffix = "info";
              cardClass = res && res.installed ? "status-card installed" : "status-card not-installed";
              iconContainerClass = res && res.installed ? "status-icon-container success" : "status-icon-container info";
              installed = !!(res && res.installed);
              newActionLabel = installed ? "Re-check" : "Install";
          }

          return {
            ...c,
            ...res,
            checking: false,
            hasChecked: true,
            upgradeAvailable,
            statusIcon,
            statusClassSuffix,
            cardClass,
            iconContainerClass,
            actionLabel: newActionLabel,
            // Override installed based on status (status is the source of truth for UI)
            installed,
          };
        }
        return c;
      });
      this.checks = [...this.checks]; // trigger reactivity

      // recompute prerequisites after the status change
      this._recomputePrerequisites();
    }
    // Receive install result
    else if (type === "installResult") {
      const { id, res } = data || {};
      // After install, re-run the single check to refresh its status
      this._startCheck(id);
    }
  }

  _startCheck(id) {
    // Set checking=true for the specific item and emit a check request
    this.checks = this.checks.map((c) =>
      c.id === id ? { ...c, checking: true, actionLabel: "Checking...", cardClass: "status-card" } : c,
    );
    this.checks = [...this.checks]; // trigger reactivity
    window.sendMessageToVSCode({ type: "checkDependency", data: { id } });
  }

  handleInstall(e) {
    const id = e.currentTarget.dataset.id;
    // mark checking while install happens (will trigger re-check when installResult arrives)
    this.checks = this.checks.map((c) => (c.id === id ? { ...c, checking: true } : c));
    this.checks = [...this.checks]; // trigger reactivity
    window.sendMessageToVSCode({ type: "installDependency", data: { id } });
  }

  handleInstructions(e) {
    const id = e.currentTarget.dataset.id;
    window.sendMessageToVSCode({ type: "showInstructions", data: { id } });
  }

  handleAction(e) {
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
      const missingCandidates = prereqArray.filter((p) => !(lookup[p] && lookup[p].installed === true));
      // only consider a prerequisite "missing" for user hint if that prerequisite has been checked already
      const missing = missingCandidates.filter((p) => lookup[p] && lookup[p].hasChecked === true);
      const missingFriendly = missing
        .map((p) => (lookup[p] && lookup[p].label ? lookup[p].label : p))
        .join(', ');
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
    const anyMissing = this.checks.some((c) => c.missingPrerequisites && c.missingPrerequisites.length > 0) || this.checks.some((c) => c.status === 'missing');
    const anyOutdated = this.checks.some((c) => c.upgradeAvailable === true || c.status === 'outdated');

    if (anyChecking) {
      this.summaryMessage = 'Check in progress';
      this.summaryClass = 'info';
    } else if (anyMissing) {
      this.summaryMessage = 'Missing dependencies — install them';
      this.summaryClass = 'warning';
    } else if (anyOutdated) {
      this.summaryMessage = 'Outdated dependencies — upgrade them';
      this.summaryClass = 'warning';
    } else {
      this.summaryMessage = 'You are all set';
      this.summaryClass = 'success';
    }
  }

  get summaryBoxClass() {
    const base = 'setup-status-box';
    return this.summaryClass ? `${base} ${this.summaryClass}` : base;
  }
}
