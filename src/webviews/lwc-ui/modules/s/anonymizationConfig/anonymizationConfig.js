/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

/**
 * Editor of the `anonymization` property of `.sfdx-hardis.yml`.
 *
 * Shared by the Pipeline Settings panel (Security & Privacy section) and by the
 * Monitoring Config Workbench, so both places offer the same levels, the same
 * per-channel rules and the same explanations.
 *
 * Props:
 *   value     : the `anonymization` object of the config, or null when unset
 *   read-only : renders the current configuration without any control
 *   doc-url   : documentation page opened by the "Docs" link
 * Fires:
 *   change    : { value } - the new anonymization object, or null when the
 *               configuration went back to the sfdx-hardis defaults
 */

const LEVELS = ["off", "standard", "strict"];
const CHANNELS = ["files", "api", "email", "messaging"];
// Level sfdx-hardis applies when the property is not configured. It is the
// default of CI runs, which is what this configuration governs (local runs are
// left raw unless enforceLocally is on).
const DEFAULT_LEVEL = "standard";
const DEFAULT_DOC_URL =
  "https://sfdx-hardis.cloudity.com/salesforce-security-privacy/#data-anonymization";

// Level -> icon tile of the level card. Going down the list is going from "the
// reports keep every name" to "even the administrators who acted are masked".
const LEVEL_TILES = {
  off: { icon: "utility:preview", hue: "slate" },
  standard: { icon: "utility:privately_shared", hue: "teal" },
  strict: { icon: "utility:lock", hue: "violet" },
};

export default class AnonymizationConfig extends SharedMixin(LightningElement) {
  @api readOnly = false;
  @api docUrl = DEFAULT_DOC_URL;

  @track _config = { level: "", enforceLocally: false, channels: {} };

  @api
  get value() {
    return this._buildValue();
  }
  set value(newValue) {
    this._config = this._normalize(newValue);
  }

  // --- Normalization --------------------------------------------------------

  /**
   * A per-channel level can only RAISE the global one: a weaker value has no
   * effect at all in sfdx-hardis. Loading it clamped to the level in force
   * keeps the panel showing what the CLI really does, instead of a value that
   * looks configured but never applies. The level in force is the configured
   * one, or the default sfdx-hardis applies when there is none.
   */
  _normalize(rawValue) {
    const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
    const level = LEVELS.includes(raw.level) ? raw.level : "";
    const floor = level || DEFAULT_LEVEL;
    const channels = {};
    const rawChannels =
      raw.channels && typeof raw.channels === "object" ? raw.channels : {};
    for (const channel of CHANNELS) {
      const channelLevel = rawChannels[channel];
      if (!LEVELS.includes(channelLevel)) {
        continue;
      }
      channels[channel] =
        LEVELS.indexOf(channelLevel) < LEVELS.indexOf(floor)
          ? floor
          : channelLevel;
    }
    return {
      level,
      enforceLocally: raw.enforceLocally === true,
      channels,
    };
  }

