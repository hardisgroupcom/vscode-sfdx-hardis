import { LightningElement, api, track } from "lwc";

/**
 * LWC to retrieve and search metadata from a Salesforce org
 * Supports two modes: Recent Changes (SourceMember) and All Metadata (Metadata API)
 */

// Configuration - Base URL for metadata type documentation
// Modify this URL to change where metadata type links point to
const METADATA_DOC_BASE_URL =
  "https://sf-explorer.github.io/sf-doc-to-json/#/cloud/all/object/";

export default class MetadataRetriever extends LightningElement {
  @api orgs = [];
  @api metadataTypes = [];
  @track selectedOrg = null;
  @track queryMode = "recentChanges"; // "recentChanges" or "allMetadata"
  @track metadataType = "All";
  @track packageFilter = "All";
  @track packageOptions = [
    { label: "All", value: "All" },
    { label: "Local", value: "Local" },
  ];
  @track metadataName = "";
  @track lastUpdatedBy = "";
  @track dateFrom = "";
  @track dateTo = "";
  @track searchTerm = "";
  @track hasSearched = false;
  @track checkLocalFiles = false;
  @track checkLocalAvailable = true;
  @track isLoadingOrgs = false;
  @track isLoadingPackages = false;
  @track isLoading = false;
  @track metadata = [];
  @track filteredMetadata = [];
  @track error = null;
  @track selectedRows = [];
  @track selectedRowKeys = [];
  @track showFeature = false;
  @track featureId = null;
  @track featureText;
  @track imgFeatureLogo = "";

  // Local package selector (sfdx-project.json packageDirectories)
  @track localPackageOptions = [];
  @track selectedLocalPackage = null;
  @track initialLocalPackage = null;
  @track isRetrieving = false;

  // Performance optimization properties
  searchDebounceTimer = null;
  cachedDateFrom = null;
  cachedDateTo = null;

  // Datatable columns - computed based on mode
  get columns() {
    // Build columns step by step so we can insert the Change icon column
    const cols = [];

    // If in Recent Changes mode, insert change icon column after Metadata Name
    if (this.isRecentChangesMode) {
      // Emoji column for change operation (created/modified/deleted)
      cols.push({
        label: "Operation",
        fieldName: "ChangeIcon",
        type: "text",
        cellAttributes: {
          alignment: "center",
        },
        initialWidth: 30,
      });
    }

    // Metadata Type
    cols.push({
      label: "Metadata Type",
      fieldName: "MemberTypeUrl",
      type: "url",
      sortable: true,
      wrapText: true,
      initialWidth: 160,
      typeAttributes: {
        label: { fieldName: "MemberType" },
        tooltip: { fieldName: "MemberTypeTitle" },
        target: "_blank",
      },
    });

    // Metadata Name
    cols.push({
      label: "Metadata Name",
      fieldName: "MemberName",
      type: "button",
      sortable: true,
      wrapText: true,
      typeAttributes: {
        label: { fieldName: "MemberName" },
        title: { fieldName: "MemberNameTitle" },
        name: "open",
        variant: "base",
      },
      cellAttributes: {
        alignment: "left",
        class: "metadata-name-button",
      },
    });

    // Last Updated By
    cols.push({
      label: "Last Updated By",
      fieldName: "LastModifiedByName",
      type: "text",
      sortable: true,
      wrapText: true,
      initialWidth: 165,
    });

    // Last Updated Date
    cols.push({
      label: "Last Updated Date",
      fieldName: "LastModifiedDate",
      type: "date",
      sortable: true,
      typeAttributes: {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      },
      initialWidth: 165,
    });

    // Local file existence column (centered) - only when the user enabled the toggle
    if (this.checkLocalFiles) {
      cols.push({
        label: "Local",
        fieldName: "LocalFileIcon",
        type: "text",
        cellAttributes: {
          alignment: "center",
        },
        initialWidth: 30,
      });
    }

    // Add download icon column (single-icon button)
    // Use a 'button-icon' column so users can click the download icon directly
    cols.push({
      type: "button-icon",
      typeAttributes: {
        iconName: "utility:download",
        title: "Download",
        variant: "bare",
        alternativeText: "Download",
        name: "download",
      },
      initialWidth: 30,
      cellAttributes: {
        alignment: "center",
      },
    });

    return cols;
  }

