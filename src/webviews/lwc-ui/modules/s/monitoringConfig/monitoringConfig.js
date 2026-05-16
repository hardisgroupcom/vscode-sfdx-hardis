/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

const DEFAULT_FREQUENCY = "weekly";

const CATEGORY_ICONS = {
  orgActivity: { icon: "utility:refresh", colorClass: "tests" },
  userActivity: { icon: "utility:user", colorClass: "users" },
  apexTestsSecurity: { icon: "utility:shield", colorClass: "security" },
  orgInfo: { icon: "utility:info", colorClass: "health" },
  technicalDebt: { icon: "utility:warning", colorClass: "limits" },
  licensesPackages: { icon: "utility:package", colorClass: "licenses" },
  other: { icon: "utility:apps", colorClass: "legacy" },
  custom: { icon: "utility:add", colorClass: "backup" },
};

const COMMAND_ICONS = {
  AUDIT_TRAIL: { icon: "utility:trail", colorClass: "audit" },
  LEGACY_API: { icon: "utility:deprecate", colorClass: "legacy" },
  APEX_FLOW_ERRORS: { icon: "utility:error", colorClass: "alerts" },
  APEX_FLEX_QUEUE: { icon: "utility:list", colorClass: "tests" },
  DEPLOYMENTS: { icon: "utility:upload", colorClass: "audit" },
  ORG_LIMITS: { icon: "utility:graph", colorClass: "limits" },
  UNSECURED_CONNECTED_APPS: { icon: "utility:shield", colorClass: "security" },
  ORG_HEALTH_CHECK: { icon: "utility:check", colorClass: "health" },
  ORG_INFO: { icon: "utility:info", colorClass: "health" },
  RELEASE_UPDATES: { icon: "utility:new", colorClass: "updates" },
  LINT_ACCESS: { icon: "utility:lock", colorClass: "metadata-access" },
  UNUSED_METADATAS: { icon: "utility:custom_apps", colorClass: "unused-metadata" },
  UNUSED_APEX_CLASSES: { icon: "utility:apex", colorClass: "apex" },
  APEX_API_VERSION: { icon: "utility:apex", colorClass: "legacy" },
  CONNECTED_APPS: { icon: "utility:connected_apps", colorClass: "connected-apps" },
  METADATA_STATUS: { icon: "utility:flow", colorClass: "legacy" },
  MISSING_ATTRIBUTES: { icon: "utility:description", colorClass: "metadata-access" },
  UNDERUSED_PERMSETS: { icon: "utility:lock", colorClass: "licenses" },
  MINIMAL_PERMSETS: { icon: "utility:shield", colorClass: "metadata-access" },
  LICENSES: { icon: "utility:package", colorClass: "licenses" },
  UNUSED_LICENSES: { icon: "utility:key", colorClass: "licenses" },
  UNUSED_USERS: { icon: "utility:user", colorClass: "users" },
  UNUSED_USERS_CRM_6_MONTHS: { icon: "utility:user", colorClass: "users" },
  UNUSED_USERS_EXPERIENCE_6_MONTHS: { icon: "utility:user", colorClass: "users" },
  ACTIVE_USERS_CRM_WEEKLY: { icon: "utility:user", colorClass: "tests" },
  ACTIVE_USERS_EXPERIENCE_MONTHLY: { icon: "utility:user", colorClass: "tests" },
  BACKUP: { icon: "utility:save", colorClass: "backup" },
  DEPLOYMENT: { icon: "utility:upload", colorClass: "audit" },
  APEX_TESTS: { icon: "utility:apex", colorClass: "tests" },
  APEX_ERROR: { icon: "utility:error", colorClass: "alerts" },
  FLOW_ERROR: { icon: "utility:flow", colorClass: "alerts" },
  ACTIVE_USERS: { icon: "utility:user", colorClass: "users" },
  MONITORING_SUMMARY: { icon: "utility:report", colorClass: "backup" },
  RELEASE_NOTES: { icon: "utility:description", colorClass: "updates" },
  DORA_REPORT: { icon: "utility:chart", colorClass: "health" },
  AGENTFORCE_CONVERSATIONS: { icon: "utility:chat", colorClass: "tests" },
  AGENTFORCE_FEEDBACK: { icon: "utility:like", colorClass: "tests" },
  SERVICENOW_REPORT: { icon: "utility:table", colorClass: "backup" },
};

