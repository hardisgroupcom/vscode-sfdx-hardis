/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6

/**
 * Shared helpers for the colored pills displayed in datatables
 * (statusPill / typePill cell types of s/hardisDatatable).
 *
 * Two families of pills, both rendered with the same shape:
 * - STATE pills use the semantic classes of global-theme.css
 *   (hardis-status-success / -info / -pending / -failed / -unknown).
 * - CATEGORY pills use the neutral hue classes (hardis-hue-<name>), whose
 *   names mirror the .hardis-tile hues so the same category keeps the same
 *   color across the panels.
 *
 * Keeping the mapping here means every panel colors the same value the same
 * way, and unknown values still get a stable color instead of plain text.
 */

import { hashString } from "s/avatarUtils";

// Hues used when a value has no known category. Deliberately excludes red
// (reserved for genuine failures) and slate (the "unknown" look).
const FALLBACK_HUES = [
  "blue",
  "teal",
  "violet",
  "amber",
  "indigo",
  "green",
  "pink",
  "cyan",
  "purple",
];

/**
 * CSS classes of a category pill.
 * @param {string} hue hue name (blue, teal, violet, amber, indigo, green,
 *                     pink, cyan, purple, red, slate)
 * @returns {string} pill CSS classes
 */
export function getPillClass(hue) {
  return `hardis-pill hardis-hue-${hue || "slate"}`;
}

/**
 * CSS classes of a category pill whose hue is a stable hash of the value, so
 * an unmapped value still gets a readable and always identical color.
 * @param {string} value value driving the hue
 * @returns {string} pill CSS classes
 */
export function getHashedPillClass(value) {
  const hue = FALLBACK_HUES[hashString(value) % FALLBACK_HUES.length];
  return getPillClass(hue);
}

/* ------------------------------------------------------------------ */
/* Ticket statuses (Jira / Azure Boards, free text and localized)      */
/* ------------------------------------------------------------------ */

// Keywords matched (case-insensitive, accents removed) against the status
// label of a ticket. First family matching a keyword wins.
const TICKET_STATUS_KEYWORDS = [
  {
    statusClass: "hardis-status-failed",
    keywords: [
      "blocked",
      "bloque",
      "rejected",
      "rejete",
      "refuse",
      "cancel",
      "annule",
      "abgebrochen",
      "abgelehnt",
      "cancelado",
      "rechazado",
      "won't do",
      "wont do",
    ],
  },
  {
    statusClass: "hardis-status-success",
    keywords: [
      "done",
      "closed",
      "resolved",
      "complete",
      "deployed",
      "released",
      "termine",
      "ferme",
      "resolu",
      "cloture",
      "livre",
      "cerrado",
      "resuelto",
      "completado",
      "erledigt",
      "abgeschlossen",
      "geschlossen",
      "fertig",
      "concluido",
      "chiuso",
      "completato",
      "afgerond",
      "gesloten",
      "zakonczone",
      "完了",
      "終了",
    ],
  },
  {
    statusClass: "hardis-status-info",
    keywords: [
      "progress",
      "doing",
      "review",
      "testing",
      "test",
      "active",
      "development",
      "implementation",
      "en cours",
      "revue",
      "relecture",
      "curso",
      "revision",
      "bearbeitung",
      "prufung",
      "corso",
      "revisione",
      "bezig",
      "trakcie",
      "進行中",
      "対応中",
    ],
  },
  {
    statusClass: "hardis-status-pending",
    keywords: [
      "hold",
      "waiting",
      "pending",
      "attente",
      "espera",
      "wartet",
      "attesa",
      "wacht",
      "oczekuje",
      "保留",
    ],
  },
  {
    statusClass: "hardis-status-unknown",
    keywords: [
      "to do",
      "todo",
      "backlog",
      "new",
      "open",
      "draft",
      "a faire",
      "nouveau",
      "ouvert",
      "brouillon",
      "por hacer",
      "nuevo",
      "abierto",
      "offen",
      "neu",
      "entwurf",
      "da fare",
      "nuovo",
      "aperto",
      "te doen",
      "nieuw",
      "nowe",
      "otwarte",
      "未着手",
      "新規",
    ],
  },
];

/**
 * Lowercased, accent-free version of a label, so "Terminé" matches "termine".
 * @param {string} value label to normalize
 * @returns {string} normalized label
 */
