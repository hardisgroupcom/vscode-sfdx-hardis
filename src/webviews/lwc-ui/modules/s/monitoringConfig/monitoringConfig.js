/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

const DEFAULT_FREQUENCY = "weekly";

export default class MonitoringConfig extends SharedMixin(LightningElement) {
  @track catalog = { entries: [], options: { frequencies: [], frequencyDays: [], thresholds: [], channels: [] } };
  @track userCommands = [];
  @track branches = [];
  @track currentBranch = "";
  @track docUrl = "";
  @track copyFromBranch = "";
  @track modalOpen = false;
  @track modalEntry = null;
  @track modalEmailRecipientsText = "";
  @track modalReplaceRecipients = false;
  @track customRowDraft = null;
  @track customFormOpen = false;
  @track dirty = false;

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
    this.dirty = false;
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
      this.dirty = true;
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

  get rows() {
    const opts = this.catalog?.options || {};
    const frequencies = opts.frequencies || [];
    const thresholds = opts.thresholds || [];
    const userMap = this.userByKey;
    const rows = [];
    // Built-in commands (from catalog)
    for (const entry of this.catalog?.entries || []) {
      if (entry.kind && entry.kind !== "monitoringCommand") {
        continue;
      }
      const userEntry = userMap[entry.key] || {};
      const effective = this.resolveEffectiveEntry(entry, userEntry);
      rows.push({
        key: entry.key,
        isCustom: false,
        title: entry.title,
        description: entry.description,
        command: entry.command,
        commandDisplay: entry.command || "",
        frequencyValue: effective.frequency,
        frequencyOptions: this.makeOptions(frequencies, effective.frequency),
        messagingValue: effective.notifications.messaging,
        messagingOptions: this.makeOptions(
          thresholds,
          effective.notifications.messaging,
        ),
        emailValue: effective.notifications.email,
        emailOptions: this.makeOptions(
          thresholds,
          effective.notifications.email,
        ),
        apiValue: effective.notifications.api,
        apiOptions: this.makeOptions(thresholds, effective.notifications.api),
        hasOverrides: this.hasOverrides(userEntry),
      });
    }
    // Custom commands (not in catalog)
    for (const userEntry of this.customCommands) {
      const effective = this.resolveEffectiveEntry(null, userEntry);
      rows.push({
        key: userEntry.key,
        isCustom: true,
        title: userEntry.title || userEntry.key,
        description: "",
        command: userEntry.command || "",
        commandDisplay: userEntry.command || "",
        frequencyValue: effective.frequency,
        frequencyOptions: this.makeOptions(frequencies, effective.frequency),
        messagingValue: effective.notifications.messaging,
        messagingOptions: this.makeOptions(
          thresholds,
          effective.notifications.messaging,
        ),
        emailValue: effective.notifications.email,
        emailOptions: this.makeOptions(
          thresholds,
          effective.notifications.email,
        ),
        apiValue: effective.notifications.api,
        apiOptions: this.makeOptions(thresholds, effective.notifications.api),
        hasOverrides: true,
      });
    }
    return rows;
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
    const out = (values || []).map((v) => ({
      label: this.t(`monitoringEnum_${v}`) || v,
      value: v,
    }));
    // Ensure current value is included even if not in options list
    if (current && !out.some((o) => o.value === current)) {
      out.push({ label: current, value: current });
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

  // ----- Branch picker -----

  get branchOptions() {
    return (this.branches || [])
      .filter((b) => b !== this.currentBranch)
      .map((b) => ({ label: b, value: b }));
  }

  get hasBranches() {
    return this.branchOptions.length > 0;
  }

  get copyDisabled() {
    return !this.copyFromBranch;
  }

  handleCopyBranchChange(event) {
    this.copyFromBranch = event.detail.value;
  }

  handleApplyCopy() {
    if (!this.copyFromBranch) {
      return;
    }
    window.sendMessageToVSCode({
      type: "loadFromBranch",
      data: { branch: this.copyFromBranch },
    });
  }

  // ----- Row edits -----

  ensureUserEntry(key) {
    let entry = (this.userCommands || []).find((c) => c && c.key === key);
    if (!entry) {
      entry = { key };
      this.userCommands = [...(this.userCommands || []), entry];
    }
    return entry;
  }

  updateUserEntry(key, mutator) {
    const list = (this.userCommands || []).map((c) => ({ ...c }));
    let entry = list.find((c) => c && c.key === key);
    if (!entry) {
      entry = { key };
      list.push(entry);
    }
    mutator(entry);
    this.userCommands = list;
    this.dirty = true;
  }

  handleFrequencyChange(event) {
    const key = event.target.dataset.key;
    const value = event.detail.value;
    this.updateUserEntry(key, (entry) => {
      entry.frequency = value;
    });
  }

  handleMessagingChange(event) {
    const key = event.target.dataset.key;
    const value = event.detail.value;
    this.updateUserEntry(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      entry.notifications.messaging = value;
    });
  }

  handleEmailChange(event) {
    const key = event.target.dataset.key;
    const value = event.detail.value;
    this.updateUserEntry(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      const existing = entry.notifications.email;
      if (existing && typeof existing === "object") {
        existing.threshold = value;
      }
      else {
        entry.notifications.email = value;
      }
    });
  }

