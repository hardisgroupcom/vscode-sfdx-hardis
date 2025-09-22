import { LightningElement, track } from "lwc";

export default class Setup extends LightningElement {
  @track checks = [];
  @track summaryMessage = '';
  @track summaryClass = '';

    // Note: version/outdated detection is performed server-side in `setup.ts`.
    // The webview relies on fields provided in `res` (for example `res.status === 'outdated'` or `res.upgradeAvailable`).

    constructor() {
      super();
      this._boundOnMessage = this._onMessage.bind(this);
    }

    connectedCallback() {
      // Request initialization data (UI should render the list immediately)
      window.sendMessageToVSCode({ type: "requestSetupInit" });
      window.addEventListener("message", this._boundOnMessage);
    }

    disconnectedCallback() {
      window.removeEventListener("message", this._boundOnMessage);
    }

    _onMessage(event) {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === "initialize") {
        if (msg.data && msg.data.checks) {
          // Render the static list first (no checking yet) so the UI paints quickly
          this.checks = msg.data.checks.map((c) => ({
            explanation: c.explanation || "",
            installable: typeof c.installable === "boolean" ? c.installable : true,
            prerequisites: c.prerequisites || [],
            checking: false, // per-item checking state
            installed: false,
            hasChecked: false, // becomes true after first checkResult for the item
            upgradeAvailable: false,
            version: c.version || "",
            // default status visuals so markup can render immediately
            statusIcon: "utility:info",
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
      } else if (msg.type === "checkResult") {
        const { id, res } = msg.data || {};
        if (!id) return;
        // derive visual status from result
  let statusIcon = "utility:info";
  let statusClassSuffix = "info";
  let cardClass = "status-card not-installed";
  let statusIconClass = "status-icon-container info";
        if (res && res.installed) {
          statusIcon = "utility:check";
          statusClassSuffix = "success";
          cardClass = "status-card installed";
          statusIconClass = "status-icon-container success";
        } else if (res && res.message) {
          statusIcon = "utility:error";
          statusClassSuffix = "warning";
          cardClass = "status-card not-installed";
          statusIconClass = "status-icon-container warning";
        }

        // update single check atomically; mark hasChecked and compute upgradeAvailable if appropriate
        this.checks = this.checks.map((c) => {
          if (c.id === id) {
            // The server (setup.ts / commands.ts) performs version/outdated detection.
            // Use any provided flags from res to determine upgrade availability.
            const upgradeAvailable = !!(res && (res.upgradeAvailable === true || res.status === 'outdated'));

            const newIconClass = upgradeAvailable ? 'status-icon-container warning' : (res && res.installed ? 'status-icon-container success' : 'status-icon-container info');
            const newActionLabel = res && res.installed ? 'Re-check' : (upgradeAvailable ? 'Upgrade' : 'Install');

            return {
              ...c,
              ...res,
              checking: false,
              hasChecked: true,
              upgradeAvailable,
              statusIcon,
              statusClassSuffix,
              cardClass,
              iconContainerClass: newIconClass,
              actionLabel: newActionLabel,
            };
          }
          return c;
        });

        // recompute prerequisites after the status change
        this._recomputePrerequisites();
      } else if (msg.type === "installResult") {
        const { id, res } = msg.data || {};
        if (!id) return;
        // After install, re-run the single check to refresh its status
        this._startCheck(id);
      }
    }

    _startCheck(id) {
      // Set checking=true for the specific item and emit a check request
      this.checks = this.checks.map((c) =>
        c.id === id ? { ...c, checking: true, cardClass: "status-card" } : c,
      );
      window.sendMessageToVSCode({ type: "checkDependency", data: { id } });
    }

    handleInstall(e) {
      const id = e.currentTarget.dataset.id;
      // mark checking while install happens (will trigger re-check when installResult arrives)
      this.checks = this.checks.map((c) => (c.id === id ? { ...c, checking: true } : c));
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