  /** Config object to persist, or null when nothing differs from the defaults */
  _buildValue() {
    const built = {};
    if (this._config.level) {
      built.level = this._config.level;
    }
    if (this._config.enforceLocally) {
      built.enforceLocally = true;
    }
    const channels = {};
    for (const channel of CHANNELS) {
      if (this._config.channels[channel]) {
        channels[channel] = this._config.channels[channel];
      }
    }
    if (Object.keys(channels).length > 0) {
      built.channels = channels;
    }
    return Object.keys(built).length > 0 ? built : null;
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this._buildValue() },
      }),
    );
  }

  // --- Derived state --------------------------------------------------------

  get isEditable() {
    return this.readOnly !== true;
  }

  get isConfigured() {
    return this._buildValue() !== null;
  }

  get showDefaultHint() {
    return !this._config.level;
  }

  /** Level actually in force: the configured one, or the sfdx-hardis default */
  get effectiveLevel() {
    return this._config.level || DEFAULT_LEVEL;
  }

  get levelLabels() {
    return {
      off: this.i18n.anonymizationLevelOff,
      standard: this.i18n.anonymizationLevelStandard,
      strict: this.i18n.anonymizationLevelStrict,
    };
  }

  get levelCards() {
    const labels = this.levelLabels;
    const descriptions = {
      off: this.i18n.anonymizationLevelOffDesc,
      standard: this.i18n.anonymizationLevelStandardDesc,
      strict: this.i18n.anonymizationLevelStrictDesc,
    };
    // The level in force is highlighted even when nothing is configured, so
    // the panel always answers "what applies today". A badge then tells the
    // difference between an explicit choice and the sfdx-hardis default.
    const effectiveLevel = this.effectiveLevel;
    const isDefault = !this._config.level;
    return LEVELS.map((level) => {
      const selected = effectiveLevel === level;
      const classes = ["hardis-card"];
      if (this.isEditable) {
        classes.push("clickable");
      }
      if (selected) {
        classes.push("selected");
      }
      return {
        level,
        label: labels[level],
        description: descriptions[level],
        iconName: LEVEL_TILES[level].icon,
        tileClass: `hardis-tile small ${LEVEL_TILES[level].hue}`,
        cardClass: classes.join(" "),
        ariaChecked: selected ? "true" : "false",
        tabIndex: this.isEditable ? "0" : "-1",
        showDefaultBadge: selected && isDefault,
      };
    });
  }

  /** Once the level in force is the strictest one, no channel can raise anything */
  get channelsLocked() {
    return this.effectiveLevel === "strict";
  }

  get channelOptions() {
    const labels = this.levelLabels;
    const allowed = LEVELS.slice(LEVELS.indexOf(this.effectiveLevel));
    return [
      { label: this.i18n.anonymizationInherit, value: "" },
      ...allowed.map((level) => ({ label: labels[level], value: level })),
    ];
  }

  get channelRows() {
    const labels = this.levelLabels;
    const rowLabels = {
      files: this.i18n.anonymizationChannelFiles,
      api: this.i18n.anonymizationChannelApi,
      email: this.i18n.anonymizationChannelEmail,
      messaging: this.i18n.anonymizationChannelMessaging,
    };
    const rowDescriptions = {
      files: this.i18n.anonymizationDescFiles,
      api: this.i18n.anonymizationDescApi,
      email: this.i18n.anonymizationDescEmail,
      messaging: this.i18n.anonymizationDescMessaging,
    };
    const options = this.channelOptions;
    return CHANNELS.map((channel) => {
      const value = this._config.channels[channel] || "";
      return {
        channel,
        label: rowLabels[channel],
        description: rowDescriptions[channel],
        value,
        options,
        disabled: this.channelsLocked,
        hasOverride: value !== "",
        displayLabel: value ? labels[value] : this.i18n.anonymizationInherit,
        pillClass: value
          ? "hardis-pill hardis-status-info"
          : "hardis-pill hardis-status-unknown",
      };
    });
  }

  get enforceLocally() {
    return this._config.enforceLocally === true;
  }

  get enforceLocallyPillClass() {
    return this._config.enforceLocally
      ? "hardis-pill hardis-status-success"
      : "hardis-pill hardis-status-unknown";
  }

  get enforceLocallyPillLabel() {
    return this._config.enforceLocally
      ? this.i18n.enabledLabel
      : this.i18n.disabledLabel;
  }

  // --- Handlers -------------------------------------------------------------

  handleLevelClick(event) {
    if (!this.isEditable) {
      return;
    }
    const level = event.currentTarget.dataset.level;
    if (!LEVELS.includes(level) || this._config.level === level) {
      return;
    }
    // Picking the highlighted default level is not a no-op: it makes it
    // explicit in the YAML, so it survives a change of sfdx-hardis default
    // Raising the global level also raises every channel that was set below it
    const channels = {};
    for (const channel of CHANNELS) {
      const channelLevel = this._config.channels[channel];
      if (!channelLevel) {
        continue;
      }
      channels[channel] =
        LEVELS.indexOf(channelLevel) < LEVELS.indexOf(level)
          ? level
          : channelLevel;
    }
    this._config = { ...this._config, level, channels };
    this._emitChange();
  }

  handleLevelKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.handleLevelClick(event);
    }
  }

  // lightning-input and lightning-combobox fire `change` with bubbles+composed:
  // without stopPropagation the raw control value would escape this component
  // and reach the `onchange` of the hosting panel, which listens for the whole
  // anonymization object.
  handleEnforceLocallyChange(event) {
    event.stopPropagation();
    this._config = {
      ...this._config,
      enforceLocally: event.target.checked === true,
    };
    this._emitChange();
  }

  handleChannelChange(event) {
    event.stopPropagation();
    const channel = event.target.dataset.channel;
    if (!CHANNELS.includes(channel)) {
      return;
    }
    const level = event.detail?.value ?? event.target.value ?? "";
    const channels = { ...this._config.channels };
    if (level) {
      channels[channel] = level;
    } else {
      delete channels[channel];
    }
    this._config = { ...this._config, channels };
    this._emitChange();
  }

  handleReset() {
    this._config = { level: "", enforceLocally: false, channels: {} };
    this._emitChange();
  }

  handleOpenDoc() {
    const url = this.docUrl || DEFAULT_DOC_URL;
    window.sendMessageToVSCode({ type: "openExternal", data: url });
  }
}
