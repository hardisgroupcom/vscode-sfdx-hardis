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
  "publish-community": "publishCommunityType",
  "remove-packagexml-items": "removePackageXmlItemsType",
  manual: "manualType",
};

const TYPE_ICON_BY_CODE = {
  command: "utility:apex",
  data: "utility:database",
  apex: "utility:apex_alt",
  "schedule-batch": "utility:event",
  "publish-community": "utility:global",
  "remove-packagexml-items": "utility:filterList",
  manual: "utility:task",
};

// Category hue of each action type, rendered as a colored pill by the
// typePill cell type (classes declared in resources/global-theme.css).
const TYPE_HUE_BY_CODE = {
  command: "blue",
  data: "teal",
  apex: "violet",
  "schedule-batch": "amber",
  "publish-community": "green",
  "remove-packagexml-items": "pink",
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

// t: the SharedMixin translate function of the calling component
export function getActionTypeLabel(typeCode, t) {
  const labelKey = TYPE_LABEL_KEY_BY_CODE[typeCode];
  return labelKey ? t(labelKey) : t("unknownLabel");
}

export function getActionTypeIconName(typeCode) {
  return TYPE_ICON_BY_CODE[typeCode] || "utility:question";
}

// CSS classes of the colored pill displaying an action type
export function getActionTypePillClass(typeCode) {
  return getPillClass(TYPE_HUE_BY_CODE[typeCode]);
}

// CSS classes of the colored pill displaying when an action runs
export function getActionWhenPillClass(whenCode) {
  return getPillClass(WHEN_HUE_BY_CODE[whenCode]);
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
