/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

const DEFAULT_FREQUENCY = "weekly";

// Category icon + colorClass for the seven real categories now come from the CLI catalog
// (`categories[].icon` and `categories[].colorClass`). Per-command and per-notification
// icons/colorClass also come from the catalog -- see buildCommandRow / buildNotificationRow.
//
// This map only carries the two pseudo-categories that exist purely in this UI ("custom"
// and "standalone") and the global fallback values for unknown keys.
const CATEGORY_ICONS = {
  custom: { icon: "utility:add", colorClass: "backup" },
  standalone: { icon: "utility:notification", colorClass: "alerts" },
};

const DEFAULT_CATEGORY_COLOR_CLASS = "legacy";
const FALLBACK_ICON_NAME = "utility:settings";

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
  @track catalog = {
    monitoringCommands: [],
    notificationConfig: [],
    categories: [],
    options: { frequencies: [], frequencyDays: [], thresholds: [], channels: [] },
  };
  @track userCommands = [];
  @track userNotifications = [];
  @track branches = [];
  @track currentBranch = "";
  @track docUrl = "";
  @track modalOpen = false;
  @track modalKind = "command"; // "command" | "notification"
  @track modalEntry = null;
  @track modalEmailRecipientsText = "";
  @track modalReplaceRecipients = false;
  @track customRowDraft = null;
  @track customFormOpen = false;
  @track modalMessaging = "";
  @track modalEmail = "";
  @track modalApi = "";
  @track modalAvailableThresholds = [];

  @api
  initialize(data) {
    if (data?.catalog) {
      this.catalog = this.normalizeCatalog(data.catalog);
    }
    if (Array.isArray(data?.monitoringCommands)) {
      this.userCommands = JSON.parse(JSON.stringify(data.monitoringCommands));
    }
    if (Array.isArray(data?.notificationConfig)) {
      this.userNotifications = JSON.parse(JSON.stringify(data.notificationConfig));
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
      const cmds = Array.isArray(data?.monitoringCommands) ? data.monitoringCommands : [];
      const notifs = Array.isArray(data?.notificationConfig) ? data.notificationConfig : [];
      if (cmds.length === 0 && notifs.length === 0) {
        return;
      }
      this.userCommands = JSON.parse(JSON.stringify(cmds));
      this.userNotifications = JSON.parse(JSON.stringify(notifs));
      this._autoSave();
    }
    else if (type === "branchChanged") {
      if (typeof data?.currentBranch === "string") {
        this.currentBranch = data.currentBranch;
      }
      if (Array.isArray(data?.monitoringCommands)) {
        this.userCommands = JSON.parse(JSON.stringify(data.monitoringCommands));
      }
      if (Array.isArray(data?.notificationConfig)) {
        this.userNotifications = JSON.parse(JSON.stringify(data.notificationConfig));
      }
      this.modalOpen = false;
      this.modalEntry = null;
    }
  }

  normalizeCatalog(raw) {
    return {
      monitoringCommands: Array.isArray(raw.monitoringCommands) ? raw.monitoringCommands : [],
      notificationConfig: Array.isArray(raw.notificationConfig) ? raw.notificationConfig : [],
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      options: raw.options || { frequencies: [], frequencyDays: [], thresholds: [], channels: [] },
    };
  }

  // ----- Lookups -----

  get builtInCommandKeySet() {
    return new Set((this.catalog.monitoringCommands || []).map((e) => e.key));
  }

  get notificationDefaultsByKey() {
    const map = {};
    for (const entry of this.catalog.notificationConfig || []) {
      if (entry && entry.key) {
        map[entry.key] = entry;
      }
    }
    // Custom commands emit notifications under their own key by default —
    // synthesize a catalog entry so the Workbench can render threshold editors.
    for (const userCmd of this.customCommands) {
      if (!userCmd || !userCmd.key || map[userCmd.key]) {
        continue;
      }
      map[userCmd.key] = {
        key: userCmd.key,
        title: userCmd.title || userCmd.key,
        category: "custom",
        notifications: { messaging: "info", email: "info", api: "log" },
        isSynthetic: true,
      };
    }
    return map;
  }

  get userCommandsByKey() {
    const map = {};
    for (const entry of this.userCommands || []) {
      if (entry && entry.key) {
        map[entry.key] = entry;
      }
    }
    return map;
  }

  get userNotificationsByKey() {
    const map = {};
    for (const entry of this.userNotifications || []) {
      if (entry && entry.key) {
        map[entry.key] = entry;
      }
    }
    return map;
  }

  get customCommands() {
    const builtIns = this.builtInCommandKeySet;
    return (this.userCommands || []).filter(
      (c) => c && c.key && !builtIns.has(c.key),
    );
  }

  // ----- Row builders -----

  // Resolve a CSS colorClass for a category key. Real categories come from the CLI catalog
  // (`categories[].colorClass`); pseudo-categories ("custom", "standalone") are UI-only and
  // fall back to the local CATEGORY_ICONS map.
  colorClassForCategory(categoryKey) {
    const fromCatalog = (this.catalog?.categories || []).find((c) => c && c.key === categoryKey);
    if (fromCatalog && fromCatalog.colorClass) {
      return fromCatalog.colorClass;
    }
    return CATEGORY_ICONS[categoryKey]?.colorClass || DEFAULT_CATEGORY_COLOR_CLASS;
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

  buildCommandRow(catalogEntry, userEntry, isCustom) {
    const key = isCustom ? userEntry.key : catalogEntry.key;
    const iconName =
      (catalogEntry && catalogEntry.icon) ||
      (userEntry && userEntry.icon) ||
      FALLBACK_ICON_NAME;
    const categoryKey = isCustom
      ? "custom"
      : (catalogEntry && catalogEntry.category) || "other";
    // Prefer the catalog-supplied per-command colorClass; fall back to category lookup
    // for custom commands (no catalog entry) and unknown categories.
    const colorClass =
      (catalogEntry && catalogEntry.colorClass) ||
      this.colorClassForCategory(categoryKey);
    const rawTitle = isCustom ? (userEntry.title || userEntry.key) : catalogEntry.title;
    const title = (rawTitle || "").replace(/\*\*/g, "");
    const frequencyOptions = this.catalog?.options?.frequencies || [];
    const effectiveFrequency =
      (userEntry && userEntry.frequency) ||
      (catalogEntry && catalogEntry.frequency) ||
      DEFAULT_FREQUENCY;
    const hasOverrides = isCustom ? true : this.commandHasOverrides(userEntry);
    return {
      rowKind: "command",
      key,
      compositeKey: `cmd:${key}`,
      isCustom,
      title,
      titleSegments: this.parseTitleSegments(rawTitle),
      command: isCustom ? (userEntry.command || "") : (catalogEntry.command || ""),
      iconName,
      iconContainerClass: "command-icon-container " + colorClass,
      frequency: effectiveFrequency,
      frequencyOptions: this.makeOptions(frequencyOptions, effectiveFrequency),
      hasOverrides,
      showReset: !isCustom && hasOverrides,
      children: [],
    };
  }

  buildNotificationRow(catalogEntry, userEntry, ownerKey) {
    const key = catalogEntry.key;
    const iconName = catalogEntry.icon || FALLBACK_ICON_NAME;
    // Prefer the catalog-supplied per-notification colorClass; fall back to the category one.
    const colorClass =
      catalogEntry.colorClass || this.colorClassForCategory(catalogEntry.category);
    const rawTitle = catalogEntry.title || key;
    const title = (rawTitle || "").replace(/\*\*/g, "");
    const thresholds = this.getAvailableThresholds(catalogEntry);
    const effective = this.resolveNotificationThresholds(catalogEntry, userEntry);
    const hasOverrides = this.notificationHasOverrides(userEntry);
    const hasThresholdWarning = this.detectThresholdWarning(userEntry, thresholds);
    return {
      rowKind: "notification",
      key,
      compositeKey: ownerKey ? `notif:${ownerKey}:${key}` : `notif::${key}`,
      ownerKey: ownerKey || "",
      isCustom: false,
      title,
      titleSegments: this.parseTitleSegments(rawTitle),
      iconName,
      iconContainerClass: "command-icon-container " + colorClass,
      messaging: effective.messaging,
      email: effective.email,
      api: effective.api,
      messagingOptions: this.makeOptions(thresholds, effective.messaging),
      emailOptions: this.makeOptions(thresholds, effective.email),
      apiOptions: this.makeOptions(thresholds, effective.api),
      availableThresholds: thresholds,
      hasOverrides,
      showReset: hasOverrides,
      hasThresholdWarning,
    };
  }

  getAvailableThresholds(catalogEntry) {
    const list =
      catalogEntry && Array.isArray(catalogEntry.availableThresholds)
        ? catalogEntry.availableThresholds
        : null;
    if (list && list.length > 0) {
      return list;
    }
    return this.catalog?.options?.thresholds || [];
  }

  detectThresholdWarning(userEntry, available) {
    if (!userEntry || !userEntry.notifications || !Array.isArray(available) || available.length === 0) {
      return false;
    }
    const allowed = new Set(available);
    const notifs = userEntry.notifications;
    if (notifs.messaging && !allowed.has(notifs.messaging)) {
      return true;
    }
    if (notifs.api && !allowed.has(notifs.api)) {
      return true;
    }
    const email = notifs.email;
    const emailValue =
      email && typeof email === "object" ? email.threshold : email;
    if (emailValue && !allowed.has(emailValue)) {
      return true;
    }
    return false;
  }

  resolveNotificationThresholds(catalogEntry, userEntry) {
    const catNotifs = (catalogEntry && catalogEntry.notifications) || {};
    const userNotifs = (userEntry && userEntry.notifications) || {};
    const emailUser = userNotifs.email;
    const emailValue =
      emailUser && typeof emailUser === "object" ? emailUser.threshold : emailUser;
    return {
      messaging: userNotifs.messaging || catNotifs.messaging || "info",
      email: emailValue || catNotifs.email || "info",
      api: userNotifs.api || catNotifs.api || "log",
    };
  }

  commandHasOverrides(userEntry) {
    if (!userEntry) {
      return false;
    }
    return (
      userEntry.frequency !== undefined ||
      userEntry.frequencyDay !== undefined ||
      userEntry.frequencyDayOfMonth !== undefined ||
      (Array.isArray(userEntry.notificationTypes) && userEntry.notificationTypes.length > 0)
    );
  }

  notificationHasOverrides(userEntry) {
    if (!userEntry) {
      return false;
    }
    return userEntry.notifications !== undefined;
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

  // ----- Rendered structure -----

  get rowsByCategory() {
    const userCmdMap = this.userCommandsByKey;
    const userNotifMap = this.userNotificationsByKey;
    const notifDefaults = this.notificationDefaultsByKey;

    // Track which notifications are bound to a command (so the rest become "standalone").
    const boundNotificationKeys = new Set();

    const rowsByCat = {};
    for (const cmd of this.catalog.monitoringCommands || []) {
      const userCmd = userCmdMap[cmd.key] || {};
      const catKey = cmd.category || "other";
      if (!rowsByCat[catKey]) {
        rowsByCat[catKey] = [];
      }
      const row = this.buildCommandRow(cmd, userCmd, false);
      const notifKeys = Array.isArray(userCmd.notificationTypes)
        ? userCmd.notificationTypes
        : Array.isArray(cmd.notificationTypes)
          ? cmd.notificationTypes
          : [];
      for (const notifKey of notifKeys) {
        const notifCatalog = notifDefaults[notifKey];
        if (!notifCatalog) {
          continue;
        }
        boundNotificationKeys.add(notifKey);
        row.children.push(
          this.buildNotificationRow(notifCatalog, userNotifMap[notifKey] || {}, cmd.key),
        );
      }
      rowsByCat[catKey].push(row);
    }

    // Categories ordered by catalog `order`; fallback to derived key list.
    let catalogCategories = (this.catalog.categories || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (catalogCategories.length === 0) {
      catalogCategories = Object.keys(rowsByCat).map((k) => ({
        key: k,
        title: k,
        description: "",
        order: 0,
      }));
    }

    const result = [];
    for (const cat of catalogCategories) {
      const catRows = rowsByCat[cat.key] || [];
      if (catRows.length === 0) {
        continue;
      }
      // Prefer the catalog-supplied per-category icon / colorClass; fall back to the local
      // CATEGORY_ICONS map (only useful for pseudo-categories or an unexpected key) and to
      // a generic glyph if nothing else is available.
      const catalogIcon = cat.icon;
      const localData = CATEGORY_ICONS[cat.key];
      const catIcon = catalogIcon || (localData && localData.icon) || FALLBACK_ICON_NAME;
      const catColorClass =
        cat.colorClass || this.colorClassForCategory(cat.key);
      result.push({
        key: cat.key,
        title: cat.title,
        description: cat.description || "",
        icon: catIcon,
        iconContainerClass:
          "command-icon-container command-icon-container--lg " + catColorClass,
        rows: catRows,
      });
    }

    // Custom commands (added by the user, not in the catalog).
    const customRows = [];
    for (const userCmd of this.customCommands) {
      const row = this.buildCommandRow(null, userCmd, true);
      const explicitTypes = Array.isArray(userCmd.notificationTypes)
        ? userCmd.notificationTypes
        : [];
      // If the user did not pin specific notification types on this custom
      // command, assume it emits a single notification keyed by the command
      // itself (so author-implemented channels are configurable in the UI).
      const notifKeys = explicitTypes.length > 0 ? explicitTypes : [userCmd.key];
      for (const notifKey of notifKeys) {
        const notifCatalog = notifDefaults[notifKey];
        if (!notifCatalog) {
          continue;
        }
        boundNotificationKeys.add(notifKey);
        row.children.push(
          this.buildNotificationRow(notifCatalog, userNotifMap[notifKey] || {}, userCmd.key),
        );
      }
      customRows.push(row);
    }
    if (customRows.length > 0) {
      const customIconData = CATEGORY_ICONS.custom;
      result.push({
        key: "custom",
        title: this.i18n.monitoringCustomCategory,
        description: "",
        icon: customIconData.icon,
        iconContainerClass:
          "command-icon-container command-icon-container--lg " + customIconData.colorClass,
        rows: customRows,
      });
    }

    // Standalone notifications: notificationConfig entries not bound to any command.
    const standaloneRows = [];
    for (const notif of this.catalog.notificationConfig || []) {
      if (boundNotificationKeys.has(notif.key)) {
        continue;
      }
      standaloneRows.push(this.buildNotificationRow(notif, userNotifMap[notif.key] || {}, ""));
    }
    if (standaloneRows.length > 0) {
      const standaloneIconData = CATEGORY_ICONS.standalone;
      result.push({
        key: "standalone",
        title: this.i18n.monitoringStandaloneNotifications,
        description: this.i18n.monitoringStandaloneNotificationsDescription || "",
        icon: standaloneIconData.icon,
        iconContainerClass:
          "command-icon-container command-icon-container--lg " + standaloneIconData.colorClass,
        rows: standaloneRows,
        isStandaloneSection: true,
      });
    }

    // Merge single-notification commands into a one-line row.
    for (const section of result) {
      if (section.isStandaloneSection) {
        continue;
      }
      for (const row of section.rows) {
        if (row.rowKind !== "command" || !Array.isArray(row.children) || row.children.length !== 1) {
          continue;
        }
        const child = row.children[0];
        row.isMerged = true;
        row.mergedNotificationKey = child.key;
        row.mergedNotificationTitle = child.title;
        row.messaging = child.messaging;
        row.email = child.email;
        row.api = child.api;
        row.messagingOptions = child.messagingOptions;
        row.emailOptions = child.emailOptions;
        row.apiOptions = child.apiOptions;
        row.availableThresholds = child.availableThresholds;
        row.mergedHasOverrides = row.hasOverrides || child.hasOverrides;
        row.mergedShowReset = row.mergedHasOverrides && !row.isCustom;
        row.hasThresholdWarning = child.hasThresholdWarning;
        row.children = [];
      }
    }

    const total = result.length;
    return result.map((category, index) => ({
      ...category,
      sectionStyle: `z-index: ${total - index};`,
    }));
  }

  getDatasetValue(event, name) {
    return (
      event?.currentTarget?.dataset?.[name] ||
      event?.target?.dataset?.[name] ||
      ""
    );
  }

  // ----- Inline edits (table-level) -----

  handleRowFrequencyChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserCommand(key, (entry) => {
      entry.frequency = value;
      if (value !== "weekly" && value !== "biweekly") {
        delete entry.frequencyDay;
      }
      if (value !== "monthly") {
        delete entry.frequencyDayOfMonth;
      }
    });
  }

  handleNotificationMessagingChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserNotification(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      entry.notifications.messaging = value;
    });
  }

  handleNotificationEmailChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserNotification(key, (entry) => {
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

  handleNotificationApiChange(event) {
    const key = this.getDatasetValue(event, "key");
    const value = event.detail.value;
    if (!key || !value) {
      return;
    }
    this.updateUserNotification(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      entry.notifications.api = value;
    });
  }

  handleRowReset(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this.userCommands = (this.userCommands || []).filter((c) => !c || c.key !== key);
    this._autoSave();
  }

  handleNotificationReset(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this.userNotifications = (this.userNotifications || []).filter(
      (c) => !c || c.key !== key,
    );
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

  // ----- User-list mutators -----

  updateUserCommand(key, mutator) {
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

  updateUserNotification(key, mutator) {
    const list = (this.userNotifications || []).map((c) => ({ ...c }));
    let entry = list.find((c) => c && c.key === key);
    if (!entry) {
      entry = { key };
      list.push(entry);
    }
    mutator(entry);
    this.userNotifications = list;
    this._autoSave();
  }

  normalizeNotifications(notifs) {
    return notifs && typeof notifs === "object" ? { ...notifs } : {};
  }

  // ----- Details modal -----

  handleRowDetails(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this._openCommandDetails(key);
  }

  handleNotificationDetails(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    this._openNotificationDetails(key);
  }

  handleMergedDetails(event) {
    const cmdKey = event.currentTarget.dataset.cmdKey;
    const notifKey = event.currentTarget.dataset.notifKey;
    if (!cmdKey || !notifKey) {
      return;
    }
    this._openMergedDetails(cmdKey, notifKey);
  }

  handleMergedReset(event) {
    const cmdKey = event.currentTarget.dataset.cmdKey;
    const notifKey = event.currentTarget.dataset.notifKey;
    if (!cmdKey || !notifKey) {
      return;
    }
    this.userCommands = (this.userCommands || []).filter(
      (c) => !c || c.key !== cmdKey,
    );
    this.userNotifications = (this.userNotifications || []).filter(
      (c) => !c || c.key !== notifKey,
    );
    this._autoSave();
  }

  _openCommandDetails(key) {
    const catalogEntry = (this.catalog.monitoringCommands || []).find((e) => e.key === key);
    const userEntry = this.userCommandsByKey[key] || {};
    const effectiveFrequency =
      userEntry.frequency || catalogEntry?.frequency || DEFAULT_FREQUENCY;
    this.modalKind = "command";
    this.modalEntry = {
      key,
      title: catalogEntry?.title || userEntry.title || key,
      command: catalogEntry?.command || userEntry.command || "",
      isCustom: !catalogEntry,
      frequency: effectiveFrequency,
      frequencyDay: userEntry.frequencyDay || catalogEntry?.frequencyDay || "monday",
      frequencyDayOfMonth: userEntry.frequencyDayOfMonth || catalogEntry?.frequencyDayOfMonth || 1,
    };
    this.modalMessaging = "";
    this.modalEmail = "";
    this.modalApi = "";
    this.modalAvailableThresholds = [];
    this.modalEmailRecipientsText = "";
    this.modalReplaceRecipients = false;
    this.modalOpen = true;
  }

  _openNotificationDetails(key) {
    const catalogEntry = this.notificationDefaultsByKey[key];
    if (!catalogEntry) {
      return;
    }
    const userEntry = this.userNotificationsByKey[key] || {};
    const effective = this.resolveNotificationThresholds(catalogEntry, userEntry);
    const recipients = this.getEmailRecipients(userEntry);
    this.modalKind = "notification";
    this.modalEntry = {
      key,
      notificationKey: key,
      title: catalogEntry.title || key,
    };
    this.modalMessaging = effective.messaging;
    this.modalEmail = effective.email;
    this.modalApi = effective.api;
    this.modalAvailableThresholds = this.getAvailableThresholds(catalogEntry);
    this.modalEmailRecipientsText = recipients.join("\n");
    this.modalReplaceRecipients = this.getReplaceRecipients(userEntry);
    this.modalOpen = true;
  }

  _openMergedDetails(commandKey, notificationKey) {
    const cmdCatalog = (this.catalog.monitoringCommands || []).find(
      (e) => e.key === commandKey,
    );
    const userCmd = this.userCommandsByKey[commandKey] || {};
    const notifCatalog = this.notificationDefaultsByKey[notificationKey];
    // For custom commands, cmdCatalog is undefined — fall back to the user entry.
    if (!notifCatalog || (!cmdCatalog && !userCmd.key)) {
      return;
    }
    const isCustom = !cmdCatalog;
    const userNotif = this.userNotificationsByKey[notificationKey] || {};
    const effectiveFreq =
      userCmd.frequency || cmdCatalog?.frequency || DEFAULT_FREQUENCY;
    const effectiveThresholds = this.resolveNotificationThresholds(
      notifCatalog,
      userNotif,
    );
    const recipients = this.getEmailRecipients(userNotif);
    this.modalKind = "merged";
    this.modalEntry = {
      key: commandKey,
      notificationKey,
      title: cmdCatalog?.title || userCmd.title || commandKey,
      command: cmdCatalog?.command || userCmd.command || "",
      isCustom,
      frequency: effectiveFreq,
      frequencyDay: userCmd.frequencyDay || cmdCatalog?.frequencyDay || "monday",
      frequencyDayOfMonth:
        userCmd.frequencyDayOfMonth || cmdCatalog?.frequencyDayOfMonth || 1,
    };
    this.modalMessaging = effectiveThresholds.messaging;
    this.modalEmail = effectiveThresholds.email;
    this.modalApi = effectiveThresholds.api;
    this.modalAvailableThresholds = this.getAvailableThresholds(notifCatalog);
    this.modalEmailRecipientsText = recipients.join("\n");
    this.modalReplaceRecipients = this.getReplaceRecipients(userNotif);
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

  get modalIsCommand() {
    return this.modalKind === "command" || this.modalKind === "merged";
  }

  get modalIsNotification() {
    return this.modalKind === "notification" || this.modalKind === "merged";
  }

  get modalIsWeekly() {
    return (
      this.modalIsCommand &&
      this.modalEntry &&
      (this.modalEntry.frequency === "weekly" || this.modalEntry.frequency === "biweekly")
    );
  }

  get modalIsMonthly() {
    return this.modalIsCommand && this.modalEntry && this.modalEntry.frequency === "monthly";
  }

  get modalFrequencyOptions() {
    const current = this.modalEntry?.frequency;
    return this.makeOptions(this.catalog?.options?.frequencies, current);
  }

  get modalFrequencyDayOptions() {
    const current = this.modalEntry?.frequencyDay;
    return this.makeOptions(this.catalog?.options?.frequencyDays, current);
  }

  get modalThresholdSource() {
    if (Array.isArray(this.modalAvailableThresholds) && this.modalAvailableThresholds.length > 0) {
      return this.modalAvailableThresholds;
    }
    return this.catalog?.options?.thresholds || [];
  }

  get modalMessagingOptions() {
    return this.makeOptions(this.modalThresholdSource, this.modalMessaging);
  }

  get modalEmailThresholdOptions() {
    return this.makeOptions(this.modalThresholdSource, this.modalEmail);
  }

  get modalApiOptions() {
    return this.makeOptions(this.modalThresholdSource, this.modalApi);
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
    const raw =
      event.detail && event.detail.value !== undefined
        ? event.detail.value
        : event.target?.value;
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
    const value =
      event.detail && typeof event.detail.value === "string"
        ? event.detail.value
        : event.target?.value || "";
    this.modalEmailRecipientsText = value;
  }

  handleModalReplaceChange(event) {
    const checked =
      event.detail && typeof event.detail.checked === "boolean"
        ? event.detail.checked
        : !!event.target?.checked;
    this.modalReplaceRecipients = checked;
  }

  handleModalSave() {
    try {
      if (!this.modalEntry) {
        return;
      }
      const commandKey = this.modalEntry.key;
      const notificationKey = this.modalEntry.notificationKey || this.modalEntry.key;

      if (this.modalIsCommand) {
        const newFrequency = this.modalEntry.frequency;
        const newDay = this.modalEntry.frequencyDay;
        const newDayOfMonth = this.modalEntry.frequencyDayOfMonth;
        this.updateUserCommand(commandKey, (entry) => {
          if (newFrequency) {
            entry.frequency = newFrequency;
          }
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
        });
      }

      if (this.modalIsNotification) {
        const newMessaging = this.modalMessaging;
        const newEmailThreshold = this.modalEmail;
        const newApi = this.modalApi;
        const recipients = (this.modalEmailRecipientsText || "")
          .split(/[\r\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const replace = this.modalReplaceRecipients;

        this.updateUserNotification(notificationKey, (entry) => {
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
          else if (newEmailThreshold) {
            entry.notifications.email = newEmailThreshold;
          }
          else {
            delete entry.notifications.email;
          }
        });
      }
    }
    catch (error) {
      // Surface the error in the webview console; never leave the modal stuck open.
      // eslint-disable-next-line no-console
      console.error("[monitoringConfig] handleModalSave failed:", error);
    }
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
    if (this.builtInCommandKeySet.has(key)) {
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

  // ----- Persistence -----

  _autoSave() {
    // Deep-clone via JSON so any LWC @track proxy wrappers nested inside the
    // payload (notificationTypes[], notifications.email.recipients[], etc.)
    // get stripped — otherwise postMessage's structured-clone algorithm throws
    // "[object Array] could not be cloned." and the save never reaches the host.
    const cleaned = JSON.parse(JSON.stringify(this.cleanForSave()));
    window.sendMessageToVSCode({
      type: "saveMonitoringConfig",
      data: cleaned,
    });
    this.userCommands = JSON.parse(JSON.stringify(cleaned.monitoringCommands));
    this.userNotifications = JSON.parse(JSON.stringify(cleaned.notificationConfig));
  }

  handleOpenDocs() {
    if (this.docUrl) {
      window.sendMessageToVSCode({
        type: "openExternal",
        data: this.docUrl,
      });
    }
  }

  cleanForSave() {
    const builtIns = this.builtInCommandKeySet;
    const cmdOut = [];
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
      if (Array.isArray(c.notificationTypes) && c.notificationTypes.length > 0) {
        entry.notificationTypes = c.notificationTypes.slice();
      }
      const hasOverride =
        isCustom ||
        entry.frequency !== undefined ||
        entry.frequencyDay !== undefined ||
        entry.frequencyDayOfMonth !== undefined ||
        entry.notificationTypes !== undefined;
      if (hasOverride) {
        cmdOut.push(entry);
      }
    }

    const notifOut = [];
    for (const n of this.userNotifications || []) {
      if (!n || !n.key) {
        continue;
      }
      const entry = { key: n.key };
      if (n.notifications && typeof n.notifications === "object") {
        const notifs = {};
        if (n.notifications.messaging) {
          notifs.messaging = n.notifications.messaging;
        }
        if (n.notifications.api) {
          notifs.api = n.notifications.api;
        }
        const email = n.notifications.email;
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
      if (entry.notifications !== undefined) {
        notifOut.push(entry);
      }
    }

    return { monitoringCommands: cmdOut, notificationConfig: notifOut };
  }
}
