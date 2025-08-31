import { LightningElement, api, track } from "lwc";

export default class OrgManager extends LightningElement {
  @track orgs = [];
  @track selectedRowKeys = [];

  columns = [
    { label: "Instance URL", fieldName: "instanceUrl", type: "url", typeAttributes: { label: { fieldName: 'instanceUrl' }, target: '_blank' } },
    { label: "Username", fieldName: "username", type: "text" },
    {
      label: "Connected",
      fieldName: "connectedStatus",
      type: "button",
      typeAttributes: {
        label: { fieldName: 'connectedLabel' },
        name: 'toggleConnection',
        variant: { fieldName: 'connectedVariant' }
      }
    },
    {
      label: "Action",
      type: "button",
      typeAttributes: {
        label: 'Open in Browser',
        name: 'openLoginUrl',
        variant: 'neutral'
      }
    }
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
      connectedLabel: o.connectedStatus && o.connectedStatus.toLowerCase().startsWith('connected') ? 'Disconnect' : 'Reconnect',
      connectedVariant: o.connectedStatus && o.connectedStatus.toLowerCase().startsWith('connected') ? 'destructive' : 'brand'
    }));
    this.selectedRowKeys = [];
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case 'refreshOrgs':
        this.handleRefresh();
        break;
      default:
        console.log('Unknown message type:', messageType, data);
    }
  }

  handleRefresh() {
    if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({ type: 'refreshOrgs' });
    }
  }

  handleRowSelection(event) {
    const selectedRows = event.detail.selectedRows || [];
    this.selectedRowKeys = selectedRows.map((r) => r.username);
  }

  handleForgetSelected() {
    if (!this.hasSelection) return;
    if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({ type: 'forgetOrgs', data: { usernames: this.selectedRowKeys } });
    }
  }

  handleRowAction(event) {
    const actionName = event.detail.action.name;
    const row = event.detail.row;
    if (actionName === 'toggleConnection') {
      // If currently connected, call logout; otherwise, try to login (open login URL)
      const isConnected = row.connectedStatus && row.connectedStatus.toLowerCase().startsWith('connected');
      if (isConnected) {
        // Logout
        if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
          window.sendMessageToVSCode({ type: 'runCommand', data: { command: `sf org logout --target-org ${row.username} --noprompt` } });
        }
      } else {
        // Reconnect: open browser login
        if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
          // Prefer runCommand to open login flow; extension can handle this message
          window.sendMessageToVSCode({ type: 'runCommand', data: { command: `sf org login web --instance-url ${row.instanceUrl} --username ${row.username}` } });
        }
      }
    } else if (actionName === 'openLoginUrl') {
      // open loginUrl in external browser
      const url = row.loginUrl || row.instanceUrl;
      if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
        window.sendMessageToVSCode({ type: 'openUrl', data: { url } });
      }
    }
  }
}
