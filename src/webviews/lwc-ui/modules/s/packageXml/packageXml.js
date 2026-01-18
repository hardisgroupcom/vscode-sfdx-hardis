/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { ColorThemeMixin } from "s/colorThemeMixin";

export default class PackageXml extends ColorThemeMixin(LightningElement) {
  @track packageData = null;
  @track isLoading = true;
  @track hasError = false;
  @track errorMessage = "";
  @track packageType = "skip"; // Default type: skip, deploy, retrieve, etc.
  @track packageFilePath = "";
  @track packageConfig = null;
  @track filterText = "";

  @api
  initialize(data) {
    console.log("Package XML component initialized:", data);
    this.isLoading = false;

    // Extract package configuration
    this.packageConfig = data?.config || {};
    this.packageFilePath =
      this.packageConfig.filePath || "manifest/package.xml";

    // Auto-detect package type from file path if not explicitly provided
    this.packageType =
      this.packageConfig.type ||
      this.detectPackageTypeFromPath(this.packageFilePath);

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

  @api
  handleColorThemeMessage(type, data) {
    // Delegate to the mixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }

  // Auto-detect package type from file path
  detectPackageTypeFromPath(filePath) {
    if (!filePath) return "manifest";

    const fileName = filePath.toLowerCase();

    if (fileName.includes("skip-items") || fileName.includes("package-skip")) {
      return "skip";
    } else if (
      fileName.includes("backup-items") ||
      fileName.includes("package-backup")
    ) {
      return "backup";
    } else if (
      fileName.includes("all-org-items") ||
      fileName.includes("package-all-org")
    ) {
      return "all-org";
    } else if (fileName.includes("destructive")) {
      return "destructive";
    } else if (
      fileName.includes("no-overwrite") ||
      fileName.includes("packagedeployonce")
    ) {
      return "no-overwrite";
    } else if (fileName.includes("deploy")) {
      return "deploy";
    } else if (fileName.includes("retrieve")) {
      return "retrieve";
    } else {
      return "manifest"; // Default fallback
    }
  }

  // Process and enhance package data
  processPackageData(rawData) {
    if (!rawData || !rawData.types) {
      return null;
    }

    const processedTypes = rawData.types.map((type) => {
      const hasWildcard = type.members && type.members.includes("*");
      const members = hasWildcard ? [] : type.members || [];
      const iconInfo = this.getMetadataTypeIcon(type.name);
      return {
        ...type,
        memberCount: hasWildcard ? "All" : members.length,
        hasWildcard: hasWildcard,
        members: members,
        isExpanded: false,
        expandIcon: "utility:chevronright",
        iconName: iconInfo.icon,
        memberIconName: iconInfo.memberIcon,
      };
    });

    return {
      ...rawData,
      types: processedTypes,
    };
  }

  // Get appropriate icon for metadata type
  getMetadataTypeIcon(typeName) {
    // Use utility icons where possible — utility icons are broadly supported in LWC.
    const iconMap = {
      ApexClass: { icon: "utility:apex", memberIcon: "utility:apex" },
      ApexTrigger: { icon: "utility:apex", memberIcon: "utility:apex" },
      CustomObject: {
        icon: "utility:custom_apps",
        memberIcon: "utility:custom_apps",
      },
      Flow: { icon: "utility:flow", memberIcon: "utility:flow" },
      Layout: { icon: "utility:layout", memberIcon: "utility:layout" },
      Profile: { icon: "utility:user", memberIcon: "utility:user" },
      PermissionSet: { icon: "utility:lock", memberIcon: "utility:lock" },
      Report: { icon: "utility:chart", memberIcon: "utility:chart" },
      Dashboard: { icon: "utility:chart", memberIcon: "utility:chart" },
      Certificate: { icon: "utility:key", memberIcon: "utility:key" },
      ConnectedApp: {
        icon: "utility:connected_apps",
        memberIcon: "utility:connected_apps",
      },
      ContentAsset: { icon: "utility:file", memberIcon: "utility:file" },
      EmailTemplate: { icon: "utility:email", memberIcon: "utility:email" },
      StaticResource: {
        icon: "utility:package",
        memberIcon: "utility:package",
      },
      CustomTab: { icon: "utility:apps", memberIcon: "utility:apps" },
      CustomApplication: { icon: "utility:apps", memberIcon: "utility:apps" },
      ValidationRule: { icon: "utility:rules", memberIcon: "utility:rules" },
      Workflow: { icon: "utility:process", memberIcon: "utility:process" },
      WorkflowRule: {
        icon: "utility:process",
        memberIcon: "utility:process",
      },
      CustomField: { icon: "utility:settings", memberIcon: "utility:settings" },
      ListView: { icon: "utility:list", memberIcon: "utility:list" },
      Queue: { icon: "utility:queue", memberIcon: "utility:queue" },
      Group: { icon: "utility:groups", memberIcon: "utility:groups" },
      RecordType: { icon: "utility:record", memberIcon: "utility:record" },
      CustomSettings: {
        icon: "utility:settings",
        memberIcon: "utility:settings",
      },
      RemoteSiteSetting: { icon: "utility:world", memberIcon: "utility:world" },
      NamedCredential: { icon: "utility:key", memberIcon: "utility:key" },
      AuthProvider: {
        icon: "utility:identity",
        memberIcon: "utility:identity",
      },
      SamlSsoConfig: { icon: "utility:lock", memberIcon: "utility:lock" },
      Territory: { icon: "utility:world", memberIcon: "utility:world" },
      Role: { icon: "utility:user", memberIcon: "utility:user" },
      BusinessProcess: {
        icon: "utility:process",
        memberIcon: "utility:process",
      },
      CompactLayout: { icon: "utility:layout", memberIcon: "utility:layout" },
      PathAssistant: { icon: "utility:steps", memberIcon: "utility:steps" },
      FlexiPage: { icon: "utility:page", memberIcon: "utility:page" },
      LightningComponentBundle: {
        icon: "utility:thunder",
        memberIcon: "utility:thunder",
      },
      AuraDefinitionBundle: {
        icon: "utility:thunder",
        memberIcon: "utility:thunder",
      },
      CustomPermission: { icon: "utility:lock", memberIcon: "utility:lock" },
      PlatformEventChannel: {
        icon: "utility:event",
        memberIcon: "utility:event",
      },
      CustomMetadata: {
        icon: "utility:custom_apps",
        memberIcon: "utility:custom_apps",
      },
      "Flow-Definition": { icon: "utility:flow", memberIcon: "utility:flow" },
      AssignmentRule: { icon: "utility:rules", memberIcon: "utility:rules" },
      AutoResponseRule: { icon: "utility:rules", memberIcon: "utility:rules" },
      EscalationRule: { icon: "utility:rules", memberIcon: "utility:rules" },
      SharingRule: { icon: "utility:share", memberIcon: "utility:share" },
      Territory2: {
        icon: "utility:world",
        memberIcon: "utility:world",
      },
      Territory2Type: {
        icon: "utility:world",
        memberIcon: "utility:world",
      },
      GlobalValueSet: { icon: "utility:list", memberIcon: "utility:list" },
      StandardValueSet: { icon: "utility:list", memberIcon: "utility:list" },
    };

    // Return specific mapping if found, otherwise return default
    // The default styling is handled by CSS for any unmatched data-type
    return (
      iconMap[typeName] || {
        icon: "utility:file",
        memberIcon: "utility:file",
      }
    );
  }

  // Computed properties for dynamic content
  get packageTypeConfig() {
    const configs = {
      skip: {
        title: "Skip Items Package",
        description: "Items ignored during metadata backup",
        icon: "utility:ban",
        infoIcon: "🚫",
        typesIcon: "📋",
        typesTitle: "Skipped Metadata Types",
        typesDescription:
          "Metadata types and components ignored during backup operations",
        wildcardMessage: "All members of this type are skipped (*)",
        emptyTitle: "No Skip Items Configured",
        emptyDescription:
          "This package file doesn't contain any metadata types to skip.",
        refreshTooltip: "Reload skip items package configuration",
        editTooltip: "Open the skip items package file for editing",
      },
      backup: {
        title: "Backup Items Package",
        description: "Items included in metadata backup",
        icon: "utility:save",
        infoIcon: "💾",
        typesIcon: "📦",
        typesTitle: "Backup Metadata Types",
        typesDescription:
          "Metadata types and components included in backup operations",
        wildcardMessage: "All members of this type are backed up (*)",
        emptyTitle: "No Backup Items Configured",
        emptyDescription:
          "This package file doesn't contain any metadata types for backup.",
        refreshTooltip: "Reload backup items package configuration",
        editTooltip: "Open the backup items package file for editing",
      },
      "all-org": {
        title: "All Org Items Package",
        description: "All items in the org including non-backed up items",
        icon: "utility:package",
        infoIcon: "📊",
        typesIcon: "🏢",
        typesTitle: "All Org Metadata Types",
        typesDescription:
          "Complete inventory of all metadata types and components in the org",
        wildcardMessage: "All members of this type are in the org (*)",
        emptyTitle: "No Org Items Found",
        emptyDescription:
          "This package file doesn't contain any metadata types from the org.",
        refreshTooltip: "Reload all org items package",
        editTooltip: "Open the all org items package file for editing",
      },
      deploy: {
        title: "Deployment Package",
        description: "Package contents for deployment",
        icon: "utility:upload", // use commonly available upload icon instead of deployment
        infoIcon: "🚀",
        typesIcon: "📤",
        typesTitle: "Deployment Contents",
        typesDescription:
          "Metadata types and components included in this deployment",
        wildcardMessage: "All members of this type are included (*)",
        emptyTitle: "No Deployment Contents",
        emptyDescription:
          "This deployment package doesn't contain any metadata types.",
        refreshTooltip: "Reload deployment package",
        editTooltip: "Open the deployment package file for editing",
      },
      retrieve: {
        title: "Retrieve Package",
        description: "Package definition for metadata retrieval",
        icon: "utility:file",
        infoIcon: "📥",
        typesIcon: "📦",
        typesTitle: "Retrieval Contents",
        typesDescription:
          "Metadata types and components to retrieve from the org",
        wildcardMessage: "All members of this type will be retrieved (*)",
        emptyTitle: "No Retrieval Contents",
        emptyDescription:
          "This retrieval package doesn't contain any metadata types.",
        refreshTooltip: "Reload retrieval package",
        editTooltip: "Open the retrieval package file for editing",
      },
      destructive: {
        title: "Destructive Changes",
        description: "Components marked for deletion",
        icon: "utility:delete",
        infoIcon: "🗑️",
        typesIcon: "❌",
        typesTitle: "Destructive Changes",
        typesDescription: "Metadata types and components to be deleted",
        wildcardMessage: "All members of this type will be deleted (*)",
        emptyTitle: "No Destructive Changes",
        emptyDescription:
          "This destructive changes package doesn't contain any components to delete.",
        refreshTooltip: "Reload destructive changes",
        editTooltip: "Open the destructive changes file for editing",
      },
      "no-overwrite": {
        title: "No Overwrite Package",
        description:
          "Metadata that will never be overwritten during deployment",
        icon: "utility:ban",
        infoIcon: "🔒",
        typesIcon: "🛡️",
        typesTitle: "Protected Metadata",
        typesDescription:
          "Metadata types and components protected from overwrite during deployment",
        wildcardMessage:
          "All members of this type are protected from overwrite (*)",
        emptyTitle: "No Protected Metadata",
        emptyDescription:
          "This no-overwrite package doesn't contain any protected metadata types.",
        refreshTooltip: "Reload no-overwrite package configuration",
        editTooltip: "Open the no-overwrite package file for editing",
      },
      manifest: {
        title: "Package Manifest",
        description: "Complete package definition",
        icon: "utility:file",
        infoIcon: "📄",
        typesIcon: "📋",
        typesTitle: "Package Contents",
        typesDescription: "All metadata types and components in this package",
        wildcardMessage: "All members of this type are included (*)",
        emptyTitle: "Empty Package",
        emptyDescription:
          "This package manifest doesn't contain any metadata types.",
        refreshTooltip: "Reload package manifest",
        editTooltip: "Open the package manifest file for editing",
      },
    };

    return configs[this.packageType] || configs.manifest;
  }

  get packageTitle() {
    return this.packageTypeConfig.title;
  }

  get packageDescription() {
    const baseDesc = this.packageTypeConfig.description;
    return this.packageFilePath
      ? `${baseDesc} from ${this.packageFilePath}`
      : baseDesc;
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
    return (
      this.packageData &&
      this.packageData.types &&
      this.packageData.types.length > 0
    );
  }

  get filteredTypes() {
    if (!this.packageData?.types) {
      return [];
    }

    if (!this.filterText) {
      return this.packageData.types;
    }

    return this.packageData.types
      .map((type) => {
        // Check if type name matches
        const typeNameMatches = type.name
          .toLowerCase()
          .includes(this.filterText);

        // Filter members that match
        let filteredMembers = type.members || [];
        if (!typeNameMatches && type.members && Array.isArray(type.members)) {
          filteredMembers = type.members.filter((member) =>
            member.toLowerCase().includes(this.filterText),
          );
        }

        // Include type if type name matches OR if any members match
        if (typeNameMatches || filteredMembers.length > 0) {
          return {
            ...type,
            members: typeNameMatches ? type.members : filteredMembers,
            memberCount: typeNameMatches
              ? type.hasWildcard
                ? "All"
                : type.members?.length || 0
              : filteredMembers.length,
          };
        }

        return null;
      })
      .filter((type) => type !== null);
  }

  get hasFilteredTypes() {
    return this.filteredTypes.length > 0;
  }

  get filteredTypesCount() {
    return this.filteredTypes.length;
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
  handleFilterChange(event) {
    this.filterText = event.target.value.toLowerCase();
  }

  toggleTypeExpansion(event) {
    const typeName = event.currentTarget.dataset.typeName;
    if (!typeName || !this.packageData?.types) return;

    // Update the specific type's expansion state
    this.packageData = {
      ...this.packageData,
      types: this.packageData.types.map((type) => {
        if (type.name === typeName) {
          const isExpanded = !type.isExpanded;
          return {
            ...type,
            isExpanded: isExpanded,
            expandIcon: isExpanded
              ? "utility:chevrondown"
              : "utility:chevronright",
          };
        }
        return type;
      }),
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
        filePath: this.packageFilePath,
      },
    });
  }

  editPackageFile() {
    window.sendMessageToVSCode({
      type: "editPackageFile",
      data: {
        filePath: this.packageFilePath,
      },
    });
  }
}
