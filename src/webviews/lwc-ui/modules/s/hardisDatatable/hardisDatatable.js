/* eslint-disable */
// @ts-nocheck
import LightningDatatable from "lightning/datatable";
import statusPill from "./statusPill.html";
import avatarText from "./avatarText.html";
import branchChip from "./branchChip.html";
import typePill from "./typePill.html";

/**
 * lightning-datatable extended with SLDS-flavored cell types shared by the
 * hardis webviews (styling lives in resources/global-theme.css):
 * - statusPill: colored status pill (dot + label), optionally a link to the
 *   CI job. typeAttributes: label, pillClass (fully computed CSS classes,
 *   e.g. "hardis-pill hardis-status-success"), url.
 * - avatarText: initials avatar circle + text value. typeAttributes:
 *   initials, avatarClass (computed CSS classes for the color variant).
 * - typePill: colored CATEGORY pill (leading icon or dot + label), optionally
 *   a link. Same shape as statusPill but the hue carries a category
 *   (deployment action type, metadata type...) instead of a state.
 *   typeAttributes: label, pillClass (see s/pillUtils), url, tooltip,
 *   iconName (SLDS icon shown instead of the dot).
 * - branchChip: monospace chip for technical identifiers such as git branch
 *   names; the full value is available on hover. No typeAttributes.
 *
 * Hovering a cell shows its full value in a tooltip (standard cell types such
 * as text, number or date truncate long values without any hover title).
 * A right click on a cell opens a small menu to copy its value to the clipboard.
 */
export default class HardisDatatable extends LightningDatatable {
  static customTypes = {
    statusPill: {
      template: statusPill,
      standardCellLayout: true,
      typeAttributes: ["label", "pillClass", "url"],
    },
    typePill: {
      template: typePill,
      standardCellLayout: true,
      typeAttributes: ["label", "pillClass", "url", "tooltip", "iconName"],
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

  connectedCallback() {
    if (super.connectedCallback) {
      super.connectedCallback();
    }
    this._onCellContextMenu = (event) => this.handleCellContextMenu(event);
    this.addEventListener("contextmenu", this._onCellContextMenu);
    this._onCellMouseOver = (event) => this.handleCellMouseOver(event);
    this.addEventListener("mouseover", this._onCellMouseOver);
    // Hide the VS Code webview context menu items over the table, ours replaces them
    this.setAttribute(
      "data-vscode-context",
      JSON.stringify({ preventDefaultContextMenuItems: true }),
    );
  }

  disconnectedCallback() {
    if (super.disconnectedCallback) {
      super.disconnectedCallback();
    }
    this.removeEventListener("contextmenu", this._onCellContextMenu);
    this.removeEventListener("mouseover", this._onCellMouseOver);
    this.closeCellContextMenu();
  }

  // Hover on a data cell: expose its full text as a native tooltip, so truncated
  // values can still be read. Header cells already carry their own title.
  handleCellMouseOver(event) {
    const cell = this.getHoveredCell(event);
    if (!cell) {
      return;
    }
    // Action menus have no readable value, and their assistive text is not one
    if (cell.querySelector("button")) {
      return;
    }
    const text = (cell.innerText || cell.textContent || "").trim();
    if (text === "") {
      if (cell.hasAttribute("title")) {
        cell.removeAttribute("title");
      }
      return;
    }
    if (cell.getAttribute("title") !== text) {
      cell.setAttribute("title", text);
    }
  }

  // The first TD/TH node found on the event path, else null
  findCellOnEventPath(event) {
    const path =
      event && typeof event.composedPath === "function"
        ? event.composedPath()
        : [];
    for (const node of path) {
      const tagName = node && node.tagName ? String(node.tagName) : "";
      if (tagName === "TD" || tagName === "TH") {
        return node;
      }
    }
    return null;
  }

  // The TD/TH of a body row found on the event path, else null
  getHoveredCell(event) {
    const cell = this.findCellOnEventPath(event);
    if (!cell) {
      return null;
    }
    const row = cell.parentElement;
    const section = row ? row.parentElement : null;
    if (section && String(section.tagName) === "THEAD") {
      return null;
    }
    return cell;
  }

  // Right click on a cell: propose to copy its value instead of the browser menu
  handleCellContextMenu(event) {
    const value = this.getContextMenuValue(event);
    if (!value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.openCellContextMenu(event.clientX, event.clientY, value);
  }

  // Selected text if there is one, else the whole text of the right-clicked cell
  getContextMenuValue(event) {
    const selection =
      typeof window !== "undefined" && window.getSelection
        ? String(window.getSelection())
        : "";
    if (selection && selection.trim() !== "") {
      return selection.trim();
    }
    const cell = this.findCellOnEventPath(event);
    if (!cell) {
      return "";
    }
    return (cell.innerText || cell.textContent || "").trim();
  }

  openCellContextMenu(x, y, value) {
    this.closeCellContextMenu();
    const host =
      this.template && this.template.host ? this.template.host : null;
    const container =
      (host && host.closest && host.closest(".slds-scope")) || document.body;
    const translations =
      (typeof window !== "undefined" && window.__lwcTranslations) || {};

    const menu = document.createElement("div");
    menu.className = "hardis-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "hardis-context-menu-item";
    item.textContent = translations.copyValue || "Copy value";
    item.addEventListener("click", () => {
      this.copyValueToClipboard(value);
      this.closeCellContextMenu();
    });
    menu.appendChild(item);
    container.appendChild(menu);
    this._cellContextMenu = menu;

    // Any next interaction closes the menu
    this._closeCellContextMenu = () => this.closeCellContextMenu();
    setTimeout(() => {
      document.addEventListener("click", this._closeCellContextMenu, {
        once: true,
      });
      document.addEventListener("contextmenu", this._closeCellContextMenu, {
        once: true,
      });
      document.addEventListener("keydown", this._closeCellContextMenu, {
        once: true,
      });
    }, 0);
  }

  closeCellContextMenu() {
    if (this._cellContextMenu && this._cellContextMenu.parentNode) {
      this._cellContextMenu.parentNode.removeChild(this._cellContextMenu);
    }
    this._cellContextMenu = null;
  }

  copyValueToClipboard(value) {
    if (typeof window !== "undefined" && window.sendMessageToVSCode) {
      window.sendMessageToVSCode({
        type: "copyToClipboard",
        data: { text: value },
      });
      return;
    }
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value);
    }
  }
}