  get orgOptions() {
    if (!this.orgs || !Array.isArray(this.orgs)) {
      return [];
    }
    const formatLabel = (org) => {
      if (org.instanceUrl) {
        return org.instanceUrl
          .replace(/^https?:\/\//i, "")
          .replace(/\/$/, "")
          .replace(/\.my\.salesforce\.com$/i, "");
      }
      return org.alias || org.username;
    };

    const sortedOrgs = [...this.orgs].sort((a, b) => {
      const nameA = formatLabel(a).toLowerCase();
      const nameB = formatLabel(b).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const sortedOrgsValues = sortedOrgs.map((org) => ({
      label: formatLabel(org),
      value: org.username,
    }));

    if (this.isLoadingOrgs) {
      sortedOrgsValues.push({ label: "Loading...", value: "" });
    }

    return sortedOrgsValues;
  }

  get metadataTypeOptions() {
    // In All Metadata mode, don't include "All" option
    const options =
      this.queryMode === "allMetadata" ? [] : [{ label: "All", value: "All" }];
    if (this.metadataTypes && Array.isArray(this.metadataTypes)) {
      return options.concat(this.metadataTypes);
    }
    return options;
  }

  get queryModeOptions() {
    return [
      { label: "Recent Changes", value: "recentChanges" },
      { label: "All Metadata", value: "allMetadata" },
    ];
  }

  get isRecentChangesMode() {
    return this.queryMode === "recentChanges";
  }

  get isAllMetadataMode() {
    return this.queryMode === "allMetadata";
  }

  // Template-friendly properties (avoid inline expressions in HTML)
  get checkLocalDisabled() {
    return !this.checkLocalAvailable;
  }

  get checkLocalTooltip() {
    return this.checkLocalAvailable
      ? ""
      : "No sfdx-project.json found in workspace root - local file checks disabled";
  }

  get hasResults() {
    return this.filteredMetadata && this.filteredMetadata.length > 0;
  }

  // Show results area when there are displayed results OR when metadata was loaded
  // from the backend (even if client-side filtering currently hides all rows). This
  // ensures the "search in results" input and retrieve actions remain accessible
  // so the user can refine or clear client-side filters.
  get showResultsArea() {
    return this.hasResults || this.hasMetadataLoaded;
  }

  // True when any metadata records have been loaded from the backend
  // even if client-side filters reduce displayed rows to zero. This
  // lets the UI keep the "search in results" input and actions visible
  // so users can refine the client-side search.
  get hasMetadataLoaded() {
    return this.metadata && this.metadata.length > 0;
  }

  get noResults() {
    // Only show the No Results state when a search has been performed
    return (
      this.hasSearched &&
      !this.isLoading &&
      this.filteredMetadata &&
      this.filteredMetadata.length === 0
    );
  }

  get hasError() {
    return this.error !== null;
  }

  get canSearch() {
    if (this.selectedOrg === null) {
      return false;
    }
    // In All Metadata mode, require a specific metadata type
    if (
      this.queryMode === "allMetadata" &&
      (this.metadataType === "All" || !this.metadataType)
    ) {
      return false;
    }
    return true;
  }

  get cannotSearch() {
    return !this.canSearch;
  }

  get hasSelectedRows() {
    return this.selectedRows && this.selectedRows.length > 0;
  }

  get retrieveSelectedLabel() {
    const count = this.selectedRows ? this.selectedRows.length : 0;
    return count > 0
      ? `Retrieve ${count} Selected Metadata`
      : "Retrieve Selected Metadata";
  }

  connectedCallback() {
    // Notify VS Code that the component is initialized
    this.isLoadingOrgs = true;
    window.sendMessageToVSCode({ type: "listOrgs" });
    // Bind a debounced visibility check for the floating retrieve button
    this._visibilityDebounceTimer = null;
    this._boundDoDebouncedCheck = () => {
      // Debounce: wait a small time before performing the expensive DOM checks
      if (this._visibilityDebounceTimer) {
        clearTimeout(this._visibilityDebounceTimer);
      }
      this._visibilityDebounceTimer = setTimeout(() => {
        this.checkRetrieveButtonVisibility();
        this._visibilityDebounceTimer = null;
      }, 120); // 120ms debounce to avoid layout thrashing during scroll/resize
    };

    // Listen to global scroll/resize events to detect when the main button goes off-screen
    window.addEventListener("scroll", this._boundDoDebouncedCheck, true);
    window.addEventListener("resize", this._boundDoDebouncedCheck);
    // Initial evaluation after the UI has rendered
    setTimeout(() => this._boundDoDebouncedCheck(), 50);
  }

  disconnectedCallback() {
    // Clean up listeners
    if (this._boundDoDebouncedCheck) {
      window.removeEventListener("scroll", this._boundDoDebouncedCheck, true);
      window.removeEventListener("resize", this._boundDoDebouncedCheck);
      this._boundDoDebouncedCheck = null;
    }
    if (this._visibilityDebounceTimer) {
      clearTimeout(this._visibilityDebounceTimer);
      this._visibilityDebounceTimer = null;
    }
  }

  @api
  initialize(data) {
    if (data) {
      if (data.orgs && Array.isArray(data.orgs)) {
        this.orgs = data.orgs;
        // Set default org if provided or use first available
        if (data.selectedOrgUsername) {
          this.selectedOrg = data.selectedOrgUsername;
        } else if (this.orgs.length > 0) {
          this.selectedOrg = this.orgs[0].username;
        }
        window.sendMessageToVSCode({
          type: "listMetadataTypes",
          data: { username: this.selectedOrg },
        });
      }
      if (data.metadataTypes && Array.isArray(data.metadataTypes)) {
        this.metadataTypes = data.metadataTypes;
      }
      // Backend can indicate whether local file checking is available
      if (typeof data.checkLocalAvailable === "boolean") {
        this.checkLocalAvailable = data.checkLocalAvailable;
        if (!this.checkLocalAvailable) {
          this.checkLocalFiles = false; // force-uncheck
        }
      }

      // Local packages from sfdx-project.json
      if (data.localPackageOptions && Array.isArray(data.localPackageOptions)) {
        this.localPackageOptions = data.localPackageOptions;
      }
      if (data.defaultLocalPackage) {
        this.selectedLocalPackage = data.defaultLocalPackage;
        this.initialLocalPackage = data.defaultLocalPackage;
      } else if (
        this.localPackageOptions &&
        Array.isArray(this.localPackageOptions) &&
        this.localPackageOptions.length > 0
      ) {
        this.selectedLocalPackage = this.localPackageOptions[0].value;
        this.initialLocalPackage = this.selectedLocalPackage;
      }
    }
  }

  // Show the selector only when the retrieve action is visible
  get showLocalPackageSelector() {
    return (
      this.hasSelectedRows &&
      this.localPackageOptions &&
      Array.isArray(this.localPackageOptions) &&
      this.localPackageOptions.length > 1
    );
  }

  get localPackageDisabled() {
    return this.isRetrieving === true;
  }

  handleLocalPackageChange(event) {
    if (this.isRetrieving === true) {
      return;
    }
    this.selectedLocalPackage = event.detail.value;
  }

  handleOrgChange(event) {
    this.selectedOrg = event.detail.value;
    // When org changes, clear any current results and selections
    this.metadata = [];
    this.filteredMetadata = [];
    this.selectedRows = [];
    this.selectedRowKeys = [];
    this.error = null;
    this.isLoading = false;
    // Reset search state when switching orgs
    this.hasSearched = false;

    // When org changes, lazy-load installed package namespaces for that org
    this.isLoadingPackages = true;
    window.sendMessageToVSCode({
      type: "listPackages",
      data: { username: this.selectedOrg },
    });
    // Reset package filter to All
    this.packageFilter = "All";
    // When org changes, lazy-load available metadatas for that org
    window.sendMessageToVSCode({
      type: "listMetadataTypes",
      data: { username: this.selectedOrg },
    });
  }

  handleCheckLocalChange(event) {
    if (!this.checkLocalAvailable) {
      this.checkLocalFiles = false;
      return;
    }
    // lightning-input toggle may expose the boolean on event.target.checked or event.detail.checked
    const newVal =
      event.target?.checked === true ||
      event.detail?.checked === true ||
      event.detail?.value === true;
    this.checkLocalFiles = newVal;

    // If the user just enabled the toggle and we already performed a search,
    // re-run the server query to request annotated results (LocalFileExists).
    if (newVal === true && this.hasSearched && this.canSearch) {
      // small timeout to allow UI to update toggle state before triggering search
      setTimeout(() => this.handleSearch(), 50);
    }
  }

  handleQueryModeChange(event) {
    this.queryMode = event.detail.value;
    // Reset metadata type when switching to All Metadata mode (force user to select)
    if (this.queryMode === "allMetadata") {
      if (this.metadataType === "All") {
        this.metadataType = "";
      }
    } else {
      // Reset to "All" when switching back to Recent Changes mode
      if (!this.metadataType) {
        this.metadataType = "All";
      }
    }
    // Clear results when switching modes
    this.metadata = [];
    this.filteredMetadata = [];
    this.selectedRows = [];
    this.selectedRowKeys = [];
    // Reset search state when switching query modes
    this.hasSearched = false;
  }

  handleRowSelection(event) {
    const currentlySelectedRows = event.detail.selectedRows;
    const currentlySelectedKeys = currentlySelectedRows.map(
      (row) => row.uniqueKey,
    );

    // Get keys of currently visible rows in the datatable
    const visibleKeys = this.filteredMetadata.map((row) => row.uniqueKey);

    // Remove unselected visible keys from master list
    this.selectedRowKeys = this.selectedRowKeys.filter(
      (key) => !visibleKeys.includes(key),
    );

    // Add newly selected keys
    this.selectedRowKeys = [...this.selectedRowKeys, ...currentlySelectedKeys];

    // Update selectedRows to include all selected items from metadata (not just filtered)
    this.selectedRows = this.metadata.filter((row) =>
      this.selectedRowKeys.includes(row.uniqueKey),
    );

    // Update floating retrieve button visibility after selection changes
    // Use a timeout to ensure DOM updates are applied before measuring
    setTimeout(() => this.checkRetrieveButtonVisibility(), 0);
  }

  handleMetadataTypeChange(event) {
    this.metadataType = event.detail.value;
    this.applyFilters();
  }

  handlePackageChange(event) {
    this.packageFilter = event.detail.value;
    // Update filters immediately
    this.applyFilters();
  }

  handleMetadataNameChange(event) {
    this.metadataName = event.target.value;
    this.applyFilters();
  }

  handleLastUpdatedByChange(event) {
    this.lastUpdatedBy = event.target.value;
    // Easter egg: show modal when user types 'Masha' (case-insensitive)
    try {
      const v = (this.lastUpdatedBy || "").toString().trim();
      if (v.toLowerCase() === "masha") {
        // random feature id for element attributes
        this.featureId = Math.random().toString(36).slice(2, 10);
        // Calculate number of days before November 29, 2025
        const days =
          Math.ceil(
            (new Date("2025-11-29") - new Date()) / (1000 * 60 * 60 * 24),
          ) - 1;
        this.featureText = `See you in ${days} days 😘`;
        this.showFeature = true;
        // Add keydown listener to close on ESC
        this._boundFeatureKeydown = (e) => {
          if (e.key === "Escape") {
            this.hideFeature();
          }
        };
        window.addEventListener("keydown", this._boundFeatureKeydown);
      }
    } catch (e) {
      // ignore
    }

    this.applyFilters();
  }

  hideFeature() {
    this.showFeature = false;
    this.featureId = null;
    if (this._boundFeatureKeydown) {
      window.removeEventListener("keydown", this._boundFeatureKeydown);
      this._boundFeatureKeydown = null;
    }
  }

  handleDateFromChange(event) {
    this.dateFrom = event.target.value;
    this.applyFilters();
  }

  handleDateToChange(event) {
    this.dateTo = event.target.value;
    this.applyFilters();
  }

  handleSearchChange(event) {
    this.searchTerm = event.target.value;
    // Debounce the filter application
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.applyFilters();
      // Force re-render of datatable to restore selection state
      this.selectedRowKeys = [...this.selectedRowKeys];
      this.searchDebounceTimer = null;
    }, 300);
  }

  handleSearch() {
    if (!this.canSearch) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    // Mark that a search has been performed
    this.hasSearched = true;
    // Clear existing metadata and client-side text filter to ensure a fresh server search
    this.metadata = [];
    this.filteredMetadata = [];
    // Clear client-side search term and any pending debounce
    this.searchTerm = "";
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    this.selectedRows = [];
    this.selectedRowKeys = [];

    // Send filter criteria to VS Code with query mode
    window.sendMessageToVSCode({
      type: "queryMetadata",
      data: {
        username: this.selectedOrg,
        queryMode: this.queryMode,
        metadataType:
          this.metadataType && this.metadataType !== "All"
            ? this.metadataType
            : null,
        metadataName: this.metadataName || null,
        packageFilter:
          this.packageFilter && this.packageFilter !== "All"
            ? this.packageFilter
            : null,
        lastUpdatedBy: this.isRecentChangesMode
          ? this.lastUpdatedBy || null
          : null,
        dateFrom: this.isRecentChangesMode ? this.dateFrom || null : null,
        dateTo: this.isRecentChangesMode ? this.dateTo || null : null,
        checkLocalFiles: this.checkLocalFiles || false,
      },
    });
  }

  handleRetrieveSelected() {
    if (!this.hasSelectedRows) {
      return;
    }

    // Send selected metadata to VS Code for bulk retrieval
    window.sendMessageToVSCode({
      type: "retrieveSelectedMetadata",
      data: {
        username: this.selectedOrg,
        localPackage: this.selectedLocalPackage,
        metadata: this.selectedRows.map((row) => ({
          memberType: row.MemberType,
          memberName: row.MemberName,
          deleted: row.ChangeIcon === "🔴",
        })),
      },
    });
  }

  handleClearFilters() {
    this.metadataType = "All";
    this.metadataName = "";
    this.lastUpdatedBy = "";
    this.dateFrom = "";
    this.dateTo = "";
    this.searchTerm = "";
    this.packageFilter = "All";
    this.selectedRows = [];
    this.selectedRowKeys = [];
    this.applyFilters();
  }

  handleViewHistory() {
    window.sendMessageToVSCode({
      type: "openRetrieveFolder",
      data: {},
    });
  }

  applyFilters() {
    if (!this.metadata || this.metadata.length === 0) {
      this.filteredMetadata = [];
      return;
    }

    // Cache date objects to avoid creating new ones for every item
    let fromDate = null;
    if (this.dateFrom) {
      fromDate = new Date(this.dateFrom);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
      } else {
        fromDate = null;
      }
    }

    let toDate = null;
    if (this.dateTo) {
      toDate = new Date(this.dateTo);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
      } else {
        toDate = null;
      }
    }

