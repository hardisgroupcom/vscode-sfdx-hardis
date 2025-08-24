import { LightningElement, api, track } from 'lwc';

export default class InstalledPackages extends LightningElement {
    @api packages = [];
    @track editMode = false;
    @track draftValues = [];

    columns = [
        { label: 'Name', fieldName: 'SubscriberPackageName', type: 'text', sortable: true },
        { label: 'Namespace', fieldName: 'SubscriberPackageNamespace', type: 'text', sortable: true },
        { label: 'Version', fieldName: 'SubscriberPackageVersionNumber', type: 'text' },
        { label: 'Scratch Orgs', fieldName: 'installOnScratchOrgs', type: 'boolean', editable: true, sortable: true, cellAttributes: { alignment: 'center' } },
        { label: 'Deployments', fieldName: 'installDuringDeployments', type: 'boolean', editable: true, sortable: true, cellAttributes: { alignment: 'center' } },
    ];

    get isEditMode() {
        return this.editMode;
    }

    @api
    initialize(data) {
        this.packages = data.packages || [];
        this.editMode = false;
        this.draftValues = [];
    }

    handleEdit() {
        this.editMode = true;
    }

    handleCancel() {
        this.editMode = false;
        this.draftValues = [];
    }

    handleSave() {
        // Send updated config to VS Code
        if (typeof window !== "undefined" && window.sendMessageToVSCode) {
            // Merge draftValues into packages
            const packagesForUpdate = [...this.packages]
            for (const draft of this.draftValues) {
                const pkg = packagesForUpdate.find(p => p.SubscriberPackageId === draft.SubscriberPackageId);
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

    handleDraftValuesChange(event) {
        this.draftValues = event.detail.draftValues;
    }

}
