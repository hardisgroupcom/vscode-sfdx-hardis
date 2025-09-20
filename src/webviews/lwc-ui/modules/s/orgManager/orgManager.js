import { LightningElement, api, track } from "lwc";

export default class OrgManager extends LightningElement {
  @track orgs = [];
  @track selectedRowKeys = [];
  @track viewAll = false;
  @track draftValues = [];
  @track validationErrors = [];
  internalCommands = [];

  columns = [
    {
      label: "Instance URL",
      fieldName: "instanceUrl",
      type: "url",
      typeAttributes: {
        label: { fieldName: "instanceLabel" },
        target: "_blank",
      },
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
    {
      label: "Type",
      fieldName: "orgType",
      type: "text",
      initialWidth: 100,
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
    {
      label: "Username",
      fieldName: "username",
      type: "text",
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
    {
      label: "Alias",
      fieldName: "alias",
      type: "text",
      editable: true,
      initialWidth: 120,
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
    {
      label: "Connected",
      fieldName: "connectedLabel",
      type: "text",
      initialWidth: 140,
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
    {
      label: "Role",
      fieldName: "defaultLabel",
      type: "text",
      initialWidth: 100,
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
    {
      label: "Actions",
      type: "action",
      fieldName: "rowActions",
      typeAttributes: {
        rowActions: { fieldName: "rowActions" },
      },
      cellAttributes: { class: { fieldName: "rowClass" } },
    },
  ];

  get hasSelection() {
    return this.selectedRowKeys && this.selectedRowKeys.length > 0;
  }

  get hasAliasChanges() {
    return this.draftValues && this.draftValues.length > 0;
  }

  get hasValidationErrors() {
    return this.validationErrors && this.validationErrors.length > 0;
  }

  @api
  initialize(data) {
    this.orgs = (data && data.orgs) || [];
    // Normalize rows: compute connected label/variant and ensure username exists as key
    this.orgs = this.orgs.map((o) => ({
      ...o,
      username: o.username || o.loginUrl || o.instanceUrl,
      alias: o.alias || "",
      // strip protocol for display (label) and remove trailing slash
      instanceLabel: (o.instanceUrl || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, ""),
      // more robust connected detection: accept connected/authorized/true etc.
      connectedLabel: (o.connectedStatus || "")
        .toString()
        .toLowerCase()
        .match(/connected|authorized/)
        ? "Connected"
        : "Disconnected",
      // Compute row actions for the Actions column: Open (connected), Reconnect (disconnected), Remove (always)
      rowActions: (() => {
        const isConnected = (o.connectedStatus || "")
          .toString()
          .toLowerCase()
          .match(/connected|authorized/);
        const actions = [];
        if (isConnected) {
          actions.push({ label: "Open", name: "open" });
          if (!o.isDefaultUsername) {
            actions.push({ label: "Set as Default Org", name: "setDefault" });
          }
          if (o.isDevHub && !o.isDefaultDevHubUsername) {
            actions.push({
              label: "Set as Default Dev Hub",
              name: "setDefaultDevHub",
            });
          }
        } else {
          actions.push({ label: "Reconnect", name: "reconnect" });
        }
        actions.push({
          label: "Remove",
          name: "remove",
          variant: "destructive",
        });
        return actions;
      })(),
      // CSS class used by cellAttributes to highlight default org rows
      rowClass:
        o.isDefaultUsername || o.isDefaultDevHubUsername
          ? "org-default-row"
          : "",
      defaultLabel: o.isDefaultUsername
        ? "Default Org"
        : o.isDefaultDevHubUsername
          ? "Dev Hub"
          : "",
    }));
    // If a default org or a default dev hub exists, move them to the top of the list
    const prioritized = [];
    // find default org
    const defaultOrg = this.orgs.find((r) => r.isDefaultUsername === true);
    if (defaultOrg) prioritized.push(defaultOrg);
    // find default dev hub (different from default org)
    const defaultDevHub = this.orgs.find(
      (r) =>
        r.isDefaultDevHubUsername === true &&
        r.username !== (defaultOrg && defaultOrg.username),
    );
    if (defaultDevHub) prioritized.push(defaultDevHub);
    if (prioritized.length > 0) {
      const prioritizedUsernames = new Set(prioritized.map((r) => r.username));
      const rest = this.orgs.filter(
        (r) => !prioritizedUsernames.has(r.username),
      );
      this.orgs = [...prioritized, ...rest];
    }

    this.selectedRowKeys = [];
    this.draftValues = [];
    this.validationErrors = [];
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "refreshOrgs":
        this.handleRefresh(data && data.all === true);
        break;
      case "commandResult":
        this.handleCommandResult(data);
        break;
      default:
        console.log("Unknown message type:", messageType, data);
    }
  }

  handleConnect() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: { command: "sf hardis:org:select --prompt-default" },
    });
  }

  handleRefresh(all = false) {
    // If called as an event handler the first argument will be an Event object.
    // Treat a non-boolean `all` argument as "no explicit flag" and fall back to the UI toggle.
    const explicitAll = typeof all === "boolean" ? all : undefined;
    const allFlag = explicitAll === true ? true : this.viewAll === true;
    // Always send a boolean for `all` so the backend can rely on `data.all === true` checks
    window.sendMessageToVSCode({
      type: "refreshOrgsFromUi",
      data: { all: !!allFlag },
    });
  }

  handleViewAllToggle(event) {
    this.viewAll = event.target.checked === true;
    // Immediately refresh to reflect the new view mode
    this.handleRefresh(this.viewAll === true);
  }

  get hasRecommended() {
    return this.recommendedUsernames.length > 0;
  }

  // Return an array of usernames considered "recommended" for removal: disconnected, deleted or expired
  get recommendedUsernames() {
    const now = Date.now();
    return (this.orgs || [])
      .filter((o) => {
        const connected = (o.connectedStatus || "")
          .toString()
          .toLowerCase()
          .match(/connected|authorized/);
        const deleted =
          o.deleted === true ||
          o.isDeleted === true ||
          (o.status || "").toString().toLowerCase().includes("deleted") ||
          (o.connectedStatus || "")
            .toString()
            .toLowerCase()
            .includes("deleted");
        let expired = false;
        try {
          if (o.expirationDate) {
            const exp = new Date(o.expirationDate).getTime();
            if (!isNaN(exp) && exp < now) expired = true;
          }
        } catch (e) {
          // ignore date parse errors
        }
        return !connected || deleted || expired;
      })
      .map((o) => o.username)
      .filter(Boolean);
  }

  handleRemoveRecommended() {
    const recommendedUsernames = this.recommendedUsernames || [];

    window.sendMessageToVSCode({
      type: "removeRecommended",
      data: { usernames: recommendedUsernames },
    });
  }

  handleRowSelection(event) {
    const selectedRows = event.detail.selectedRows || [];
    this.selectedRowKeys = selectedRows.map((r) => r.username);
  }

  handleForgetSelected() {
    // Try to gather usernames from tracked selection; if empty, fallback to the datatable's selected rows
    let usernames = (this.selectedRowKeys || []).slice();
    if (!usernames || usernames.length === 0) {
      const table = this.template.querySelector("lightning-datatable");
      if (table && typeof table.getSelectedRows === "function") {
        const rows = table.getSelectedRows() || [];
        usernames = rows.map((r) => r.username).filter(Boolean);
      }
    }

    if (!usernames || usernames.length === 0) return;

    // Debug: log the usernames we will send
    // eslint-disable-next-line no-console
    console.log("OrgManager: forgetting selected usernames", usernames);

    window.sendMessageToVSCode({ type: "forgetOrgs", data: { usernames } });
  }

  handleRowAction(event) {
    const actionName = event.detail.action.name;
    const row = event.detail.row;
    // Handle Actions column events (open, reconnect, remove)
    if (actionName === "open") {
      const internalCommand = {
        command: `sf org open --target-org ${row.username}`,
        commandId: Math.random(),
        progressMessage: `Opening org ${row.username}...`,
        callback: () => {
          // After opening the org, refresh the list to update connected status
          this.handleRefresh(this.viewAll === true);
        },
      };
      this.requestRunInternalCommand(internalCommand);
    } else if (actionName === "setDefault") {
      const internalCommand = {
        command: `sf config set target-org ${row.username}`,
        commandId: Math.random(),
        progressMessage: `Setting org ${row.username} as default org...`,
        callback: () => {
          // After opening the org, refresh the list to update connected status
          this.handleRefresh(this.viewAll === true);
        },
      };
      this.requestRunInternalCommand(internalCommand);
    } else if (actionName === "setDefaultDevHub") {
      const internalCommand = {
        command: `sf config set target-dev-hub ${row.username}`,
        commandId: Math.random(),
        progressMessage: `Setting org ${row.username} as default Dev Hub...`,
        callback: () => {
          // After opening the org, refresh the list to update connected status
          this.handleRefresh(this.viewAll === true);
        },
      };
      this.requestRunInternalCommand(internalCommand);
    } else if (actionName === "reconnect") {
      window.sendMessageToVSCode({
        type: "connectOrg",
        data: { username: row.username, instanceUrl: row.instanceUrl },
      });
    } else if (actionName === "remove") {
      window.sendMessageToVSCode({
        type: "forgetOrgs",
        data: { usernames: [row.username] },
      });
    }
  }

  handleDraftValuesChange(event) {
    const newDrafts = event.detail.draftValues;
    for (const newDraft of newDrafts) {
      const existingDraftIndex = this.draftValues.findIndex(
        (draft) => draft.username === newDraft.username,
      );

      // Only include the alias field in draft values to avoid highlighting other columns
      const cleanDraft = {
        username: newDraft.username,
        alias: newDraft.alias,
      };

      if (existingDraftIndex !== -1) {
        // Update existing draft
        this.draftValues[existingDraftIndex] = cleanDraft;
      } else {
        // Add new draft
        this.draftValues.push(cleanDraft);
      }
    }
    // Refresh to ensure reactivity
    this.draftValues = [...this.draftValues];
  }

  handleCancelAliasChanges() {
    this.draftValues = [];
    this.validationErrors = [];
  }

  handleSaveAliases(event) {
    // Clear previous validation errors
    this.validationErrors = [];

    // Get draft values from the event (native datatable behavior)
    const draftValues = event.detail.draftValues || this.draftValues;

    // Validate all alias changes before submitting
    const validationErrors = [];
    const validatedChanges = [];

    for (const draft of draftValues) {
      const alias = (draft.alias || "").trim();
      const username = draft.username;

      // Skip empty aliases (they will be unset)
      if (!alias) {
        validatedChanges.push({ username, alias: "" });
        continue;
      }

      // Validate alias compliance with Salesforce CLI requirements
      const validationError = this.validateAlias(alias);
      if (validationError) {
        validationErrors.push({
          username: username,
          alias: alias,
          error: validationError,
        });
        continue;
      }

      validatedChanges.push({ username, alias });
    }

    // If there are validation errors, store them and don't proceed
    if (validationErrors.length > 0) {
      this.validationErrors = validationErrors;
      return;
    }

    // All validations passed, update the orgs data directly for immediate display
    const updatedOrgs = this.orgs.map((org) => {
      const change = validatedChanges.find(
        (change) => change.username === org.username,
      );
      if (change) {
        return { ...org, alias: change.alias };
      }
      return org;
    });
    this.orgs = updatedOrgs;

    // Clear draft values and send to VS Code to save aliases
    this.draftValues = [];
    window.sendMessageToVSCode({
      type: "saveAliases",
      data: {
        aliasChanges: validatedChanges,
      },
    });
  }

  validateAlias(alias) {
    // Salesforce CLI alias validation rules

    // Check length (1-64 characters)
    if (alias.length < 1 || alias.length > 64) {
      return "Alias must be 1-64 characters long";
    }

    // Check if it starts with a letter or underscore
    if (!/^[a-zA-Z_]/.test(alias)) {
      return "Alias must start with a letter or underscore";
    }

    // Check if it contains only valid characters (letters, numbers, underscores, hyphens)
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
      return "Alias can only contain letters, numbers, underscores, and hyphens";
    }

    return null; // No validation errors
  }

  requestRunInternalCommand(internalCommand) {
    window.sendMessageToVSCode({
      type: "runInternalCommand",
      data: JSON.parse(JSON.stringify(internalCommand)),
    });
    this.internalCommands.push(internalCommand);
  }

  /* jscpd:ignore-start */
  handleCommandResult(data) {
    if (data && data.command && data.commandId) {
      // If found in internalCommands: Execute callback of the command, then remove it from internalCommands
      const cmdIndex = this.internalCommands.findIndex(
        (cmd) => cmd.commandId === data.commandId,
      );
      if (cmdIndex !== -1) {
        const cmd = this.internalCommands[cmdIndex];
        if (cmd.callback && typeof cmd.callback === "function") {
          try {
            cmd.callback(data);
          } catch (e) {
            // ignore callback errors
          }
        }
        // Delete the command from the internal list to avoid unbounded growth
        this.internalCommands.splice(cmdIndex, 1);
      }
    }
  }
  /* jscpd:ignore-end */
}
