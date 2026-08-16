/* eslint-disable */
// @ts-nocheck
import LightningDatatable from "lightning/datatable";
import statusPill from "./statusPill.html";
import avatarText from "./avatarText.html";
import branchChip from "./branchChip.html";

/**
 * lightning-datatable extended with SLDS-flavored cell types shared by the
 * hardis webviews (styling lives in resources/global-theme.css):
 * - statusPill: colored status pill (dot + label), optionally a link to the
 *   CI job. typeAttributes: label, pillClass (fully computed CSS classes,
 *   e.g. "hardis-pill hardis-status-success"), url.
 * - avatarText: initials avatar circle + text value. typeAttributes:
 *   initials, avatarClass (computed CSS classes for the color variant).
 * - branchChip: monospace chip for technical identifiers such as git branch
 *   names; the full value is available on hover. No typeAttributes.
 */
export default class HardisDatatable extends LightningDatatable {
  static customTypes = {
    statusPill: {
      template: statusPill,
      standardCellLayout: true,
      typeAttributes: ["label", "pillClass", "url"],
    },
    avatarText: {
      template: avatarText,
      standardCellLayout: true,
      typeAttributes: ["initials", "avatarClass"],
    },
    branchChip: {
      template: branchChip,
      standardCellLayout: true,
      typeAttributes: [],
    },
  };
}
