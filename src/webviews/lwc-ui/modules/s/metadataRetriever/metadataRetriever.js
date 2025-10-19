import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

/**
 * LWC to retrieve and search metadata from a Salesforce org using SourceMember SOQL queries
 */
export default class MetadataRetriever extends LightningElement {
  @api orgs = [];
  @api metadataTypes = [];
  @track selectedOrg = null;
  @track metadataType = "All";
  @track metadataName = "";
  @track lastUpdatedBy = "";
  @track dateFrom = "";
  @track dateTo = "";
  @track searchTerm = "";
  @track isLoading = false;
  @track metadata = [];
  @track filteredMetadata = [];
  @track error = null;
  @track selectedRows = [];
  @track selectedRowKeys = [];

  // Datatable columns
  columns = [
    {
      label: "Metadata Type",
      fieldName: "MemberType",
      type: "text",
      sortable: true,
      wrapText: true,
    },
    {
      label: "Metadata Name",
      fieldName: "MemberName",
      type: "text",
      sortable: true,
      wrapText: true,
      initialWidth: 250,
    },
    {
      label: "Last Updated By",
      fieldName: "LastModifiedByName",
      type: "text",
      sortable: true,
      wrapText: true,
    },
    {
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
    },
    {
      type: "action",
      typeAttributes: {
        rowActions: [
          { label: "Retrieve", name: "retrieve" },
        ],
      },
      initialWidth: 80,
    },
  ];

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

    return sortedOrgs.map((org) => ({
      label: formatLabel(org),
      value: org.username,
    }));
  }

  get metadataTypeOptions() {
    const options = [{ label: "All", value: "All" }];
    if (this.metadataTypes && Array.isArray(this.metadataTypes)) {
      return options.concat(this.metadataTypes);
    }
    return options;
  }

  get hasResults() {
    return this.filteredMetadata && this.filteredMetadata.length > 0;
  }

  get noResults() {
    return !this.isLoading && this.filteredMetadata && this.filteredMetadata.length === 0;
  }

  get hasError() {
    return this.error !== null;
  }

  get canSearch() {
    return this.selectedOrg !== null;
  }

  get cannotSearch() {
    return !this.canSearch;
  }

  get hasSelectedRows() {
    return this.selectedRows && this.selectedRows.length > 0;
  }

  get retrieveSelectedLabel() {
    const count = this.selectedRows ? this.selectedRows.length : 0;
    return count > 0 ? `Retrieve ${count} Selected Metadata` : "Retrieve Selected Metadata";
  }

  @api
  initialize(data) {
    if (data) {
      if (data.orgs && Array.isArray(data.orgs)) {
        this.orgs = data.orgs;
        // Set default org if provided or use first available
        if (data.selectedOrgUsername) {
          this.selectedOrg = data.selectedOrgUsername;
        }
        else if (this.orgs.length > 0) {
          this.selectedOrg = this.orgs[0].username;
        }
      }
      if (data.metadataTypes && Array.isArray(data.metadataTypes)) {
        this.metadataTypes = data.metadataTypes;
      }
    }
  }

  handleOrgChange(event) {
    this.selectedOrg = event.detail.value;
  }

  handleRowSelection(event) {
    this.selectedRows = event.detail.selectedRows;
    // Track selected row keys for persistence during filtering
    this.selectedRowKeys = this.selectedRows.map(row => row.MemberName);
  }

  handleMetadataTypeChange(event) {
    this.metadataType = event.detail.value;
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
    this.applyFilters();
  }

  handleSearch() {
    if (!this.canSearch) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.metadata = [];
    this.filteredMetadata = [];
    this.selectedRows = [];
    this.selectedRowKeys = [];

    // Send filter criteria to VS Code (backend will build the SOQL query)
    window.sendMessageToVSCode({
      type: "queryMetadata",
      data: {
        username: this.selectedOrg,
        metadataType: this.metadataType && this.metadataType !== "All" ? this.metadataType : null,
        metadataName: this.metadataName || null,
        lastUpdatedBy: this.lastUpdatedBy || null,
        dateFrom: this.dateFrom || null,
        dateTo: this.dateTo || null,
      },
    });
  }

  handleRefresh() {
    this.handleSearch();
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
        metadata: this.selectedRows.map(row => ({
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
    this.selectedRows = [];
    this.selectedRowKeys = [];
    this.applyFilters();
  }

  applyFilters() {
    if (!this.metadata || this.metadata.length === 0) {
      this.filteredMetadata = [];
      return;
    }

    let filtered = [...this.metadata];

    // Apply metadata type filter
    if (this.metadataType && this.metadataType !== "All") {
      filtered = filtered.filter((item) => {
        return item.MemberType === this.metadataType;
      });
    }

    // Apply metadata name filter
    if (this.metadataName) {
      const nameLower = this.metadataName.toLowerCase();
      filtered = filtered.filter((item) => {
        return item.MemberName && item.MemberName.toLowerCase().includes(nameLower);
      });
    }

    // Apply last updated by filter
    if (this.lastUpdatedBy) {
      const userLower = this.lastUpdatedBy.toLowerCase();
      filtered = filtered.filter((item) => {
        return item.LastModifiedByName && item.LastModifiedByName.toLowerCase().includes(userLower);
      });
    }

    // Apply search term filter (searches across all fields)
    if (this.searchTerm) {
      const searchLower = this.searchTerm.toLowerCase();
      filtered = filtered.filter((item) => {
        return (
          (item.MemberType && item.MemberType.toLowerCase().includes(searchLower)) ||
          (item.MemberName && item.MemberName.toLowerCase().includes(searchLower)) ||
          (item.LastModifiedByName && item.LastModifiedByName.toLowerCase().includes(searchLower))
        );
      });
    }

    this.filteredMetadata = filtered;
  }

  handleRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;

    if (action.name === "retrieve") {
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
    }
    else if (type === "queryResults") {
      this.handleQueryResults(data);
    }
    else if (type === "queryError") {
      this.handleQueryError(data);
    }
  }

  handleQueryResults(data) {
    this.isLoading = false;
    if (data && data.records && Array.isArray(data.records)) {
      // Transform records to include LastModifiedByName
      this.metadata = data.records.map((record) => ({
        MemberName: record.MemberName,
        MemberType: record.MemberType,
        LastModifiedDate: record.LastModifiedDate,
        LastModifiedByName: record.LastModifiedBy ? record.LastModifiedBy.Name : "",
      }));
      this.applyFilters();
    }
    else {
      this.metadata = [];
      this.filteredMetadata = [];
    }
  }

  handleQueryError(data) {
    this.isLoading = false;
    this.error = data && data.message ? data.message : "An error occurred while querying metadata";
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