const DEFAULT_ICON = { icon: "utility:settings", colorClass: "legacy" };

const OPTION_EMOJIS = {
  daily: "☀️",
  weekly: "📋",
  biweekly: "🔄",
  monthly: "🗓️",
  off: "⛔",
  log: "📝",
  success: "✅",
  info: "ℹ️",
  warning: "⚠️",
  error: "❌",
  critical: "🚨",
};

export default class MonitoringConfig extends SharedMixin(LightningElement) {
  @track catalog = { entries: [], options: { frequencies: [], frequencyDays: [], thresholds: [], channels: [] } };
  @track userCommands = [];
  @track branches = [];
  @track currentBranch = "";
  @track docUrl = "";
  @track modalOpen = false;
  @track modalEntry = null;
  @track modalEmailRecipientsText = "";
  @track modalReplaceRecipients = false;
  @track customRowDraft = null;
  @track customFormOpen = false;
  @track modalMessaging = "";
  @track modalEmail = "";
  @track modalApi = "";

  @api
  initialize(data) {
    if (data?.catalog) {
      this.catalog = data.catalog;
    }
    if (Array.isArray(data?.monitoringCommands)) {
      this.userCommands = JSON.parse(JSON.stringify(data.monitoringCommands));
    }
    if (Array.isArray(data?.branches)) {
      this.branches = data.branches;
    }
    if (typeof data?.currentBranch === "string") {
      this.currentBranch = data.currentBranch;
    }
    if (typeof data?.docUrl === "string") {
      this.docUrl = data.docUrl;
    }
  }

  @api
  handleMessage(type, data) {
    if (type === "branchConfigLoaded") {
      const incoming = Array.isArray(data?.monitoringCommands)
        ? data.monitoringCommands
        : [];
      if (incoming.length === 0) {
        return;
      }
      this.userCommands = JSON.parse(JSON.stringify(incoming));
      this._autoSave();
    }
    else if (type === "branchChanged") {
      if (typeof data?.currentBranch === "string") {
        this.currentBranch = data.currentBranch;
      }
      if (Array.isArray(data?.monitoringCommands)) {
        this.userCommands = JSON.parse(JSON.stringify(data.monitoringCommands));
      }
      this.modalOpen = false;
      this.modalEntry = null;
    }
  }

  // ----- Catalog merge: build the rendered row list -----

  get builtInCommandKeys() {
    return (this.catalog?.entries || []).map((e) => e.key);
  }

  get builtInKeySet() {
    return new Set(this.builtInCommandKeys);
  }

  get userByKey() {
    const map = {};
    for (const entry of this.userCommands || []) {
      if (entry && entry.key) {
        map[entry.key] = entry;
      }
    }
    return map;
  }

  get customCommands() {
    const builtIns = this.builtInKeySet;
    return (this.userCommands || []).filter(
      (c) => c && c.key && !builtIns.has(c.key),
    );
  }

  buildRow(entry, userEntry, frequencies, thresholds, isCustom) {
    const effective = this.resolveEffectiveEntry(entry, userEntry);
    const key = isCustom ? userEntry.key : entry.key;
    const iconData = COMMAND_ICONS[key] || DEFAULT_ICON;
    const hasOverrides = isCustom ? true : this.hasOverrides(userEntry);
    const rawTitle = isCustom ? (userEntry.title || userEntry.key) : entry.title;
    const title = (rawTitle || "").replace(/\*\*/g, "");
    return {
      key,
      isCustom,
      title,
      titleSegments: this.parseTitleSegments(rawTitle),
      command: isCustom ? (userEntry.command || "") : (entry.command || ""),
      iconName: iconData.icon,
      iconContainerClass: "command-icon-container " + iconData.colorClass,
      frequency: effective.frequency,
      messaging: effective.notifications.messaging,
      email: effective.notifications.email,
      api: effective.notifications.api,
      frequencyOptions: this.makeOptions(frequencies, effective.frequency),
      messagingOptions: this.makeOptions(thresholds, effective.notifications.messaging),
      emailOptions: this.makeOptions(thresholds, effective.notifications.email),
      apiOptions: this.makeOptions(thresholds, effective.notifications.api),
      hasOverrides,
      showReset: !isCustom && hasOverrides,
    };
  }

