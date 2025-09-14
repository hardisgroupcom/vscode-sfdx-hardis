import { LightningElement, api, track } from 'lwc';

export default class FilesWorkbench extends LightningElement {
  workspaces = [];
  selectedWorkspace = null;
  isLoading = false;
  showCreateWorkspace = false;
  editingWorkspace = null;
  @track newWorkspace = {
    name: '',
    label: '',
    description: '',
    soqlQuery: 'SELECT Id,Name FROM Opportunity',
    fileTypes: 'all',
    outputFolderNameField: 'Name',
    outputFileNameFormat: 'title',
    overwriteParentRecords: true,
    overwriteFiles: false
  };

  connectedCallback() {
    this.loadWorkspaces();
    
    // Listen for messages from VS Code
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.handleMessage.bind(this));
  }

  handleMessage(event) {
    const message = event.data;
    switch (message.type) {
      case 'initialize':
        this.handleInitialize(message.data);
        break;
      case 'workspacesLoaded':
        this.handleWorkspacesLoaded(message.data);
        break;
      case 'workspaceCreated':
      case 'workspaceUpdated':
      case 'workspaceDeleted':
        this.loadWorkspaces();
        this.showCreateWorkspace = false;
        this.editingWorkspace = null;
        break;
      default:
        break;
    }
  }

  @api
  initialize(data) {
    if (data && data.workspaces) {
      this.workspaces = data.workspaces;
    }
  }

  handleInitialize(data) {
    this.initialize(data);
  }

  handleWorkspacesLoaded(data) {
    this.workspaces = data.workspaces || [];
    this.isLoading = false;
  }

  loadWorkspaces() {
    this.isLoading = true;
    window.sendMessageToVSCode({
      type: 'loadWorkspaces',
      data: {}
    });
  }

  get hasWorkspaces() {
    return this.workspaces && this.workspaces.length > 0;
  }

  get workspacesForDisplay() {
    return this.workspaces.map(workspace => ({
      ...workspace,
      iconName: 'standard:file',
      hasDescription: !!workspace.description,
      overwriteParentRecords: workspace.overwriteParentRecords ? 'Yes' : 'No',
      overwriteFiles: workspace.overwriteFiles ? 'Yes' : 'No',
      exportedFilesCount: workspace.exportedFilesCount || null
    }));
  }

  get isCreateMode() {
    return this.showCreateWorkspace && !this.editingWorkspace;
  }

  get isEditMode() {
    return this.showCreateWorkspace && !!this.editingWorkspace;
  }

  get modalTitle() {
    return this.isEditMode ? 'Edit Files Import/Export Workspace' : 'Create New Files Import/Export Workspace';
  }

  get canSaveWorkspace() {
    return this.newWorkspace.name.trim() && 
           this.newWorkspace.label.trim() && 
           this.newWorkspace.soqlQuery.trim();
  }

  get saveButtonDisabled() {
    return !this.canSaveWorkspace;
  }

  get saveButtonLabel() {
    return this.isEditMode ? 'Update Workspace' : 'Create Workspace';
  }

  // Event Handlers
  handleWorkspaceSelect(event) {
    const workspacePath = event.currentTarget.dataset.path;
    const workspace = this.workspaces.find(w => w.path === workspacePath);
    this.selectedWorkspace = workspace;
  }

  handleCreateWorkspace() {
    this.showCreateWorkspace = true;
    this.editingWorkspace = null;
    this.resetNewWorkspace();
  }

  handleEditWorkspace(event) {
    console.log('Edit workspace clicked', event);
    
    let workspacePath;
    
    // Handle both menu item clicks and button clicks
    if (event.detail && event.detail.value === 'edit') {
      // From menu item - use selected workspace
      workspacePath = this.selectedWorkspace?.path;
      console.log('From menu item, workspace path:', workspacePath);
    } else {
      // From button - use dataset
      workspacePath = event.currentTarget?.dataset?.path || this.selectedWorkspace?.path;
      console.log('From button, workspace path:', workspacePath);
    }
    
    const workspace = this.workspaces.find(w => w.path === workspacePath);
    console.log('Found workspace:', workspace);
    
    if (workspace) {
      this.editingWorkspace = workspace;
      this.newWorkspace = {
        name: workspace.name,
        label: workspace.label,
        description: workspace.description,
        soqlQuery: workspace.soqlQuery,
        fileTypes: workspace.fileTypes,
        outputFolderNameField: workspace.outputFolderNameField,
        outputFileNameFormat: workspace.outputFileNameFormat,
        overwriteParentRecords: workspace.overwriteParentRecords,
        overwriteFiles: workspace.overwriteFiles
      };
      this.showCreateWorkspace = true;
      console.log('Opening edit modal');
    } else {
      console.error('Workspace not found for path:', workspacePath);
    }
    
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
  }

  handleDeleteWorkspace(event) {
    let path;
    
    // Handle both menu item clicks and button clicks
    if (event.detail && event.detail.value === 'delete') {
      // From menu item - use selected workspace
      path = this.selectedWorkspace?.path;
    } else {
      // From button - use dataset or selected workspace
      const pathFromDataset = event?.currentTarget?.dataset?.path;
      path = (this.selectedWorkspace && this.selectedWorkspace.path) || pathFromDataset;
    }
    
    if (path) {
      const ws = this.workspaces.find((w) => w.path === path) || this.selectedWorkspace;
      window.sendMessageToVSCode({
        type: 'deleteWorkspace',
        data: { path, label: ws?.label || ws?.name || path }
      });
    }
    
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
  }

  handleOpenFolder() {
    if (this.selectedWorkspace && this.selectedWorkspace.path) {
      window.sendMessageToVSCode({
        type: 'openFolder',
        data: { path: this.selectedWorkspace.path }
      });
    }
  }

  handleCancel() {
    this.showCreateWorkspace = false;
    this.editingWorkspace = null;
    this.resetNewWorkspace();
  }

  handleSave() {
    const action = this.isEditMode ? 'updateWorkspace' : 'createWorkspace';
    const data = {
      ...this.newWorkspace,
      originalPath: this.editingWorkspace?.path
    };

    window.sendMessageToVSCode({
      type: action,
      data: data
    });
  }

  // Input Change Handlers
  handleNameChange(event) {
    this.newWorkspace.name = event.detail?.value ?? event.target.value;
  }

  handleLabelChange(event) {
    this.newWorkspace.label = event.detail?.value ?? event.target.value;
  }

  handleDescriptionChange(event) {
    this.newWorkspace.description = event.detail?.value ?? event.target.value;
  }

  handleSoqlQueryChange(event) {
    this.newWorkspace.soqlQuery = event.detail?.value ?? event.target.value;
  }

  handleFileTypesChange(event) {
    this.newWorkspace.fileTypes = event.detail?.value ?? event.target.value;
  }

  handleOutputFolderNameFieldChange(event) {
    this.newWorkspace.outputFolderNameField = event.detail?.value ?? event.target.value;
  }

  handleOutputFileNameFormatChange(event) {
    this.newWorkspace.outputFileNameFormat = event.detail?.value ?? event.target.value;
  }

  handleOverwriteParentRecordsChange(event) {
    this.newWorkspace.overwriteParentRecords = event.detail?.checked ?? event.target.checked;
  }

  handleOverwriteFilesChange(event) {
    this.newWorkspace.overwriteFiles = event.detail?.checked ?? event.target.checked;
  }

  // Command Actions
  handleExportFiles(event) {
    // Handle both menu item clicks and button clicks
    if (event && event.detail && event.detail.value === 'export') {
      // From menu item
    } else {
      // From button - stop propagation
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }
    
    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: 'runCommand',
        data: { 
          command: `sf hardis:org:files:export --path "${this.selectedWorkspace.path}"` 
        }
      });
    }
  }

  handleImportFiles(event) {
    // Handle both menu item clicks and button clicks
    if (event && event.detail && event.detail.value === 'import') {
      // From menu item
    } else {
      // From button - stop propagation
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }
    
    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: 'runCommand',
        data: { 
          command: `sf hardis:org:files:import --path "${this.selectedWorkspace.path}"` 
        }
      });
    }
  }

  handleConfigureWorkspace() {
    if (this.selectedWorkspace) {
      window.sendMessageToVSCode({
        type: 'openFile',
        data: this.selectedWorkspace.configPath
      });
    }
  }

  // Helper Methods
  resetNewWorkspace() {
    this.newWorkspace = {
      name: '',
      label: '',
      description: '',
      soqlQuery: 'SELECT Id,Name FROM Opportunity',
      fileTypes: 'all',
      outputFolderNameField: 'Name',
      outputFileNameFormat: 'title',
      overwriteParentRecords: true,
      overwriteFiles: false
    };
  }

  get fileNameFormatOptions() {
    return [
      { label: 'Title (e.g., "Document Title")', value: 'title' },
      { label: 'Title + ID (e.g., "Document Title_006xxx")', value: 'title_id' },
      { label: 'ID + Title (e.g., "006xxx_Document Title")', value: 'id_title' },
      { label: 'ID only (e.g., "006xxx")', value: 'id' }
    ];
  }

  get fileTypesOptions() {
    return [
      { label: 'All file types', value: 'all' },
      { label: 'PDF files only', value: 'PDF' },
      { label: 'Image files only', value: 'PNG,JPG,JPEG,GIF' },
      { label: 'Document files only', value: 'PDF,DOC,DOCX,XLS,XLSX,PPT,PPTX' }
    ];
  }
}