/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

const STEPS = [
  { id: "prepare", stepNumber: 1 },
  { id: "refresh", stepNumber: 2 },
  { id: "postRefresh", stepNumber: 3 },
];

export default class SandboxRefresh extends SharedMixin(LightningElement) {
  @track currentStepIndex = 0;

  @api
  initialize(_data) {
    // nothing to init from backend
  }

  @api
  handleMessage(_type, _data) {
    // no backend messages expected
  }

  // ---------------------- Getters ----------------------

  get currentStep() {
    return STEPS[this.currentStepIndex];
  }

  get isStep1() {
    return this.currentStepIndex === 0;
  }

  get isStep2() {
    return this.currentStepIndex === 1;
  }

  get isStep3() {
    return this.currentStepIndex === 2;
  }

  get isLastStep() {
    return this.currentStepIndex === STEPS.length - 1;
  }

  get isFirstStep() {
    return this.currentStepIndex === 0;
  }

  get progressSteps() {
    return STEPS.map((s, idx) => ({
      ...s,
      label: this.t(`sandboxRefreshStep${s.stepNumber}Title`),
      isCompleted: idx < this.currentStepIndex,
      isActive: idx === this.currentStepIndex,
      isFuture: idx > this.currentStepIndex,
      statusClass: idx < this.currentStepIndex
        ? "step-indicator completed"
        : idx === this.currentStepIndex
        ? "step-indicator active"
        : "step-indicator future",
      numberOrCheck: idx < this.currentStepIndex ? "✓" : String(s.stepNumber),
    }));
  }

  // ---------------------- Navigation ----------------------

  handleNext() {
    if (this.currentStepIndex < STEPS.length - 1) {
      this.currentStepIndex++;
    }
  }

  handleBack() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
    }
  }

  handleRestart() {
    this.currentStepIndex = 0;
  }

  // ---------------------- Step 1 actions ----------------------

  handleRunPreRefresh() {
    window.sendMessageToVSCode({ type: "runPreRefresh" });
  }

  handleFreezeUsers() {
    window.sendMessageToVSCode({ type: "freezeUsers" });
  }

  // ---------------------- Step 2 actions ----------------------

  handleOpenSetup() {
    window.sendMessageToVSCode({ type: "runVsCodeCommand", data: { command: "vscode-sfdx-hardis.openSetup" } });
  }

  handleOpenSalesforceOrgSandboxSetup() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://help.salesforce.com/s/articleView?id=sf.data_sandbox_manage.htm",
    });
  }

  // ---------------------- Step 3 actions ----------------------

  handleRunPostRefresh() {
    window.sendMessageToVSCode({ type: "runPostRefresh" });
  }

  handleUnfreezeUsers() {
    window.sendMessageToVSCode({ type: "unfreezeUsers" });
  }

  handleActivateEmails() {
    window.sendMessageToVSCode({ type: "activateEmails" });
  }
}
