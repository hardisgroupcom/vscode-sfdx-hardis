import { LightningElement, api, track } from "lwc";

export default class InstalledPackages extends LightningElement {
  @api packages = [];
  @track draftValues = [];
  internalCommands = [];
  packagesBeforeRetrieve = null;

  get columns() {
    return  [
      {
        label: "Name",
        fieldName: "SubscriberPackageName",
        type: "text",
        sortable: false,
      },
      {
        label: "Namespace",
        fieldName: "SubscriberPackageNamespace",
        type: "text",
        sortable: false,
      },
      {
        label: "Version",
        fieldName: "SubscriberPackageVersionNumber",
        editable: this.packagesBeforeRetrieve !== null && this.draftValues.length > 0,
        type: "text",
      },
      {
        label: "Deployments",
        fieldName: "installDuringDeployments",
        type: "boolean",
        editable: true,
        sortable: false,
        cellAttributes: { alignment: "center" },
      },
      {
        label: "Scratch Orgs",
        fieldName: "installOnScratchOrgs",
        type: "boolean",
        editable: true,
        sortable: false,
        cellAttributes: { alignment: "center" },
      },
    ];
}

  @api
  initialize(data) {
    this.packages = data.packages || [];
    // Sort packages by SubscriberPackageName
    this.packages.sort((a, b) => {
      if (a.SubscriberPackageName < b.SubscriberPackageName) return -1;
      if (a.SubscriberPackageName > b.SubscriberPackageName) return 1;
      return 0;
    });
    this.draftValues = [];
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "refreshPackages":
        this.handleRefresh();
        break;
      case "commandResult":
        this.handleCommandResult(data);
        break;
      default:
        console.log("Unknown message type:", messageType, data);
    }
  }

  handleCancel() {
    this.draftValues = [];
    this.packages = this.packagesBeforeRetrieve ? [...this.packagesBeforeRetrieve] : [...this.packages];
    this.packagesBeforeRetrieve = null;
  }

  handleDraftValuesChange(event) {
    const newDrafts = event.detail.draftValues;
    for (const newDraft of newDrafts) {
      const existingDraftIndex = this.draftValues.findIndex(
        (draft) => draft.Id === newDraft.Id,
      );
      if (existingDraftIndex !== -1) {
        // Update existing draft
        this.draftValues[existingDraftIndex] = {
          ...this.draftValues[existingDraftIndex],
          ...newDraft,
        };
      } else {
        // Add new draft
        this.draftValues.push(newDraft);
      }
    }
    // Refresh to ensure reactivity
    this.draftValues = [...this.draftValues];
  }

  handleRefresh() {
    window.sendMessageToVSCode({ type: "refresh" });
  }

  handleSave() {
    // Send updated config to VS Code
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      // Merge draftValues into packages
      const packagesForUpdate = [...this.packages];
      for (const draft of this.draftValues) {
        const pkg = packagesForUpdate.find((p) => p.Id === draft.Id);
        if (pkg) {
          Object.assign(pkg, draft);
        }
      }
      const packagesWithConfig = [];
      for (const pkg of packagesForUpdate) {
        if (pkg.installDuringDeployments === true || pkg.installOnScratchOrgs === true) {
          packagesWithConfig.push(pkg);
        }
      }
      window.sendMessageToVSCode({
        type: "saveSfdxHardisConfig",
        data: {
          packages: JSON.parse(JSON.stringify(packagesWithConfig)),
        },
      });
      this.draftValues = [];
    }
  }

  handleRetrieveFromOrg() {
    const internalCommand = {
      command: `sf package installed list --json`,
      commandId: Math.random(),
      progressMessage: `Retrieving Installed Packages from org...`,
      callback: (data) => {
        // After opening the org, refresh the list to update connected status
        this.updateDraftFromPackagesResult(data);
      },
    };
    window.sendMessageToVSCode({
      type: "runInternalCommand",
      data: JSON.parse(JSON.stringify(internalCommand)),
    });
    this.internalCommands.push(internalCommand);
  }

  updateDraftFromPackagesResult(data) {
    if (data.result && data?.result?.status === 0 && data?.result?.result && data.result.result.length > 0) {
      const retrievedPackages = data.result.result;
      const updatedPackages = [...this.packages];
      let hasChanges = false;
      for (const retrievedPkg of retrievedPackages) {
        const existingPkgIndex = updatedPackages.findIndex(
          (p) => p.SubscriberPackageId === retrievedPkg.SubscriberPackageId,
        );
        if (existingPkgIndex !== -1) {
          const existingPkg = updatedPackages[existingPkgIndex];
          // Update existing package details
          if (
            existingPkg.SubscriberPackageVersionNumber !==  retrievedPkg.SubscriberPackageVersionNumber ||
            existingPkg.SubscriberPackageName !== retrievedPkg.SubscriberPackageName ||
            existingPkg.SubscriberPackageNamespace !== retrievedPkg.SubscriberPackageNamespace    
          ) {
            updatedPackages[existingPkgIndex] = {
              ...existingPkg,
              SubscriberPackageVersionId: retrievedPkg.SubscriberPackageVersionId,
              SubscriberPackageVersionNumber: retrievedPkg.SubscriberPackageVersionNumber,
              SubscriberPackageName: retrievedPkg.SubscriberPackageName,
              SubscriberPackageNamespace: retrievedPkg.SubscriberPackageNamespace,
            };
            hasChanges = true;
            // If the version changed, reflect it in draftValues so the datatable shows the updated value
            try {
              const identifier = existingPkg.Id || existingPkg.SubscriberPackageId || null;
              if (identifier) {
                const draftEntry = {
                  Id: identifier,
                  SubscriberPackageVersionNumber: retrievedPkg.SubscriberPackageVersionNumber,
                };
                const existingDraftIndex = this.draftValues.findIndex((d) => d.Id === identifier);
                if (existingDraftIndex !== -1) {
                  this.draftValues[existingDraftIndex] = {
                    ...this.draftValues[existingDraftIndex],
                    ...draftEntry,
                  };
                } else {
                  this.draftValues.push(draftEntry);
                }
              }
            } catch (e) {
              // ignore draft update errors
            }
          }
        } else {
          // New package, add it
          updatedPackages.push({
            ...retrievedPkg,
            installDuringDeployments: false,
            installOnScratchOrgs: false,
          });
          hasChanges = true;
        }
      }
      if (hasChanges) {
        // Sort packages by SubscriberPackageName
        updatedPackages.sort((a, b) => {
          if (a.SubscriberPackageName < b.SubscriberPackageName) return -1;
          if (a.SubscriberPackageName > b.SubscriberPackageName) return 1;
          return 0;
        });
        this.packagesBeforeRetrieve = [...this.packages]
        // Refresh for reactivity in LWC
        this.packages = [...updatedPackages];
        this.draftValues = [...this.draftValues];
      }
    }
  }

  handleInstallNewPackage() {
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: "runCommand",
        data: {
          command: "sf hardis:package:install",
        },
      });
    }
    console.log("Install new package button clicked");
  }

  handleCommandResult(data) {
    if (data && data.command && data.commandId) {
      // If found in internalCommands: Execute callback of the command, then remove it from internalCommands
      const cmdIndex = this.internalCommands.findIndex(
        (cmd) => cmd.commandId === data.commandId,
      );
      if (cmdIndex !== -1) {
        const cmd = this.internalCommands[cmdIndex];
        if (cmd.callback && typeof cmd.callback === "function") {
          try {
            cmd.callback(data);
          } catch (e) {
            // ignore callback errors
          }
        }
        // Delete the command from the internal list to avoid unbounded growth
        this.internalCommands.splice(cmdIndex, 1);
      }
    }
  }
}
