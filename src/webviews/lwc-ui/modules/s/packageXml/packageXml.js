/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

// Configuration - Base URL for metadata type documentation
// Modify this URL to change where metadata type links point to
const METADATA_DOC_BASE_URL =
  "https://sf-explorer.github.io/sf-doc-to-json/#/cloud/all/object/";

const createEmptyPackageData = () => ({
  apiVersion: "",
  namespace: "",
  types: [],
});

export default class PackageXml extends SharedMixin(LightningElement) {
  @track packageData = createEmptyPackageData();
  @track isLoading = true;
  @track hasError = false;
  @track errorMessage = "";
  @track packageType = "skip"; // Default type: skip, deploy, retrieve, etc.
  @track packageFilePath = "";
  @track packageConfig = null;
  @track filterText = "";
  @track editMode = false;
  @track isMutating = false;
  @track showAddTypeModal = false;
  @track showAddMemberModal = false;
  @track newEntryName = "";
  @track pendingTypeNameForMember = "";

  modalNeedsFocus = false;

  expandedTypes = new Set();
  shouldRestoreViewPosition = false;
  lastScrollY = 0;

  @api
  initialize(data) {
    console.log("Package XML component initialized:", data);
    this.isLoading = false;

    this.packageConfig = data?.config || {};
    this.packageFilePath =
      this.packageConfig.filePath || "manifest/package.xml";

    this.packageType =
      this.packageConfig.type ||
      this.detectPackageTypeFromPath(this.packageFilePath);

    if (data?.error) {
      this.hasError = true;
      this.errorMessage = data.error;
      this.packageData = createEmptyPackageData();
      this.isMutating = false;
      this.shouldRestoreViewPosition = false;
      return;
    }

    if (data?.packageData) {
      this.hasError = false;
      const restorePosition = this.shouldRestoreViewPosition;
      this.packageData = this.processPackageData(data.packageData);
      this.isMutating = false;
      this.shouldRestoreViewPosition = false;

      if (restorePosition) {
        window.requestAnimationFrame(() => {
          window.scrollTo(0, this.lastScrollY || 0);
          this.isMutating = false;
          this.shouldRestoreViewPosition = false;
        });
      }
      return;
    }

    this.hasError = true;
    this.errorMessage = this.t("noPackageDataProvided");
    this.packageData = createEmptyPackageData();
    this.isMutating = false;
    this.shouldRestoreViewPosition = false;
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
    // Delegate to the SharedMixin's implementation
    if (super.handleColorThemeMessage)
      super.handleColorThemeMessage(type, data);
  }

