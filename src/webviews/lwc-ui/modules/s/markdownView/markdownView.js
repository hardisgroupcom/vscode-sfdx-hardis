import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";

// What a Pull Request comment written by sfdx-hardis uses: headings, lists, tables, code,
// collapsible sections, images and links. Nothing that runs, loads or submits.
const ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];
const ALLOWED_ATTR = ["href", "src", "alt", "title", "align", "open"];

/**
 * Markdown rendered as sanitized HTML.
 *
 * The text comes from a Pull Request comment, which anyone allowed to comment can write: it is
 * never trusted. marked turns it into HTML, DOMPurify keeps a short list of tags and attributes,
 * links and images are limited to web addresses, and a click on a link is handed to VS Code instead of
 * navigating the webview. Without the two libraries (a panel that does not load them), the text
 * is shown as it is.
 */
export default class MarkdownView extends SharedMixin(LightningElement) {
  _markdown = "";
  _rendered = null;

  @api
  get markdown() {
    return this._markdown;
  }
  set markdown(value) {
    this._markdown = typeof value === "string" ? value : "";
  }

  renderedCallback() {
    if (this._rendered === this._markdown) {
      return;
    }
    const container = this.template.querySelector(".hardis-markdown");
    if (!container) {
      return;
    }
    this._rendered = this._markdown;
    const html = this._toSafeHtml(this._markdown);
    if (html === null) {
      container.textContent = this._markdown;
      return;
    }
    container.innerHTML = html;
    for (const link of container.querySelectorAll("a")) {
      link.setAttribute("rel", "noopener noreferrer");
    }
  }

  handleClick(event) {
    const link = event.target?.closest ? event.target.closest("a") : null;
    if (!link) {
      return;
    }
    event.preventDefault();
    const url = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(url)) {
      window.sendMessageToVSCode({ type: "openExternal", data: { url } });
    }
  }

  _toSafeHtml(markdown) {
    const marked = window.marked;
    const purify = window.DOMPurify;
    if (!marked || typeof marked.parse !== "function" || !purify) {
      return null;
    }
    try {
      const rawHtml = marked.parse(markdown, { gfm: true, async: false });
      return purify.sanitize(rawHtml, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_URI_REGEXP: /^https?:\/\//i,
        ALLOW_DATA_ATTR: false,
      });
    } catch (e) {
      console.warn("Markdown not rendered:", e);
      return null;
    }
  }
}
