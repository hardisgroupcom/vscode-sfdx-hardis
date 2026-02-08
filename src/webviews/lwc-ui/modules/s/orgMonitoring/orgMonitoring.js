/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";

export default class OrgMonitoring extends LightningElement {
  @track isInstalled = false;
  @track isLoading = true;
  @track isCiCdRepo = false;
  @track monitoringRepository = null;
  @track instanceUrl = null;

  @api
  initialize(data) {
    console.log("Org Monitoring component initialized:", data);
    this.isInstalled = data?.isInstalled || false;
    this.isCiCdRepo = data?.isCiCdRepo || false;
    this.monitoringRepository = data?.monitoringRepository || null;
    this.instanceUrl = data?.instanceUrl || null;
    this.isLoading = false;
  }

  @api
  handleMessage(type, data) {
    console.log("Org Monitoring component received message:", type, data);
    if (type === "installationStatusUpdated") {
      this.isInstalled = data?.isInstalled || false;
      // may receive updated ci/cd detection and repo config
      if (data?.isCiCdRepo !== undefined) {
        this.isCiCdRepo = !!data.isCiCdRepo;
      }
      if (data?.monitoringRepository !== undefined) {
        this.monitoringRepository = data.monitoringRepository || null;
      }
      if (data?.instanceUrl !== undefined) {
        this.instanceUrl = data.instanceUrl || null;
      }
    }
  }

  openInstanceUrl() {
    if (this.instanceUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.instanceUrl,
      });
    }
  }

  openMonitoringRepository() {
    if (this.monitoringRepository) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.monitoringRepository,
      });
    }
  }

  // Installation and Status Methods
  checkInstallationStatus() {
    window.sendMessageToVSCode({
      type: "checkOrgMonitoringInstallation",
    });
  }

  installOrgMonitoring() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:configure:monitoring",
      },
    });
  }

  reconfigureMonitoringAuth() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:configure:monitoring",
      },
    });
  }

  configureAnotherOrg() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:configure:monitoring",
      },
    });
  }

  viewSkipItemsPackage() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
      data: {
        packageType: "skip",
        filePath: "manifest/package-skip-items.xml",
        title: "Skip Items Package",
      },
    });
  }

  viewBackupItemsPackage() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
      data: {
        packageType: "backup",
        filePath: "manifest/package-backup-items.xml",
        title: "Backup Items Package",
      },
    });
  }

  viewAllOrgItemsPackage() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
      data: {
        packageType: "all-org",
        filePath: "manifest/package-all-org-items.xml",
        title: "All Org Items Package",
      },
    });
  }

  viewPackageConfig() {
    window.sendMessageToVSCode({
      type: "viewPackageConfig",
    });
  }

  learnMore() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/",
    });
  }

  // Monitoring Command Methods
  runMetadataBackup() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:monitor:backup",
      },
    });
  }

  runAuditTrail() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:audittrail",
      },
    });
  }

  runApexTests() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:test:apex",
      },
    });
  }

  checkOrgLimits() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:monitor:limits",
      },
    });
  }

  runHealthCheck() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:monitor:health-check",
      },
    });
  }

  checkReleaseUpdates() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:releaseupdates",
      },
    });
  }

  checkConnectedAppsSecurity() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:unsecure-connected-apps",
      },
    });
  }

  checkLegacyApi() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:legacyapi",
      },
    });
  }

  findUnusedUsers() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:unusedusers",
      },
    });
  }

  checkUnusedLicenses() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:unusedlicenses",
      },
    });
  }

  // Advanced Diagnostics Methods
  findUnusedApexClasses() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:unused-apex-classes",
      },
    });
  }

  findUnusedConnectedApps() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:org:diagnose:unused-connected-apps",
      },
    });
  }

  checkMetadataAccess() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:lint:access",
      },
    });
  }

  runObjectFieldUsage() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:doc:object-field-usage",
      },
    });
  }

  findUnusedMetadata() {
    window.sendMessageToVSCode({
      type: "runCommand",
      data: {
        command: "sf hardis:lint:unusedmetadatas",
      },
    });
  }

  // Documentation Methods
  openMonitoringDocs() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/",
    });
  }

  openSetupGuide() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://sfdx-hardis.cloudity.com/salesforce-monitoring-config-home/",
    });
  }
}
