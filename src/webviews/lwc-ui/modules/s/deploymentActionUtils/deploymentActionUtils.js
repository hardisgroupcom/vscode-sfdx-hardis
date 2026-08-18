/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

// Shared rendering helpers for deployment actions (pre/post deploy commands),
// so the DevOps Pipeline panel and the Pipeline Settings editor display the
// same type labels, icons and execution contexts for the same action.

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

export function getActionContextLabel(contextCode, t) {
  const labelKey = CONTEXT_LABEL_KEY_BY_CODE[contextCode];
  return labelKey ? t(labelKey) : contextCode;
}
