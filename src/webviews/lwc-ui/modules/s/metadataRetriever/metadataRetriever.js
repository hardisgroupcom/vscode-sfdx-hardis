import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

/**
 * LWC to retrieve and search metadata from a Salesforce org
 * Supports two modes: Recent Changes (SourceMember) and All Metadata (Metadata API)
 */
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
      fieldName: "MemberType",
      type: "text",
      sortable: true,
      wrapText: true,
      initialWidth: 160,
    });

    // Metadata Name
    cols.push({
      label: "Metadata Name",
      fieldName: "MemberName",
      type: "text",
      sortable: true,
      wrapText: true,
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
    }
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
    this.applyFilters();
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
        metadata: this.selectedRows.map((row) => ({
          memberType: row.MemberType,
          memberName: row.MemberName,
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
      (event.detail.action && event.detail.action.name) || event.detail.name || null;

    if (actionName === "download") {
      // support legacy 'retrieve' and new 'download' name
      this.handleRetrieve(row);
    }
  }

  handleRetrieve(row) {
    window.sendMessageToVSCode({
      type: "retrieveMetadata",
      data: {
        username: this.selectedOrg,
        memberType: row.MemberType,
        memberName: row.MemberName,
      },
    });
  }

  @api
  handleMessage(type, data) {
    if (type === "initialize") {
      this.initialize(data);
    } else if (type === "listOrgsResults") {
      this.handleOrgResults(data);
    } else if (type === "listPackagesResults") {
      this.handleListPackagesResults(data);
    } else if (type === "queryResults") {
      this.handleQueryResults(data);
    } else if (type === "queryError") {
      this.handleQueryError(data);
    } else if (type === "postRetrieveLocalCheck") {
      this.handlePostRetrieveLocalCheck(data);
    }
  }

  handlePostRetrieveLocalCheck(data) {
    if (!data || !Array.isArray(data.files) || data.files.length === 0) {
      return;
    }

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
      for (const f of data.files) {
        const k = `${f.MemberType}::${f.MemberName}`;
        keysToRemove.add(k);
      }

      if (this.selectedRowKeys && this.selectedRowKeys.length > 0) {
        const beforeCount = this.selectedRowKeys.length;
        this.selectedRowKeys = this.selectedRowKeys.filter((k) => !keysToRemove.has(k));
        // Recompute selectedRows based on remaining selectedRowKeys
        this.selectedRows = this.metadata.filter((row) => this.selectedRowKeys.includes(row.uniqueKey));
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
}
