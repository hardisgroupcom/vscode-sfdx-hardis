/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

// Shared rendering helpers for deployment actions (pre/post deploy commands),
// so the DevOps Pipeline panel and the Pipeline Settings editor display the
// same type labels, icons and execution contexts for the same action.

import { getPillClass } from "s/pillUtils";

const TYPE_LABEL_KEY_BY_CODE = {
  command: "commandType",
  data: "dataType",
  apex: "apexType",
  "schedule-batch": "scheduleBatchType",
  "run-batch": "runBatchType",
  "publish-community": "publishCommunityType",
  "remove-packagexml-items": "removePackageXmlItemsType",
  "user-access-policy": "userAccessPolicyType",
  manual: "manualType",
};

const TYPE_ICON_BY_CODE = {
  command: "utility:apex",
  data: "utility:database",
  apex: "utility:apex_alt",
  "schedule-batch": "utility:event",
  "run-batch": "utility:play",
  "publish-community": "utility:world",
  "remove-packagexml-items": "utility:filterList",
  "user-access-policy": "utility:user_role",
  manual: "utility:task",
};

// Category hue of each action type, rendered as a colored pill by the
// typePill cell type (classes declared in resources/global-theme.css).
const TYPE_HUE_BY_CODE = {
  command: "blue",
  data: "teal",
  apex: "violet",
  "schedule-batch": "amber",
  "run-batch": "purple",
  "publish-community": "green",
  "remove-packagexml-items": "pink",
  "user-access-policy": "red",
  manual: "slate",
};

// Hue of the execution moment pill. Distinct from every type hue so both
// pills of a row stay tellable apart.
const WHEN_HUE_BY_CODE = {
  "pre-deploy": "cyan",
  "post-deploy": "indigo",
};

// Hue of the execution context pill. Distinct from every action type hue so
// the two pill columns of the Pipeline Settings table stay tellable apart.
const CONTEXT_HUE_BY_CODE = {
  all: "cyan",
  "check-deployment-only": "amber",
  "process-deployment-only": "indigo",
};

const CONTEXT_LABEL_KEY_BY_CODE = {
  all: "checkAndProcessDeployment",
  "check-deployment-only": "checkDeploymentOnly",
  "process-deployment-only": "processDeploymentOnly",
};

// Org initialization step types (orgInitSteps) that are not deployment action types
const ORG_INIT_TYPE_LABEL_KEY_BY_CODE = {
  "install-packages": "installPackagesType",
  "deploy-sources": "deploySourcesType",
  "assign-permission-sets": "assignPermissionSetsType",
};

const ORG_INIT_TYPE_HUE_BY_CODE = {
  "install-packages": "cyan",
  "deploy-sources": "indigo",
  "assign-permission-sets": "pink",
};

/** Label of an org initialization step type: its own types, then the deployment action ones. */
export function getOrgInitStepTypeLabel(typeCode, t, customFunctions = []) {
  const labelKey = ORG_INIT_TYPE_LABEL_KEY_BY_CODE[typeCode];
  if (labelKey) {
    return t(labelKey);
  }
  const customFunction = (customFunctions || []).find(
    (fn) => fn.id === typeCode,
  );
  if (customFunction) {
    return t("customFunctionTypeLabel", {
      label: customFunction.label || customFunction.id,
    });
  }
  return getActionTypeLabel(typeCode, t, customFunctions);
}

export function getOrgInitStepTypePillClass(typeCode) {
  const hue = ORG_INIT_TYPE_HUE_BY_CODE[typeCode];
  return hue ? getPillClass(hue) : getActionTypePillClass(typeCode);
}

/**
 * Types offered for an org initialization step. The built-in ones come from the CLI
 * (sf hardis:config:org-init --json, stepTypes), the custom functions without a deployment phase
 * are added after them.
 */
export function getOrgInitStepTypeOptions(stepTypes, t, customFunctions = []) {
  const options = (stepTypes || []).map((stepType) => ({
    label: getOrgInitStepTypeLabel(stepType.type, t, customFunctions),
    value: stepType.type,
  }));
  // A function bound to a deployment phase expects a deployment around it
  for (const customFunction of customFunctions || []) {
    if (!customFunction.when) {
      options.push({
        label: getOrgInitStepTypeLabel(customFunction.id, t, customFunctions),
        value: customFunction.id,
      });
    }
  }
  return options;
}

// t: the SharedMixin translate function of the calling component.
// customFunctions: the project custom function catalog, so a type that is a function id is
// labelled with the function label instead of falling back to "unknown".
export function getActionTypeLabel(typeCode, t, customFunctions = []) {
  const labelKey = TYPE_LABEL_KEY_BY_CODE[typeCode];
  if (labelKey) {
    return t(labelKey);
  }
  const customFunction = (customFunctions || []).find(
    (fn) => fn.id === typeCode,
  );
  if (customFunction) {
    return customFunction.label || customFunction.id;
  }
  // A function that was deleted while actions still reference it: show the id, which is what
  // the user needs to fix the action, rather than an opaque "unknown"
  return typeCode ? typeCode : t("unknownLabel");
}

export function getActionTypeIconName(typeCode) {
  if (TYPE_ICON_BY_CODE[typeCode]) {
    return TYPE_ICON_BY_CODE[typeCode];
  }
  // Custom functions all share one icon: they are scripts of the project
  return isBuiltInActionType(typeCode) ? "utility:question" : "utility:macros";
}

// CSS classes of the colored pill displaying an action type
export function getActionTypePillClass(typeCode) {
  const hue = TYPE_HUE_BY_CODE[typeCode] || "purple";
  return getPillClass(hue);
}

export function isBuiltInActionType(typeCode) {
  return Object.prototype.hasOwnProperty.call(TYPE_LABEL_KEY_BY_CODE, typeCode);
}

// CSS classes of the colored pill displaying when an action runs
export function getActionWhenPillClass(whenCode) {
  return getPillClass(WHEN_HUE_BY_CODE[whenCode]);
}

// Context an action really runs in, as the sfdx-hardis CLI decides it (getEffectiveActionContext
// in actionUtils.ts): a manual step to do before the deployment has to be done before the merge,
// so the validation job lists it whatever context its file holds.
export function getEffectiveActionContext(action, when) {
  // A batch run and a User Access Policy activation are deployment-only actions, whatever their
  // context holds, as in the CLI
  if (action?.type === "run-batch" || action?.type === "user-access-policy") {
    return "process-deployment-only";
  }
  if (action?.type === "manual" && (when || action?.when) === "pre-deploy") {
    return "all";
  }
  return action?.context || "all";
}

export function getActionContextLabel(contextCode, t) {
  const labelKey = CONTEXT_LABEL_KEY_BY_CODE[contextCode];
  return labelKey ? t(labelKey) : contextCode;
}

// CSS classes of the colored pill displaying when an action is executed
// (validation job, deployment job, or both)
export function getActionContextPillClass(contextCode) {
  return getPillClass(CONTEXT_HUE_BY_CODE[contextCode]);
}