    // Cache lowercase strings to avoid multiple toLowerCase() calls
    const metadataNameLower = this.metadataName
      ? this.metadataName.toLowerCase()
      : null;
    const userLower = this.lastUpdatedBy
      ? this.lastUpdatedBy.toLowerCase()
      : null;
    const searchLower = this.searchTerm ? this.searchTerm.toLowerCase() : null;

    // Single pass filtering
    this.filteredMetadata = this.metadata.filter((item) => {
      // Apply metadata type filter
      if (this.metadataType && this.metadataType !== "All") {
        if (item.MemberType !== this.metadataType) {
          return false;
        }
      }

      // Apply metadata name filter
      if (metadataNameLower) {
        if (
          !item.MemberName ||
          !item.MemberName.toLowerCase().includes(metadataNameLower)
        ) {
          return false;
        }
      }

      // Apply last updated by filter
      if (userLower) {
        if (
          !item.LastModifiedByName ||
          !item.LastModifiedByName.toLowerCase().includes(userLower)
        ) {
          return false;
        }
      }

      // Apply date range filters
      if (fromDate && item.LastModifiedDate) {
        const itemDate = new Date(item.LastModifiedDate);
        if (itemDate < fromDate) {
          return false;
        }
      }

      if (toDate && item.LastModifiedDate) {
        const itemDate = new Date(item.LastModifiedDate);
        if (itemDate > toDate) {
          return false;
        }
      }

      // Apply package filter (client-side)
      if (this.packageFilter && this.packageFilter !== "All") {
        const pf = this.packageFilter;
        const fullName = item.MemberName || "";
        const compName = fullName.includes(".")
          ? fullName.split(".").pop() || fullName
          : fullName;
        if (pf === "Local") {
          // Local = ends with official suffix AND has only one __ (no namespace prefix)
          const doubleUnderscoreCount = (compName.match(/__/g) || []).length;

          if (doubleUnderscoreCount === 0) {
            // No __ at all -> local (standard metadata)
            return true;
          }

          if (doubleUnderscoreCount === 1) {
            // One __: check if it's an official suffix
            const officialSuffixes = [
              "__c",
              "__r",
              "__x",
              "__s",
              "__mdt",
              "__b",
            ];
            const hasOfficialSuffix = officialSuffixes.some((suffix) =>
              compName.endsWith(suffix),
            );
            if (hasOfficialSuffix) {
              return true; // local
            }
            // One __ but no official suffix (e.g., CodeBuilder__something) -> packaged
            return false;
          }

          // Multiple __ -> packaged
          return false;
        } else {
          // Component segment must start with namespace__ pattern
          const nsPattern = `${pf}__`;
          if (!compName.startsWith(nsPattern)) {
            return false; // not this namespace -> exclude
          }
        }
      }

      // Apply search term filter (searches across all fields)
      if (searchLower) {
        const matchesSearch =
          (item.MemberType &&
            item.MemberType.toLowerCase().includes(searchLower)) ||
          (item.MemberName &&
            item.MemberName.toLowerCase().includes(searchLower)) ||
          (item.LastModifiedByName &&
            item.LastModifiedByName.toLowerCase().includes(searchLower));
        if (!matchesSearch) {
          return false;
        }
      }

      return true;
    });
  }

  handleRowAction(event) {
    // datatable action events provide event.detail.action (with a name)
    // button-icon columns provide event.detail.name directly
    const row = event.detail.row || event.detail.payload;
    const actionName =
      (event.detail.action && event.detail.action.name) ||
      event.detail.name ||
      null;

    if (actionName === "download") {
      // support legacy 'retrieve' and new 'download' name
      this.handleRetrieve(row);
      return;
    }

    if (actionName === "open") {
      // user clicked the metadata name button -> request extension to open file
      window.sendMessageToVSCode({
        type: "openMetadataFile",
        data: { metadataType: row.MemberType, metadataName: row.MemberName },
      });
      return;
    }
  }

  handleRetrieve(row) {
    window.sendMessageToVSCode({
      type: "retrieveMetadata",
      data: {
        username: this.selectedOrg,
        localPackage: this.selectedLocalPackage,
        memberType: row.MemberType,
        memberName: row.MemberName,
        deleted: row.ChangeIcon === "🔴",
      },
    });
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    } else if (type === "imageResources") {
      this.handleImageResources(data);
    } else if (type === "listOrgsResults") {
      this.handleOrgResults(data);
    } else if (type === "listPackagesResults") {
      this.handleListPackagesResults(data);
    } else if (type === "listMetadataTypesResults") {
      this.handleListMetadataTypesResults(data);
    } else if (type === "queryResults") {
      this.handleQueryResults(data);
    } else if (type === "queryError") {
      this.handleQueryError(data);
    } else if (type === "postRetrieveLocalCheck") {
      this.handlePostRetrieveLocalCheck(data);
    } else if (type === "retrieveState") {
      this.handleRetrieveState(data);
    }
  }

  handleRetrieveState(data) {
    if (data && typeof data.isRetrieving === "boolean") {
      this.isRetrieving = data.isRetrieving;
    }
  }

  handleImageResources(data) {
    if (data && data?.images?.featureLogo) {
      this.imgFeatureLogo = data.images.featureLogo;
    }
  }

  handlePostRetrieveLocalCheck(data) {
    // data.files contains annotated records with MemberType, MemberName, LocalFileExists
    const updates = new Map();
    for (const f of data.files) {
      const key = `${f.MemberType}::${f.MemberName}`;
      updates.set(key, f.LocalFileExists);
    }

    // Update existing metadata entries if present
    let changed = false;
    this.metadata = this.metadata.map((row) => {
      const key = `${row.MemberType}::${row.MemberName}`;
      if (updates.has(key)) {
        const exists = updates.get(key);
        changed = true;
        return { ...row, LocalFileIcon: exists === true ? "✅" : "❌" };
      }
      return row;
    });

    // Also unselect any rows that were successfully retrieved (present in data.files)
    try {
      const keysToRemove = new Set();
      for (const f of [...data.files, ...(data.deletedFiles || [])]) {
        const k = `${f.MemberType || f.memberType}::${f.MemberName || f.memberName}`;
        keysToRemove.add(k);
      }

      if (this.selectedRowKeys && this.selectedRowKeys.length > 0) {
        const beforeCount = this.selectedRowKeys.length;
        this.selectedRowKeys = this.selectedRowKeys.filter(
          (k) => !keysToRemove.has(k),
        );
        // Recompute selectedRows based on remaining selectedRowKeys
        this.selectedRows = this.metadata.filter((row) =>
          this.selectedRowKeys.includes(row.uniqueKey),
        );
        if (this.selectedRowKeys.length !== beforeCount) {
          changed = true;
        }
      }
    } catch (e) {
      // non-fatal
    }

    if (changed) {
      // Re-apply client-side filters to refresh the datatable
      this.applyFilters();
      // Re-evaluate floating button visibility since selection/rows might have changed
      setTimeout(() => this.checkRetrieveButtonVisibility(), 0);
    }
  }

  handleOrgResults(data) {
    this.isLoadingOrgs = false;
    if (data && data.orgs && Array.isArray(data.orgs)) {
      this.orgs = data.orgs;
      // Set default org if provided or use first available
      if (data.selectedOrgUsername) {
        this.selectedOrg = data.selectedOrgUsername;
        // Trigger package loading for the selected org
        this.isLoadingPackages = true;
        window.sendMessageToVSCode({
          type: "listPackages",
          data: { username: this.selectedOrg },
        });
      }
    }
  }

  handleListPackagesResults(data) {
    this.isLoadingPackages = false;
    if (data && data.packages && Array.isArray(data.packages)) {
      this.packageOptions = data.packages;
    } else {
      // Fallback to default options
      this.packageOptions = [
        { label: "All", value: "All" },
        { label: "Local", value: "Local" },
      ];
    }
  }

  handleListMetadataTypesResults(data) {
    if (data && data.metadataTypes && Array.isArray(data.metadataTypes)) {
      this.metadataTypes = data.metadataTypes;
    }
  }

  handleQueryResults(data) {
    this.isLoading = false;
    if (data && data.records && Array.isArray(data.records)) {
      // Transform records - handle both SourceMember (nested) and Metadata API (flat) formats
      this.metadata = data.records.map((record) => {
        // Use Operation from backend (created/modified/deleted) — guaranteed to be set
        const opVal = (record.Operation || "").toString().toLowerCase();
        // Map operation to colored emoji: created -> green, modified -> yellow, deleted -> red
        let icon = "🟡"; // default = modified
        if (opVal === "created") {
          icon = "🟢";
        } else if (opVal === "deleted") {
          icon = "🔴";
        }

        return {
          MemberName: record.MemberName,
          MemberType: record.MemberType,
          MemberTypeUrl: `${METADATA_DOC_BASE_URL}${record.MemberType}`,
          MemberTypeTitle: `View ${record.MemberType} documentation`,
          MemberNameTitle: `Open metadata for ${record.MemberType} ${record.MemberName}`,
          LastModifiedDate: record.LastModifiedDate,
          // Handle both SourceMember format (LastModifiedBy.Name) and Metadata API format (lastModifiedByName)
          LastModifiedByName:
            record.LastModifiedByName ||
            (record.LastModifiedBy ? record.LastModifiedBy.Name : "") ||
            "",
          uniqueKey: `${record.MemberType}::${record.MemberName}`,
          ChangeIcon: icon,
          // Local file indicator: show  when present; otherwise leave empty
          LocalFileIcon: record.LocalFileExists === true ? "✔️" : "",
        };
      });
      this.applyFilters();
    } else {
      this.metadata = [];
      this.filteredMetadata = [];
    }
  }

  handleQueryError(data) {
    this.isLoading = false;
    this.error =
      data && data.message
        ? data.message
        : "An error occurred while querying metadata";
    this.metadata = [];
    this.filteredMetadata = [];
  }

  handleSort(event) {
    const { fieldName, sortDirection } = event.detail;
    this.sortBy = fieldName;
    this.sortDirection = sortDirection;
    this.sortData(fieldName, sortDirection);
  }

  sortData(fieldName, direction) {
    const parseData = JSON.parse(JSON.stringify(this.filteredMetadata));
    const keyValue = (a) => {
      return a[fieldName];
    };
    const isReverse = direction === "asc" ? 1 : -1;
    parseData.sort((x, y) => {
      x = keyValue(x) ? keyValue(x) : "";
      y = keyValue(y) ? keyValue(y) : "";
      return isReverse * ((x > y) - (y > x));
    });
    this.filteredMetadata = parseData;
  }

  // Show/hide the floating retrieve button depending on whether the main button
  // is visible in the viewport and whether there are selected rows.
  checkRetrieveButtonVisibility() {
    try {
      const floating = this.template.querySelector(
        '[data-id="retrieve-button-floating"]',
      );
      const mainBtn = this.template.querySelector(
        '[data-id="retrieve-button"]',
      );

      if (!floating) {
        return;
      }

      // If no selected rows, always hide floating button
      if (!this.hasSelectedRows) {
        floating.classList.remove("visible");
        return;
      }

      // If main button is not present in DOM, show floating button
      if (!mainBtn) {
        floating.classList.add("visible");
        return;
      }

      // Check if main button is fully visible in the viewport
      const rect = mainBtn.getBoundingClientRect();
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight;
      const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;

      if (isFullyVisible) {
        floating.classList.remove("visible");
      } else {
        floating.classList.add("visible");
      }
    } catch (e) {
      // In case of any unexpected DOM issues, hide the floating button to be safe
      try {
        const floating = this.template.querySelector(
          '[data-id="retrieve-button-floating"]',
        );
        if (floating) {
          floating.classList.remove("visible");
        }
      } catch (e2) {
        // swallow
      }
    }
  }
}
