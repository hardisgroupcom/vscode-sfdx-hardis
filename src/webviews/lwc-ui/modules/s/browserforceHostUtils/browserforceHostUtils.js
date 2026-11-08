/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

// Shared message handling of the panels hosting the editor of a "browser" deployment action
// (s/deploymentAction): the DevOps Pipeline panel and the Pipeline Settings editor ask the
// extension for the Browserforce catalog and for the check of a setting value the same way.
// The host component holds the state the editor is bound to: browserforceCatalog,
// browserforceCatalogLoading and browserforceValidation (tracked fields of the host).
// No import: the unit tests evaluate this source as is.

/** The editor asks for the catalog (when it opens a "browser" action, or on Retry) */
export function requestBrowserforceCatalog(host) {
  host.browserforceCatalogLoading = true;
  const requestId = newRequestId();
  host._browserforceCatalogRequestId = requestId;
  window.sendMessageToVSCode({
    type: "loadBrowserforceCatalog",
    data: { requestId },
  });
}

/**
 * Sent twice when the CI/CD variable names arrive after the catalog: the last answer wins. An
 * answer to an older request is ignored.
 */
export function receiveBrowserforceCatalog(host, data) {
  if (isAnswerToAnotherRequest(host._browserforceCatalogRequestId, data)) {
    return;
  }
  host.browserforceCatalog = data || null;
  host.browserforceCatalogLoading = false;
}

/** The editor asks for the check of a value, with the request id it waits for */
export function requestBrowserforceValidation(host, event) {
  const detail = event?.detail || {};
  const requestId = detail.requestId || newRequestId();
  host._browserforceValidationRequestId = requestId;
  window.sendMessageToVSCode({
    type: "validateBrowserforceConfig",
    data: {
      requestId,
      setting: detail.setting || "",
      config: detail.config,
    },
  });
}

/** Only the answer to the last check asked is passed to the editor */
export function receiveBrowserforceValidation(host, data) {
  if (isAnswerToAnotherRequest(host._browserforceValidationRequestId, data)) {
    return;
  }
  host.browserforceValidation = data || null;
}

function newRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAnswerToAnotherRequest(expectedRequestId, data) {
  return (
    !!expectedRequestId &&
    !!data?.requestId &&
    data.requestId !== expectedRequestId
  );
}
