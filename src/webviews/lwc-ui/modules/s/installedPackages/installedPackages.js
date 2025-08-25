import { LightningElement, api, track } from 'lwc';

export default class InstalledPackages extends LightningElement {
    @api packages = [];
    @track editMode = false;
    @track draftValues = [];

    columns = [
        { label: 'Name', fieldName: 'SubscriberPackageName', type: 'text', sortable: false },
        { label: 'Namespace', fieldName: 'SubscriberPackageNamespace', type: 'text', sortable: false },
        { label: 'Version', fieldName: 'SubscriberPackageVersionNumber', type: 'text' },
        { label: 'Scratch Orgs', fieldName: 'installOnScratchOrgs', type: 'boolean', editable: true, sortable: false, cellAttributes: { alignment: 'center' } },
        { label: 'Deployments', fieldName: 'installDuringDeployments', type: 'boolean', editable: true, sortable: false, cellAttributes: { alignment: 'center' } },
    ];

    get isEditMode() {
        return this.editMode;
    }

    @api
    initialize(data) {
        this.packages = data.packages || [];
        // Sort packages by SubscriberPackageName
        this.packages.sort((a, b) => {
            if (a.SubscriberPackageName < b.SubscriberPackageName) return -1;
            if (a.SubscriberPackageName > b.SubscriberPackageName) return 1;
            return 0;
        });
        this.editMode = false;
        this.draftValues = [];
    }

    @api
    handleMessage(messageType, data) {
        switch (messageType) {
            case "refreshPackages":
                this.handleRefresh();
                break;
            default:
                console.log("Unknown message type:", messageType, data);
        }
    }

    handleEdit() {
        this.editMode = true;
    }

    handleCancel() {
        this.editMode = false;
        this.draftValues = [];
    }

    handleDraftValuesChange(event) {
        debugger;
        const newDrafts = event.detail.draftValues;
        for (const newDraft of newDrafts) {
            const existingDraftIndex = this.draftValues.findIndex(draft => draft.Id === newDraft.Id);
            if (existingDraftIndex !== -1) {
                // Update existing draft
                this.draftValues[existingDraftIndex] = { ...this.draftValues[existingDraftIndex], ...newDraft };
            } else {
                // Add new draft
                this.draftValues.push(newDraft);
            }
        }
        // Refresh to ensure reactivity
        this.draftValues = [...this.draftValues];
    }

    handleRefresh() {
        window.sendMessageToVSCode({ type: "refresh" });
    }

    handleSave() {
        // Send updated config to VS Code
        if (typeof window !== "undefined" && window.sendMessageToVSCode) {
            debugger;
            // Merge draftValues into packages
            const packagesForUpdate = [...this.packages]
            for (const draft of this.draftValues) {
                const pkg = packagesForUpdate.find(p => p.Id === draft.Id);
                if (pkg) {
                    Object.assign(pkg, draft);
                }
            }
            window.sendMessageToVSCode({
                type: "saveSfdxHardisConfig",
                data: {
                    packages: JSON.parse(JSON.stringify(packagesForUpdate)),
                },
            });
            this.editMode = false;
            this.draftValues = [];
        }
    }

    handleRetrieveFromOrg() {
        if (typeof window !== "undefined" && window.sendMessageToVSCode) {
            window.sendMessageToVSCode({
                type: "runCommand",
                data: {
                    command: "sf hardis:org:retrieve:packageconfig",
                },
            });
        }
        console.log("Retrieve from org button clicked");
    }

    handleInstallNewPackage() {
        if (typeof window !== "undefined" && window.sendMessageToVSCode) {
            window.sendMessageToVSCode({
                type: "runCommand",
                data: {
                    command: "sf hardis:package:install",
                },
            });
        }
        console.log("Install new package button clicked");
    }    

}