function normalizeLabel(value) {
  const text = (value || "").toString().toLowerCase().trim();
  if (typeof text.normalize === "function") {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return text;
}

/**
 * CSS classes of the pill displaying a ticket status. Statuses are free text
 * defined by each Jira / Azure Boards project (and often localized), so the
 * label is matched against keyword families; anything unrecognized still gets
 * a stable hue rather than no color at all.
 * @param {string} statusLabel status label of the ticket
 * @returns {string} pill CSS classes
 */
export function getTicketStatusPillClass(statusLabel) {
  if (!statusLabel) {
    return "hardis-pill hardis-status-unknown";
  }
  const normalized = normalizeLabel(statusLabel);
  for (const family of TICKET_STATUS_KEYWORDS) {
    if (family.keywords.some((keyword) => normalized.includes(keyword))) {
      return `hardis-pill ${family.statusClass}`;
    }
  }
  return getHashedPillClass(statusLabel);
}

/* ------------------------------------------------------------------ */
/* Metadata types (Metadata Retriever)                                 */
/* ------------------------------------------------------------------ */

// Hue of each metadata family. Red is deliberately unused: a metadata type is
// a category, never an error, and red pills would read as failures.
const METADATA_CATEGORY_HUE = {
  apex: "violet",
  ui: "cyan",
  automation: "amber",
  data: "teal",
  security: "indigo",
  integration: "pink",
  analytics: "blue",
  experience: "green",
  settings: "slate",
};

// Metadata types whose family cannot be guessed from their name.
const METADATA_TYPE_CATEGORY = {
  ApexClass: "apex",
  ApexComponent: "apex",
  ApexPage: "apex",
  ApexTestSuite: "apex",
  ApexTrigger: "apex",
  AppMenu: "ui",
  ApprovalProcess: "automation",
  AssignmentRules: "automation",
  AuraDefinitionBundle: "ui",
  AuthProvider: "integration",
  AutoResponseRules: "automation",
  BusinessProcess: "data",
  CertificateAndKey: "integration",
  CompactLayout: "ui",
  ConnectedApp: "integration",
  ContentAsset: "ui",
  CorsWhitelistOrigin: "integration",
  CustomApplication: "ui",
  CustomField: "data",
  CustomLabel: "data",
  CustomLabels: "data",
  CustomMetadata: "data",
  CustomObject: "data",
  CustomObjectTranslation: "data",
  CustomPermission: "security",
  CustomSite: "experience",
  CustomTab: "ui",
  Dashboard: "analytics",
  Document: "ui",
  DuplicateRule: "automation",
  EmailTemplate: "ui",
  EscalationRules: "automation",
  ExperienceBundle: "experience",
  ExternalDataSource: "integration",
  ExternalServiceRegistration: "integration",
  FieldSet: "data",
  FlexiPage: "ui",
  Flow: "automation",
  FlowDefinition: "automation",
  GlobalValueSet: "data",
  Group: "security",
  HomePageComponent: "ui",
  HomePageLayout: "ui",
  Index: "data",
  Layout: "ui",
  LightningComponentBundle: "ui",
  LightningMessageChannel: "ui",
  ListView: "data",
  MatchingRule: "automation",
  NamedCredential: "integration",
  NavigationMenu: "experience",
  Network: "experience",
  PathAssistant: "ui",
  PermissionSet: "security",
  PermissionSetGroup: "security",
  Portal: "experience",
  Profile: "security",
  Queue: "security",
  QuickAction: "ui",
  RecordType: "data",
  RemoteSiteSetting: "integration",
  Report: "analytics",
  ReportType: "analytics",
  Role: "security",
  SamlSsoConfig: "integration",
  SharingReason: "data",
  Site: "experience",
  SiteDotCom: "experience",
  StandardValueSet: "data",
  StaticResource: "ui",
  Translations: "data",
  UserRole: "security",
  ValidationRule: "automation",
  WebLink: "data",
  Workflow: "automation",
};

// Fallback rules for the ~200 remaining metadata types, applied in order.
const METADATA_TYPE_PATTERNS = [
  [/Settings$/, "settings"],
  [/^(Apex|Visualforce)/, "apex"],
  [/^(Wave|Analytic|Report|Dashboard|Discovery|Insights)/, "analytics"],
  [/^(Profile|Permission|Sharing|Muting|Territory|User)/, "security"],
  [/(Permission|SharingRules)$/, "security"],
  [
    /^(Workflow|Flow|Approval|Assignment|Escalation|Duplicate|Matching)/,
    "automation",
  ],
  [/Rule(s)?$/, "automation"],
  [/^(Lightning|Aura|Path|Custom(Application|Tab)|App|Branding|Theme)/, "ui"],
  [/Layout$/, "ui"],
  [
    /^(Community|Network|Experience|Site|Portal|Audience|Moderation|Keyword|Managed)/,
    "experience",
  ],
  [
    /^(Connected|Auth|External|Platform|Cors|Csp|Certificate|Api|Saml|Named|Remote)/,
    "integration",
  ],
  [
    /^(Custom(Object|Field|Metadata|Label)|Record|Global|Standard|Field|List|Business|Data)/,
    "data",
  ],
];

/**
 * CSS classes of the pill displaying a metadata type. Types are grouped by
 * family (Apex, UI, automation, data model, security, integration, analytics,
 * experience, settings) so a long result list can be scanned by color.
 * @param {string} metadataType Metadata API xmlName (e.g. ApexClass)
 * @returns {string} pill CSS classes
 */
export function getMetadataTypePillClass(metadataType) {
  if (!metadataType) {
    return getPillClass("slate");
  }
  const category = METADATA_TYPE_CATEGORY[metadataType];
  if (category) {
    return getPillClass(METADATA_CATEGORY_HUE[category]);
  }
  for (const [pattern, patternCategory] of METADATA_TYPE_PATTERNS) {
    if (pattern.test(metadataType)) {
      return getPillClass(METADATA_CATEGORY_HUE[patternCategory]);
    }
  }
  return getHashedPillClass(metadataType);
}
