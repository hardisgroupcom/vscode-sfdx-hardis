/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class PackageXml extends LightningElement {
  @track packageData = null;
  @track isLoading = true;
  @track hasError = false;
  @track errorMessage = "";
  @track packageType = "skip"; // Default type: skip, deploy, retrieve, etc.
  @track packageFilePath = "";
  @track packageConfig = null;

  @api
  initialize(data) {
    console.log("Package XML component initialized:", data);
    this.isLoading = false;
    
    // Extract package configuration
    this.packageConfig = data?.config || {};
    this.packageType = this.packageConfig.type || "skip";
    this.packageFilePath = this.packageConfig.filePath || "manifest/package.xml";
    
    if (data?.error) {
      this.hasError = true;
      this.errorMessage = data.error;
      this.packageData = null;
    } else if (data?.packageData) {
      this.hasError = false;
      this.packageData = this.processPackageData(data.packageData);
    } else {
      this.hasError = true;
      this.errorMessage = "No package data provided";
    }
  }

  @api
  handleMessage(type, data) {
    console.log("Package XML component received message:", type, data);
    if (type === "packageDataUpdated") {
      this.initialize(data);
    }
  }

  // Process and enhance package data
  processPackageData(rawData) {
    if (!rawData || !rawData.types) {
      return null;
    }

    const processedTypes = rawData.types.map(type => {
      const hasWildcard = type.members && type.members.includes('*');
      const members = hasWildcard ? [] : (type.members || []);
      const iconInfo = this.getMetadataTypeIcon(type.name);
      
      return {
        ...type,
        memberCount: hasWildcard ? 'All' : members.length,
        hasWildcard: hasWildcard,
        members: members,
        isExpanded: false,
        expandIcon: 'utility:chevronright',
        iconName: iconInfo.icon,
        memberIconName: iconInfo.memberIcon
      };
    });

    return {
      ...rawData,
      types: processedTypes
    };
  }

  // Get appropriate icon for metadata type
  getMetadataTypeIcon(typeName) {
    const iconMap = {
      'ApexClass': { icon: 'standard:apex', memberIcon: 'utility:apex' },
      'ApexTrigger': { icon: 'standard:apex_trigger', memberIcon: 'utility:apex' },
      'CustomObject': { icon: 'standard:custom', memberIcon: 'utility:custom_apps' },
      'Flow': { icon: 'standard:flow', memberIcon: 'utility:flow' },
      'Layout': { icon: 'standard:layout', memberIcon: 'utility:layout' },
      'Profile': { icon: 'standard:user', memberIcon: 'utility:user' },
      'PermissionSet': { icon: 'standard:permission_set', memberIcon: 'utility:lock' },
      'Report': { icon: 'standard:report', memberIcon: 'utility:chart' },
      'Dashboard': { icon: 'standard:dashboard', memberIcon: 'utility:dashboard' },
      'Certificate': { icon: 'standard:certificate', memberIcon: 'utility:key' },
      'ConnectedApp': { icon: 'standard:connected_apps', memberIcon: 'utility:connected_apps' },
      'ContentAsset': { icon: 'standard:content', memberIcon: 'utility:file' },
      'EmailTemplate': { icon: 'standard:email_template', memberIcon: 'utility:email' },
      'StaticResource': { icon: 'standard:resource', memberIcon: 'utility:resource' },
      'CustomTab': { icon: 'standard:tab', memberIcon: 'utility:tab' },
      'CustomApplication': { icon: 'standard:app', memberIcon: 'utility:apps' },
      'ValidationRule': { icon: 'standard:rule', memberIcon: 'utility:rules' },
      'Workflow': { icon: 'standard:workflow', memberIcon: 'utility:workflow' },
      'WorkflowRule': { icon: 'standard:workflow', memberIcon: 'utility:workflow' },
      'CustomField': { icon: 'standard:field', memberIcon: 'utility:field' },
      'ListView': { icon: 'standard:list_view', memberIcon: 'utility:list' },
      'Queue': { icon: 'standard:queue', memberIcon: 'utility:queue' },
      'Group': { icon: 'standard:groups', memberIcon: 'utility:groups' },
      'RecordType': { icon: 'standard:record', memberIcon: 'utility:record' },
      'CustomSettings': { icon: 'standard:settings', memberIcon: 'utility:settings' },
      'RemoteSiteSetting': { icon: 'standard:global_constant', memberIcon: 'utility:world' },
      'NamedCredential': { icon: 'standard:credential', memberIcon: 'utility:key' },
      'AuthProvider': { icon: 'standard:identity_verification', memberIcon: 'utility:identity' },
      'SamlSsoConfig': { icon: 'standard:sso', memberIcon: 'utility:lock' },
      'Territory': { icon: 'standard:territory', memberIcon: 'utility:territory' },
      'Role': { icon: 'standard:role', memberIcon: 'utility:user_role' },
      'BusinessProcess': { icon: 'standard:process', memberIcon: 'utility:process' },
      'CompactLayout': { icon: 'standard:compact_layout', memberIcon: 'utility:layout' },
      'PathAssistant': { icon: 'standard:path', memberIcon: 'utility:path' },
      'FlexiPage': { icon: 'standard:page', memberIcon: 'utility:page' },
      'LightningComponentBundle': { icon: 'standard:lightning_component', memberIcon: 'utility:lightning' },
      'AuraDefinitionBundle': { icon: 'standard:lightning_component', memberIcon: 'utility:lightning' },
      'CustomPermission': { icon: 'standard:custom_permission', memberIcon: 'utility:permission' },
      'PlatformEventChannel': { icon: 'standard:event', memberIcon: 'utility:event' },
      'CustomMetadata': { icon: 'standard:custom_metadata_type', memberIcon: 'utility:custom_apps' },
      'Flow-Definition': { icon: 'standard:flow', memberIcon: 'utility:flow' },
      'AssignmentRule': { icon: 'standard:rule', memberIcon: 'utility:rules' },
      'AutoResponseRule': { icon: 'standard:rule', memberIcon: 'utility:rules' },
      'EscalationRule': { icon: 'standard:rule', memberIcon: 'utility:rules' },
      'SharingRule': { icon: 'standard:sharing_model', memberIcon: 'utility:share' },
      'Territory2': { icon: 'standard:territory2', memberIcon: 'utility:territory' },
      'Territory2Type': { icon: 'standard:territory2', memberIcon: 'utility:territory' },
      'GlobalValueSet': { icon: 'standard:global_value_set', memberIcon: 'utility:picklist_type' },
      'StandardValueSet': { icon: 'standard:standard_value_set', memberIcon: 'utility:picklist_type' }
    };

    // Return specific mapping if found, otherwise return default
    // The default styling is handled by CSS for any unmatched data-type
    return iconMap[typeName] || { 
      icon: 'utility:package', 
      memberIcon: 'utility:package_org_beta' 
    };
  }

  // Computed properties for dynamic content
  get packageTypeConfig() {
    const configs = {
      skip: {
        title: "Package Skip Configuration",
        description: "Monitoring package skip items",
        icon: "standard:package",
        infoIcon: "📋",
        typesIcon: "📦",
        typesTitle: "Metadata Types",
        typesDescription: "Items configured to be skipped during monitoring",
        wildcardMessage: "All members of this type are skipped (*)",
        emptyTitle: "No Metadata Types Configured",
        emptyDescription: "This package file doesn't contain any metadata types to skip.",
        refreshTooltip: "Reload package skip configuration",
        editTooltip: "Open the package skip file for editing"
      },
      deploy: {
        title: "Deployment Package",
        description: "Package contents for deployment",
        icon: "standard:deployment",
        infoIcon: "🚀",
        typesIcon: "📤",
        typesTitle: "Deployment Contents",
        typesDescription: "Metadata types and components included in this deployment",
        wildcardMessage: "All members of this type are included (*)",
        emptyTitle: "No Deployment Contents",
        emptyDescription: "This deployment package doesn't contain any metadata types.",
        refreshTooltip: "Reload deployment package",
        editTooltip: "Open the deployment package file for editing"
      },
      retrieve: {
        title: "Retrieve Package",
        description: "Package definition for metadata retrieval",
        icon: "standard:download",
        infoIcon: "📥",
        typesIcon: "📦",
        typesTitle: "Retrieval Contents",
        typesDescription: "Metadata types and components to retrieve from the org",
        wildcardMessage: "All members of this type will be retrieved (*)",
        emptyTitle: "No Retrieval Contents",
        emptyDescription: "This retrieval package doesn't contain any metadata types.",
        refreshTooltip: "Reload retrieval package",
        editTooltip: "Open the retrieval package file for editing"
      },
      destructive: {
        title: "Destructive Changes",
        description: "Components marked for deletion",
        icon: "standard:delete",
        infoIcon: "🗑️",
        typesIcon: "❌",
        typesTitle: "Destructive Changes",
        typesDescription: "Metadata types and components to be deleted",
        wildcardMessage: "All members of this type will be deleted (*)",
        emptyTitle: "No Destructive Changes",
        emptyDescription: "This destructive changes package doesn't contain any components to delete.",
        refreshTooltip: "Reload destructive changes",
        editTooltip: "Open the destructive changes file for editing"
      },
      manifest: {
        title: "Package Manifest",
        description: "Complete package definition",
        icon: "standard:file",
        infoIcon: "📄",
        typesIcon: "📋",
        typesTitle: "Package Contents",
        typesDescription: "All metadata types and components in this package",
        wildcardMessage: "All members of this type are included (*)",
        emptyTitle: "Empty Package",
        emptyDescription: "This package manifest doesn't contain any metadata types.",
        refreshTooltip: "Reload package manifest",
        editTooltip: "Open the package manifest file for editing"
      }
    };
    
    return configs[this.packageType] || configs.manifest;
  }

  get packageTitle() {
    return this.packageTypeConfig.title;
  }

  get packageDescription() {
    const baseDesc = this.packageTypeConfig.description;
    return this.packageFilePath ? `${baseDesc} from ${this.packageFilePath}` : baseDesc;
  }

  get packageIconName() {
    return this.packageTypeConfig.icon;
  }

  get packageInfoIcon() {
    return this.packageTypeConfig.infoIcon;
  }

  get metadataTypesIcon() {
    return this.packageTypeConfig.typesIcon;
  }

  get metadataTypesTitle() {
    return this.packageTypeConfig.typesTitle;
  }

  get metadataTypesDescription() {
    return this.packageTypeConfig.typesDescription;
  }

  get wildcardMessage() {
    return this.packageTypeConfig.wildcardMessage;
  }

  get emptyStateTitle() {
    return this.packageTypeConfig.emptyTitle;
  }

  get emptyStateDescription() {
    return this.packageTypeConfig.emptyDescription;
  }

  get refreshTooltip() {
    return this.packageTypeConfig.refreshTooltip;
  }

  get editTooltip() {
    return this.packageTypeConfig.editTooltip;
  }

  // Computed properties
  get hasPackageData() {
    return !this.isLoading && !this.hasError && this.packageData;
  }

  get hasTypes() {
    return this.packageData && this.packageData.types && this.packageData.types.length > 0;
  }

  get totalTypes() {
    return this.packageData?.types?.length || 0;
  }

  get totalMembers() {
    if (!this.packageData?.types) return 0;
    
    return this.packageData.types.reduce((total, type) => {
      if (type.hasWildcard) {
        return total; // Don't count wildcard types
      }
      return total + (type.members?.length || 0);
    }, 0);
  }

  // Event Handlers
  toggleTypeExpansion(event) {
    const typeName = event.currentTarget.dataset.typeName;
    if (!typeName || !this.packageData?.types) return;

    // Update the specific type's expansion state
    this.packageData = {
      ...this.packageData,
      types: this.packageData.types.map(type => {
        if (type.name === typeName) {
          const isExpanded = !type.isExpanded;
          return {
            ...type,
            isExpanded: isExpanded,
            expandIcon: isExpanded ? 'utility:chevrondown' : 'utility:chevronright'
          };
        }
        return type;
      })
    };
  }

  refreshPackageConfig() {
    this.isLoading = true;
    this.hasError = false;
    this.errorMessage = "";
    
    window.sendMessageToVSCode({
      type: "refreshPackageConfig",
      data: {
        packageType: this.packageType,
        filePath: this.packageFilePath
      }
    });
  }

  editPackageFile() {
    window.sendMessageToVSCode({
      type: "editPackageFile",
      data: {
        filePath: this.packageFilePath
      }
    });
  }
}