  // Auto-detect package type from file path
  detectPackageTypeFromPath(filePath) {
    if (!filePath) {
      return "manifest";
    }

    const fileName = filePath.toLowerCase();

    if (fileName.includes("skip-items") || fileName.includes("package-skip")) {
      return "skip";
    }
    if (
      fileName.includes("backup-items") ||
      fileName.includes("package-backup")
    ) {
      return "backup";
    }
    if (
      fileName.includes("all-org-items") ||
      fileName.includes("package-all-org")
    ) {
      return "all-org";
    }
    if (fileName.includes("destructive")) {
      return "destructive";
    }
    if (
      fileName.includes("no-overwrite") ||
      fileName.includes("packagedeployonce")
    ) {
      return "no-overwrite";
    }
    if (fileName.includes("deploy")) {
      return "deploy";
    }
    if (fileName.includes("retrieve")) {
      return "retrieve";
    }
    return "manifest";
  }
  /* jscpd:ignore-start */
  // Process and enhance package data
  processPackageData(rawData) {
    const safeData = rawData || createEmptyPackageData();
    const typesSource = Array.isArray(safeData.types)
      ? safeData.types
      : createEmptyPackageData().types;
    const processedTypes = typesSource.map((type) => {
      const hasWildcard = type.members && type.members.includes("*");
      const rawMembers = hasWildcard ? [] : type.members || [];
      const members = rawMembers.map((memberName) => {
        const showDocLink =
          type.name === "CustomObject" &&
          typeof memberName === "string" &&
          !memberName.includes("__");
        return {
          name: memberName,
          showDocLink: showDocLink,
          docTooltip: showDocLink
            ? this.t("viewMemberDocumentation", { memberName })
            : "",
        };
      });
      const iconInfo = this.getMetadataTypeIcon(type.name);
      return {
        ...type,
        memberCount: hasWildcard ? this.t("memberCountAll") : members.length,
        memberCountLabel: hasWildcard
          ? this.t("memberCountAll")
          : this.t("membersLabel", { count: members.length }),
        hasWildcard: hasWildcard,
        members: members,
        isExpanded: this.expandedTypes.has(type.name),
        expandIcon: this.expandedTypes.has(type.name)
          ? "utility:chevrondown"
          : "utility:chevronright",
        iconName: iconInfo.icon,
        memberIconName: iconInfo.memberIcon,
      };
    });

    return {
      ...safeData,
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

  /* jscpd:ignore-end */

  // Computed properties for dynamic content
  get packageTypeConfig() {
    const configs = {
      skip: {
        title: this.t("pkgSkipTitle"),
        description: this.t("pkgSkipDescription"),
        icon: "utility:ban",
        infoIcon: "🚫",
        typesIcon: "📋",
        typesTitle: this.t("pkgSkipTypesTitle"),
        typesDescription: this.t("pkgSkipTypesDescription"),
        wildcardMessage: this.t("pkgSkipWildcard"),
        emptyTitle: this.t("pkgSkipEmptyTitle"),
        emptyDescription: this.t("pkgSkipEmptyDescription"),
        refreshTooltip: this.t("pkgSkipRefreshTooltip"),
        editTooltip: this.t("pkgSkipEditTooltip"),
      },
      backup: {
        title: this.t("pkgBackupTitle"),
        description: this.t("pkgBackupDescription"),
        icon: "utility:save",
        infoIcon: "💾",
        typesIcon: "📦",
        typesTitle: this.t("pkgBackupTypesTitle"),
        typesDescription: this.t("pkgBackupTypesDescription"),
        wildcardMessage: this.t("pkgBackupWildcard"),
        emptyTitle: this.t("pkgBackupEmptyTitle"),
        emptyDescription: this.t("pkgBackupEmptyDescription"),
        refreshTooltip: this.t("pkgBackupRefreshTooltip"),
        editTooltip: this.t("pkgBackupEditTooltip"),
      },
      "all-org": {
        title: this.t("pkgAllOrgTitle"),
        description: this.t("pkgAllOrgDescription"),
        icon: "utility:package",
        infoIcon: "📊",
        typesIcon: "🏢",
        typesTitle: this.t("pkgAllOrgTypesTitle"),
        typesDescription: this.t("pkgAllOrgTypesDescription"),
        wildcardMessage: this.t("pkgAllOrgWildcard"),
        emptyTitle: this.t("pkgAllOrgEmptyTitle"),
        emptyDescription: this.t("pkgAllOrgEmptyDescription"),
        refreshTooltip: this.t("pkgAllOrgRefreshTooltip"),
        editTooltip: this.t("pkgAllOrgEditTooltip"),
      },
      deploy: {
        title: this.t("pkgDeployTitle"),
        description: this.t("pkgDeployDescription"),
        icon: "utility:upload",
        infoIcon: "🚀",
        typesIcon: "📤",
        typesTitle: this.t("pkgDeployTypesTitle"),
        typesDescription: this.t("pkgDeployTypesDescription"),
        wildcardMessage: this.t("pkgDeployWildcard"),
        emptyTitle: this.t("pkgDeployEmptyTitle"),
        emptyDescription: this.t("pkgDeployEmptyDescription"),
        refreshTooltip: this.t("pkgDeployRefreshTooltip"),
        editTooltip: this.t("pkgDeployEditTooltip"),
      },
      retrieve: {
        title: this.t("pkgRetrieveTitle"),
        description: this.t("pkgRetrieveDescription"),
        icon: "utility:file",
        infoIcon: "📥",
        typesIcon: "📦",
        typesTitle: this.t("pkgRetrieveTypesTitle"),
        typesDescription: this.t("pkgRetrieveTypesDescription"),
        wildcardMessage: this.t("pkgRetrieveWildcard"),
        emptyTitle: this.t("pkgRetrieveEmptyTitle"),
        emptyDescription: this.t("pkgRetrieveEmptyDescription"),
        refreshTooltip: this.t("pkgRetrieveRefreshTooltip"),
        editTooltip: this.t("pkgRetrieveEditTooltip"),
      },
      destructive: {
        title: this.t("pkgDestructiveTitle"),
        description: this.t("pkgDestructiveDescription"),
        icon: "utility:delete",
        infoIcon: "🗑️",
        typesIcon: "❌",
        typesTitle: this.t("pkgDestructiveTypesTitle"),
        typesDescription: this.t("pkgDestructiveTypesDescription"),
        wildcardMessage: this.t("pkgDestructiveWildcard"),
        emptyTitle: this.t("pkgDestructiveEmptyTitle"),
        emptyDescription: this.t("pkgDestructiveEmptyDescription"),
        refreshTooltip: this.t("pkgDestructiveRefreshTooltip"),
        editTooltip: this.t("pkgDestructiveEditTooltip"),
      },
      "no-overwrite": {
        title: this.t("pkgNoOverwriteTitle"),
        description: this.t("pkgNoOverwriteDescription"),
        icon: "utility:ban",
        infoIcon: "🔒",
        typesIcon: "🛡️",
        typesTitle: this.t("pkgNoOverwriteTypesTitle"),
        typesDescription: this.t("pkgNoOverwriteTypesDescription"),
        wildcardMessage: this.t("pkgNoOverwriteWildcard"),
        emptyTitle: this.t("pkgNoOverwriteEmptyTitle"),
        emptyDescription: this.t("pkgNoOverwriteEmptyDescription"),
        refreshTooltip: this.t("pkgNoOverwriteRefreshTooltip"),
        editTooltip: this.t("pkgNoOverwriteEditTooltip"),
      },
      manifest: {
        title: this.t("pkgManifestTitle"),
        description: this.t("pkgManifestDescription"),
        icon: "utility:file",
        infoIcon: "📄",
        typesIcon: "📋",
        typesTitle: this.t("pkgManifestTypesTitle"),
        typesDescription: this.t("pkgManifestTypesDescription"),
        wildcardMessage: this.t("pkgManifestWildcard"),
        emptyTitle: this.t("pkgManifestEmptyTitle"),
        emptyDescription: this.t("pkgManifestEmptyDescription"),
        refreshTooltip: this.t("pkgManifestRefreshTooltip"),
        editTooltip: this.t("pkgManifestEditTooltip"),
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
      ? this.t("pkgDescriptionWithPath", {
          description: baseDesc,
          filePath: this.packageFilePath,
        })
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

  get addMemberToTypeLabel() {
    return this.t("addMemberToType", {
      typeName: this.pendingTypeNameForMember,
    });
  }

  get noMatchingResultsDescLabel() {
    return this.t("noMatchingResultsDesc", { filterText: this.filterText });
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
          filteredMembers = type.members.filter((member) => {
            const memberName = member?.name || "";
            return memberName.toLowerCase().includes(this.filterText);
          });
        }

        // Include type if type name matches OR if any members match
        if (typeNameMatches || filteredMembers.length > 0) {
          const count = typeNameMatches
            ? type.hasWildcard
              ? this.t("memberCountAll")
              : type.members?.length || 0
            : filteredMembers.length;
          return {
            ...type,
            members: typeNameMatches ? type.members : filteredMembers,
            memberCount: count,
            memberCountLabel:
              typeof count === "number"
                ? this.t("membersLabel", { count })
                : count,
            urlTooltip: this.t("viewTypeDocumentation", {
              typeName: type.name,
            }),
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

  toggleEditMode(event) {
    this.editMode = !!event.target?.checked;
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
          if (isExpanded) {
            this.expandedTypes.add(typeName);
          } else {
            this.expandedTypes.delete(typeName);
          }
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

  openMember(event) {
    try {
      const typeName = event.currentTarget?.dataset?.typeName || null;
      const member = event.currentTarget?.dataset?.memberName || null;
      if (!typeName || !member) return;
      window.sendMessageToVSCode({
        type: "openMetadataMember",
        data: { metadataType: typeName, metadataName: member },
      });
    } catch (e) {
      // ignore
    }
  }

  openStandardObjectDocumentation(event) {
    try {
      event.preventDefault();
      event.stopPropagation();
      const objectName = event.currentTarget?.dataset?.memberName || null;
      if (!objectName) {
        return;
      }
      if (objectName.includes("__")) {
        return;
      }
      const docUrl = `${METADATA_DOC_BASE_URL}${objectName}`;
      window.sendMessageToVSCode({
        type: "openExternal",
        data: docUrl,
      });
    } catch (e) {
      // ignore
    }
  }

  openMetadataDocumentation(event) {
    try {
      event.preventDefault();
      const typeName = event.currentTarget?.dataset?.typeName || null;
      if (!typeName) return;
      const docUrl = `${METADATA_DOC_BASE_URL}${typeName}`;
      window.sendMessageToVSCode({
        type: "openExternal",
        data: docUrl,
      });
    } catch (e) {
      // ignore
    }
  }

  stopPropagation(event) {
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  }

  openAddModal(typeName = "") {
    this.pendingTypeNameForMember = typeName;
    this.newEntryName = "";
    this.showAddTypeModal = !typeName;
    this.showAddMemberModal = !!typeName;
    this.modalNeedsFocus = true;
  }

  addMetadataType(event) {
    try {
      this.stopPropagation(event);
      this.openAddModal();
    } catch (e) {
      // ignore
    }
  }

  addMetadataMember(event) {
    try {
      this.stopPropagation(event);
      const typeName = event?.currentTarget?.dataset?.typeName;
      if (!typeName) {
        return;
      }
      this.openAddModal(typeName);
    } catch (e) {
      // ignore
    }
  }

  removeMetadataType(event) {
    try {
      const typeName = event?.currentTarget?.dataset?.typeName;
      this.handleRemoval(event, typeName, null, "removeMetadataType");
    } catch (e) {
      // ignore
    }
  }

  removeMetadataMember(event) {
    try {
      const typeName = event?.currentTarget?.dataset?.typeName;
      const memberName = event?.currentTarget?.dataset?.memberName;
      this.handleRemoval(event, typeName, memberName, "removeMetadataMember");
    } catch (e) {
      // ignore
    }
  }

  handleRemoval(event, typeName, memberName, messageType) {
    this.stopPropagation(event);

    if (!typeName || (messageType === "removeMetadataMember" && !memberName)) {
      return;
    }

    this.captureViewPosition();
    this.isMutating = true;
    this.expandedTypes.add(typeName);
    this.shouldRestoreViewPosition = true;

    const data = {
      filePath: this.packageFilePath,
      metadataType: typeName,
    };

    if (messageType === "removeMetadataMember") {
      data.memberName = memberName;
    }

    window.sendMessageToVSCode({
      type: messageType,
      data,
    });
  }

  captureViewPosition() {
    this.lastScrollY = window.scrollY || 0;
  }

  handleModalInputChange(event) {
    this.newEntryName = event.target.value || "";
  }

  handleModalKeydown(event) {
    if (event?.key !== "Enter") {
      return;
    }

    this.stopPropagation(event);
    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    if (this.showAddMemberModal) {
      this.confirmAddMember();
      return;
    }

    this.confirmAddType();
  }

  confirmAddType() {
    const cleanName = (this.newEntryName || "").trim();
    if (!cleanName) {
      this.closeModals();
      return;
    }

    this.isMutating = true;
    window.sendMessageToVSCode({
      type: "addMetadataType",
      data: {
        filePath: this.packageFilePath,
        metadataType: cleanName,
      },
    });
    this.closeModals();
  }

  confirmAddMember() {
    const cleanName = (this.newEntryName || "").trim();
    if (!cleanName || !this.pendingTypeNameForMember) {
      this.closeModals();
      return;
    }

    this.isMutating = true;
    window.sendMessageToVSCode({
      type: "addMetadataMember",
      data: {
        filePath: this.packageFilePath,
        metadataType: this.pendingTypeNameForMember,
        memberName: cleanName,
      },
    });
    this.closeModals();
  }

  closeModals() {
    this.showAddTypeModal = false;
    this.showAddMemberModal = false;
    this.newEntryName = "";
    this.pendingTypeNameForMember = "";
    this.modalNeedsFocus = false;
  }

  renderedCallback() {
    if (!this.modalNeedsFocus) {
      return;
    }

    if (!this.showAddTypeModal && !this.showAddMemberModal) {
      this.modalNeedsFocus = false;
      return;
    }

    const input = this.template.querySelector('[data-modal-input="new-entry"]');
    if (input && typeof input.focus === "function") {
      // Defer focus until DOM is painted to avoid race conditions.
      window.requestAnimationFrame(() => {
        try {
          input.focus();
        } finally {
          this.modalNeedsFocus = false;
        }
      });
      return;
    }

    this.modalNeedsFocus = false;
  }
}
