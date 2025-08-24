import { LightningElement, api, track } from 'lwc';

export default class InstalledPackages extends LightningElement {
    @api packages = [];
    @track editMode = false;
    @track draftValues = [];

    columns = [
        { label: 'Name', fieldName: 'SubscriberPackageName', type: 'text' },
        { label: 'Namespace', fieldName: 'SubscriberPackageNamespace', type: 'text' },
        { label: 'Version', fieldName: 'SubscriberPackageVersionNumber', type: 'text' },
        { label: 'Scratch Orgs', fieldName: 'installOnScratchOrgs', type: 'boolean', editable: true },
        { label: 'Deployments', fieldName: 'installDuringDeployments', type: 'boolean', editable: true },
    ];

    get isEditMode() {
        return this.editMode;
    }

    handleEdit() {
        this.editMode = true;
    }

    handleCancel() {
        this.editMode = false;
        this.draftValues = [];
    }

    handleSave(event) {
        const updatedValues = event.detail.draftValues;
        this.dispatchEvent(new CustomEvent('save', { detail: updatedValues }));
        this.editMode = false;
        this.draftValues = [];
    }

    handleDraftValuesChange(event) {
        this.draftValues = event.detail.draftValues;
    }

    // Message bridge for VS Code
    connectedCallback() {
        window.addEventListener('message', this.handleVsCodeMessage.bind(this));
    }
    disconnectedCallback() {
        window.removeEventListener('message', this.handleVsCodeMessage.bind(this));
    }
    handleVsCodeMessage(event) {
        const { type, data } = event.data;
        if (type === 'initialize') {
            this.packages = data.packages || [];
        }
    }
    sendMessageToVSCode(type, data) {
        window.sendMessageToVSCode({ type, data });
    }
}