  handleApiChange(event) {
    const key = event.target.dataset.key;
    const value = event.detail.value;
    this.updateUserEntry(key, (entry) => {
      entry.notifications = this.normalizeNotifications(entry.notifications);
      entry.notifications.api = value;
    });
  }

  normalizeNotifications(notifs) {
    return notifs && typeof notifs === "object" ? { ...notifs } : {};
  }

  // ----- Reset / delete -----

  handleResetRow(event) {
    const key = event.target.dataset.key;
    this.userCommands = (this.userCommands || []).filter(
      (c) => !c || c.key !== key,
    );
    this.dirty = true;
  }

  handleDeleteCustomRow(event) {
    const key = event.target.dataset.key;
    this.userCommands = (this.userCommands || []).filter(
      (c) => !c || c.key !== key,
    );
    this.dirty = true;
  }

  // ----- Details modal -----

  handleOpenDetails(event) {
    const key = event.target.dataset.key;
    const catalogEntry = (this.catalog?.entries || []).find(
      (e) => e.key === key,
    );
    const userEntry = this.userByKey[key] || {};
    const effective = this.resolveEffectiveEntry(catalogEntry, userEntry);
    const recipients = this.getEmailRecipients(userEntry);
    this.modalEntry = {
      key,
      title: catalogEntry?.title || userEntry.title || key,
      isCustom: !catalogEntry,
      frequency: effective.frequency,
      frequencyDay:
        userEntry.frequencyDay ||
        catalogEntry?.frequencyDay ||
        "monday",
      frequencyDayOfMonth:
        userEntry.frequencyDayOfMonth ||
        catalogEntry?.frequencyDayOfMonth ||
        1,
    };
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
      const existingEmail = entry.notifications.email;
      const existingThreshold =
        existingEmail && typeof existingEmail === "object"
          ? existingEmail.threshold
          : existingEmail;
      if (recipients.length > 0 || replace) {
        const emailObj = {};
        if (existingThreshold) {
          emailObj.threshold = existingThreshold;
        }
        if (recipients.length > 0) {
          emailObj.recipients = recipients;
        }
        if (replace) {
          emailObj.replaceRecipients = true;
        }
        entry.notifications.email = emailObj;
      }
      else if (existingEmail && typeof existingEmail === "object") {
        entry.notifications.email = existingThreshold;
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
    const field = event.target.dataset.field;
    const value =
      event.detail && event.detail.value !== undefined
        ? event.detail.value
        : event.target.value;
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
    this.dirty = true;
    this.customRowDraft = null;
    this.customFormOpen = false;
  }

  handleCustomFormCancel() {
    this.customRowDraft = null;
    this.customFormOpen = false;
  }

  // ----- Save / cancel -----

  handleSaveAll() {
    const cleaned = this.cleanCommandsForSave();
    window.sendMessageToVSCode({
      type: "saveMonitoringConfig",
      data: { monitoringCommands: cleaned },
    });
    this.userCommands = JSON.parse(JSON.stringify(cleaned));
    this.dirty = false;
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
