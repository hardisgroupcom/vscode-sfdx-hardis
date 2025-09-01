import { LightningElement, api, track } from "lwc";

export default class OrgManager extends LightningElement {
  @track orgs = [];
  @track selectedRowKeys = [];
  @track viewAll = false;

  columns = [
    {
      label: "Instance URL",
      fieldName: "instanceUrl",
      type: "url",
      typeAttributes: {
        label: { fieldName: "instanceLabel" },
        target: "_blank",
      },
    },
    { label: "Type", fieldName: "orgType", type: "text" },
    { label: "Username", fieldName: "username", type: "text" },
    { label: "Connected", fieldName: "connectedLabel", type: "text" },
    {
      label: "Actions",
      type: "action",
      fieldName: "rowActions",
      typeAttributes: {
        rowActions: { fieldName: "rowActions" },
      },
    },
  ];

  get hasSelection() {
    return this.selectedRowKeys && this.selectedRowKeys.length > 0;
  }

  @api
  initialize(data) {
    this.orgs = (data && data.orgs) || [];
    // Normalize rows: compute connected label/variant and ensure username exists as key
    this.orgs = this.orgs.map((o) => ({
      ...o,
      username: o.username || o.loginUrl || o.instanceUrl,
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
        } else {
          actions.push({ label: "Reconnect", name: "reconnect" });
        }
        actions.push({ label: "Remove", name: "remove", variant: "destructive" });
        return actions;
      })(),
    }));
    this.selectedRowKeys = [];
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "refreshOrgs":
        this.handleRefresh(data && data.all === true);
        break;
      default:
        console.log("Unknown message type:", messageType, data);
    }
  }

  handleConnect() {
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: "runCommand",
        data: { command: "sf hardis:org:select --prompt-default" },
      });
    }
  }

  handleRefresh(all = false) {
    // If called as an event handler the first argument will be an Event object.
    // Treat a non-boolean `all` argument as "no explicit flag" and fall back to the UI toggle.
    const explicitAll = typeof all === "boolean" ? all : undefined;
    const allFlag = explicitAll === true ? true : this.viewAll === true;
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      // Always send a boolean for `all` so the backend can rely on `data.all === true` checks
      window.sendMessageToVSCode({
        type: "refreshOrgsFromUi",
        data: { all: !!allFlag },
      });
    }
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

    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: "removeRecommended",
        data: { usernames: recommendedUsernames },
      });
    }
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

    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({ type: "forgetOrgs", data: { usernames } });
    }
  }

  handleRowAction(event) {
    const actionName = event.detail.action.name;
    const row = event.detail.row;
    // Handle Actions column events (open, reconnect, remove)
    if (actionName === "open") {
      if (typeof window !== "undefined" && window.sendMessageToVSCode) {
        window.sendMessageToVSCode({
           type: "runInternalCommand",
           data: {
            command: `sf org open --target-org ${row.username}`,
            commandId: Math.random(),
            progressMessage: `Opening org ${row.username}...`
          }
        });
      }
    } else if (actionName === "reconnect") {
      if (typeof window !== "undefined" && window.sendMessageToVSCode) {
        window.sendMessageToVSCode({ type: "connectOrg", data: { username: row.username, instanceUrl: row.instanceUrl } });
      }
    } else if (actionName === "remove") {
      if (typeof window !== "undefined" && window.sendMessageToVSCode) {
        window.sendMessageToVSCode({ type: "forgetOrgs", data: { usernames: [row.username] } });
      }
    }
  }
}