  parseTitleSegments(title) {
    if (!title) {
      return [];
    }
    const segments = [];
    const regex = /\*\*([^*]+)\*\*/g;
    let lastIndex = 0;
    let idx = 0;
    let match;
    while ((match = regex.exec(title)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          idx: idx++,
          text: title.slice(lastIndex, match.index),
          cssClass: "monitoring-row-title-segment",
        });
      }
      segments.push({
        idx: idx++,
        text: match[1],
        cssClass: "monitoring-row-title-segment monitoring-row-title-bold",
      });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < title.length) {
      segments.push({
        idx: idx++,
        text: title.slice(lastIndex),
        cssClass: "monitoring-row-title-segment",
      });
    }
    return segments;
  }

  getOptionLabel(value) {
    if (!value) {
      return "";
    }
    const text = this.t(`monitoringEnum_${value}`) || value;
    const emoji = OPTION_EMOJIS[value];
    return emoji ? `${emoji} ${text}` : text;
  }

  get rowsByCategory() {
    const opts = this.catalog?.options || {};
    const frequencies = opts.frequencies || [];
    const thresholds = opts.thresholds || [];
    const userMap = this.userByKey;
    const rowMap = {};

    for (const entry of this.catalog?.entries || []) {
      if (entry.kind && entry.kind !== "monitoringCommand") {
        continue;
      }
      const userEntry = userMap[entry.key] || {};
      const catKey = entry.category || "other";
      if (!rowMap[catKey]) {
        rowMap[catKey] = [];
      }
      rowMap[catKey].push(this.buildRow(entry, userEntry, frequencies, thresholds, false));
    }

    let catalogCategories = (this.catalog?.categories || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // Fallback: if catalog has no categories, derive them from the entry category keys
    if (catalogCategories.length === 0) {
      catalogCategories = Object.keys(rowMap).map((k) => ({ key: k, title: k, description: "", order: 0 }));
    }

    const result = [];
    for (const cat of catalogCategories) {
      const catRows = rowMap[cat.key] || [];
      if (catRows.length === 0) {
        continue;
      }
      const catIconData = CATEGORY_ICONS[cat.key] || { icon: "utility:apps", colorClass: "legacy" };
      result.push({
        key: cat.key,
        title: cat.title,
        description: cat.description || "",
        icon: catIconData.icon,
        iconContainerClass: "command-icon-container command-icon-container--lg " + catIconData.colorClass,
        rows: catRows,
      });
    }

    const customRows = [];
    for (const userEntry of this.customCommands) {
      customRows.push(this.buildRow(null, userEntry, frequencies, thresholds, true));
    }
    if (customRows.length > 0) {
      const customIconData = CATEGORY_ICONS.custom;
      result.push({
        key: "custom",
        title: this.i18n.monitoringCustomCategory,
        description: "",
        icon: customIconData.icon,
        iconContainerClass: "command-icon-container command-icon-container--lg " + customIconData.colorClass,
        rows: customRows,
      });
    }

    const total = result.length;
    return result.map((category, index) => ({
      ...category,
      sectionStyle: `z-index: ${total - index};`,
    }));
  }

  resolveEffectiveEntry(catalogEntry, userEntry) {
    const catalogNotifs = (catalogEntry && catalogEntry.notifications) || {};
    const userNotifs = (userEntry && userEntry.notifications) || {};
    const emailUser = userNotifs.email;
    const emailValue =
      emailUser && typeof emailUser === "object"
        ? emailUser.threshold
        : emailUser;
    return {
      frequency:
        userEntry?.frequency ||
        catalogEntry?.frequency ||
        DEFAULT_FREQUENCY,
      notifications: {
        messaging: userNotifs.messaging || catalogNotifs.messaging || "info",
        email: emailValue || catalogNotifs.email || "info",
        api: userNotifs.api || catalogNotifs.api || "log",
      },
    };
  }

  makeOptions(values, current) {
    const out = (values || []).map((v) => {
      const text = this.t(`monitoringEnum_${v}`) || v;
      const emoji = OPTION_EMOJIS[v];
      return { label: emoji ? `${emoji} ${text}` : text, value: v };
    });
    if (current && !out.some((o) => o.value === current)) {
      const emoji = OPTION_EMOJIS[current];
      const text = this.t(`monitoringEnum_${current}`) || current;
      out.push({ label: emoji ? `${emoji} ${text}` : text, value: current });
    }
    return out;
  }

  hasOverrides(userEntry) {
    if (!userEntry) {
      return false;
    }
    return (
      userEntry.frequency !== undefined ||
      userEntry.frequencyDay !== undefined ||
      userEntry.frequencyDayOfMonth !== undefined ||
      userEntry.notifications !== undefined
    );
  }

  getDatasetValue(event, name) {
    return (
      event?.currentTarget?.dataset?.[name] ||
      event?.target?.dataset?.[name] ||
      ""
    );
  }

  // ----- Inline row edits & row actions -----

  handleRowDetails(event) {
    const key = event.currentTarget.dataset.key;
    if (key) {
      this._openDetailsForKey(key);
    }
  }

  handleRowReset(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this.userCommands = (this.userCommands || []).filter((c) => !c || c.key !== key);
    this._autoSave();
  }

  handleRowDelete(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this.userCommands = (this.userCommands || []).filter((c) => !c || c.key !== key);
    this._autoSave();
  }

  handleRowFrequencyChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserEntry(key, (entry) => {
      entry.frequency = value;
      if (value !== "weekly" && value !== "biweekly") {
        delete entry.frequencyDay;
      }
      if (value !== "monthly") {
        delete entry.frequencyDayOfMonth;
      }
    });
  }

  handleRowMessagingChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserEntry(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      entry.notifications.messaging = value;
    });
  }

  handleRowEmailChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserEntry(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      const existing = entry.notifications.email;
      if (existing && typeof existing === "object") {
        entry.notifications.email = { ...existing, threshold: value };
      }
      else {
        entry.notifications.email = value;
      }
    });
  }

  handleRowApiChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserEntry(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      entry.notifications.api = value;
    });
  }

  // ----- Branch picker -----

  get branchOptions() {
    return (this.branches || [])
      .filter((b) => b !== this.currentBranch)
      .map((b) => ({ label: b, value: b }));
  }

  get noBranches() {
    return this.branchOptions.length === 0;
  }

  handleCopyBranchSelect(event) {
    const branch = event.detail.value;
    if (!branch) {
      return;
    }
    window.sendMessageToVSCode({
      type: "loadFromBranch",
      data: { branch },
    });
  }


  // ----- Row edits -----

  updateUserEntry(key, mutator) {
    const list = (this.userCommands || []).map((c) => ({ ...c }));
    let entry = list.find((c) => c && c.key === key);
    if (!entry) {
      entry = { key };
      list.push(entry);
    }
    mutator(entry);
    this.userCommands = list;
    this._autoSave();
  }

  normalizeNotifications(notifs) {
    return notifs && typeof notifs === "object" ? { ...notifs } : {};
  }

  // ----- Details modal -----

  _openDetailsForKey(key) {
    const catalogEntry = (this.catalog?.entries || []).find((e) => e.key === key);
    const userEntry = this.userByKey[key] || {};
    const effective = this.resolveEffectiveEntry(catalogEntry, userEntry);
    const recipients = this.getEmailRecipients(userEntry);
    this.modalEntry = {
      key,
      title: catalogEntry?.title || userEntry.title || key,
      command: catalogEntry?.command || userEntry.command || "",
      isCustom: !catalogEntry,
      frequency: effective.frequency,
      frequencyDay: userEntry.frequencyDay || catalogEntry?.frequencyDay || "monday",
      frequencyDayOfMonth: userEntry.frequencyDayOfMonth || catalogEntry?.frequencyDayOfMonth || 1,
    };
    this.modalMessaging = effective.notifications.messaging;
    this.modalEmail = effective.notifications.email;
    this.modalApi = effective.notifications.api;
    this.modalEmailRecipientsText = recipients.join("\n");
    this.modalReplaceRecipients = this.getReplaceRecipients(userEntry);
    this.modalOpen = true;
  }

  getEmailRecipients(userEntry) {
    const email = userEntry?.notifications?.email;
    if (email && typeof email === "object" && Array.isArray(email.recipients)) {
      return email.recipients;
    }
    return [];
  }

  getReplaceRecipients(userEntry) {
    const email = userEntry?.notifications?.email;
    return !!(email && typeof email === "object" && email.replaceRecipients);
  }

  get modalIsWeekly() {
    return (
      this.modalEntry &&
      (this.modalEntry.frequency === "weekly" ||
        this.modalEntry.frequency === "biweekly")
    );
  }

  get modalIsMonthly() {
    return this.modalEntry && this.modalEntry.frequency === "monthly";
  }

  get modalFrequencyOptions() {
    const current = this.modalEntry?.frequency;
    return this.makeOptions(this.catalog?.options?.frequencies, current);
  }

  get modalFrequencyDayOptions() {
    const current = this.modalEntry?.frequencyDay;
    return this.makeOptions(this.catalog?.options?.frequencyDays, current);
  }

  get modalMessagingOptions() {
    return this.makeOptions(this.catalog?.options?.thresholds, this.modalMessaging);
  }

  get modalEmailThresholdOptions() {
    return this.makeOptions(this.catalog?.options?.thresholds, this.modalEmail);
  }

  get modalApiOptions() {
    return this.makeOptions(this.catalog?.options?.thresholds, this.modalApi);
  }

  handleModalFrequencyChange(event) {
    if (!this.modalEntry) {
      return;
    }
    this.modalEntry = { ...this.modalEntry, frequency: event.detail.value };
  }

  handleModalFrequencyDayChange(event) {
    if (!this.modalEntry) {
      return;
    }
    this.modalEntry = { ...this.modalEntry, frequencyDay: event.detail.value };
  }

  handleModalDayOfMonthChange(event) {
    if (!this.modalEntry) {
      return;
    }
    const raw = event.target.value;
    let n = Number(raw);
    if (isNaN(n) || n < 1) {
      n = 1;
    }
    if (n > 31) {
      n = 31;
    }
    this.modalEntry = { ...this.modalEntry, frequencyDayOfMonth: n };
  }

  handleModalMessagingChange(event) {
    this.modalMessaging = event.detail.value;
  }

  handleModalEmailChange(event) {
    this.modalEmail = event.detail.value;
  }

  handleModalApiChange(event) {
    this.modalApi = event.detail.value;
  }

  handleModalRecipientsChange(event) {
    this.modalEmailRecipientsText = event.target.value || "";
  }

  handleModalReplaceChange(event) {
    this.modalReplaceRecipients = !!event.target.checked;
  }

  handleModalSave() {
    if (!this.modalEntry) {
      this.modalOpen = false;
      return;
    }
    const key = this.modalEntry.key;
    const newFrequency = this.modalEntry.frequency;
    const newDay = this.modalEntry.frequencyDay;
    const newDayOfMonth = this.modalEntry.frequencyDayOfMonth;
    const newMessaging = this.modalMessaging;
    const newEmailThreshold = this.modalEmail;
    const newApi = this.modalApi;
    const recipients = (this.modalEmailRecipientsText || "")
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const replace = this.modalReplaceRecipients;

    this.updateUserEntry(key, (entry) => {
      entry.frequency = newFrequency;
      if (newFrequency === "weekly" || newFrequency === "biweekly") {
        entry.frequencyDay = newDay;
        delete entry.frequencyDayOfMonth;
      }
      else if (newFrequency === "monthly") {
        entry.frequencyDayOfMonth = newDayOfMonth;
        delete entry.frequencyDay;
      }
      else {
        delete entry.frequencyDay;
        delete entry.frequencyDayOfMonth;
      }

      entry.notifications = this.normalizeNotifications(entry.notifications);
      if (newMessaging) {
        entry.notifications.messaging = newMessaging;
      }
      if (newApi) {
        entry.notifications.api = newApi;
      }
      if (recipients.length > 0 || replace) {
        const emailObj = {};
        if (newEmailThreshold) {
          emailObj.threshold = newEmailThreshold;
        }
        if (recipients.length > 0) {
          emailObj.recipients = recipients;
        }
        if (replace) {
          emailObj.replaceRecipients = true;
        }
        entry.notifications.email = emailObj;
      }
      else {
        entry.notifications.email = newEmailThreshold || undefined;
      }
    });

    this.modalOpen = false;
    this.modalEntry = null;
  }

  handleModalCancel() {
    this.modalOpen = false;
    this.modalEntry = null;
  }

  // ----- Custom command form -----

  handleOpenCustomForm() {
    this.customRowDraft = {
      key: "",
      title: "",
      command: "",
      frequency: DEFAULT_FREQUENCY,
    };
    this.customFormOpen = true;
  }

  get customFormFrequencyOptions() {
    const current = this.customRowDraft?.frequency;
    return this.makeOptions(this.catalog?.options?.frequencies, current);
  }

  handleCustomFieldChange(event) {
    if (!this.customRowDraft) {
      return;
    }
    const field = this.getDatasetValue(event, "field");
    const value =
      event.detail && event.detail.value !== undefined
        ? event.detail.value
        : event.target.value;
    if (!field) {
      return;
    }
    this.customRowDraft = { ...this.customRowDraft, [field]: value };
  }

  get customFormSaveDisabled() {
    const draft = this.customRowDraft;
    if (!draft) {
      return true;
    }
    const key = (draft.key || "").trim();
    const command = (draft.command || "").trim();
    if (!key || !command) {
      return true;
    }
    if (this.builtInKeySet.has(key)) {
      return true;
    }
    if ((this.userCommands || []).some((c) => c && c.key === key)) {
      return true;
    }
    return false;
  }

  handleCustomFormSave() {
    if (this.customFormSaveDisabled) {
      return;
    }
    const draft = this.customRowDraft;
    const newEntry = {
      key: draft.key.trim(),
      title: (draft.title || "").trim() || draft.key.trim(),
      command: draft.command.trim(),
      frequency: draft.frequency || DEFAULT_FREQUENCY,
    };
    this.userCommands = [...(this.userCommands || []), newEntry];
    this._autoSave();
    this.customRowDraft = null;
    this.customFormOpen = false;
  }

  handleCustomFormCancel() {
    this.customRowDraft = null;
    this.customFormOpen = false;
  }

  // ----- Auto-save -----

  _autoSave() {
    const cleaned = this.cleanCommandsForSave();
    window.sendMessageToVSCode({
      type: "saveMonitoringConfig",
      data: { monitoringCommands: cleaned },
    });
    this.userCommands = JSON.parse(JSON.stringify(cleaned));
  }

  handleOpenDocs() {
    if (this.docUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.docUrl,
      });
    }
  }

  cleanCommandsForSave() {
    const builtIns = this.builtInKeySet;
    const out = [];
    for (const c of this.userCommands || []) {
      if (!c || !c.key) {
        continue;
      }
      const entry = { key: c.key };
      const isCustom = !builtIns.has(c.key);
      if (isCustom) {
        if (c.title) {
          entry.title = c.title;
        }
        if (c.command) {
          entry.command = c.command;
        }
      }
      if (c.frequency) {
        entry.frequency = c.frequency;
      }
      if (c.frequencyDay && (c.frequency === "weekly" || c.frequency === "biweekly")) {
        entry.frequencyDay = c.frequencyDay;
      }
      if (c.frequencyDayOfMonth && c.frequency === "monthly") {
        entry.frequencyDayOfMonth = c.frequencyDayOfMonth;
      }
      if (c.notifications && typeof c.notifications === "object") {
        const notifs = {};
        if (c.notifications.messaging) {
          notifs.messaging = c.notifications.messaging;
        }
        if (c.notifications.api) {
          notifs.api = c.notifications.api;
        }
        const email = c.notifications.email;
        if (email && typeof email === "object") {
          const emailObj = {};
          if (email.threshold) {
            emailObj.threshold = email.threshold;
          }
          if (Array.isArray(email.recipients) && email.recipients.length > 0) {
            emailObj.recipients = email.recipients;
          }
          if (email.replaceRecipients) {
            emailObj.replaceRecipients = true;
          }
          if (Object.keys(emailObj).length > 0) {
            notifs.email = emailObj;
          }
        }
        else if (email) {
          notifs.email = email;
        }
        if (Object.keys(notifs).length > 0) {
          entry.notifications = notifs;
        }
      }
      // Skip entries with no useful info (built-in with zero overrides)
      const hasOverride =
        isCustom ||
        entry.frequency !== undefined ||
        entry.frequencyDay !== undefined ||
        entry.frequencyDayOfMonth !== undefined ||
        entry.notifications !== undefined;
      if (hasOverride) {
        out.push(entry);
      }
    }
    return out;
  }
}
