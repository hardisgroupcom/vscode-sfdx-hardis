import { LightningElement, api } from "lwc";
import { SharedMixin } from "s/sharedMixin";
import { markdownToSafeHtml, textNodesOf } from "s/markdownUtils";
import { findMatches, normalizeSearchQuery } from "s/searchUtils";

/**
 * Markdown rendered as sanitized HTML.
 *
 * The text comes from a Pull Request comment, which anyone allowed to comment can write: it is
 * never trusted. markdownToSafeHtml keeps a short list of tags and attributes, and a click on a
 * link is handed to VS Code instead of navigating the webview. Without marked and DOMPurify (a
 * panel that does not load them), the text is shown as it is.
 *
 * `searchQuery` highlights what matches it, and opens the collapsed sections holding a match;
 * `activeMatch` is the match shown as the current one, scrolled into view. A highlight only
 * splits the text nodes already there and wraps a piece in a <mark>: no markup is ever built
 * from the text of the comment.
 */
export default class MarkdownView extends SharedMixin(LightningElement) {
  _markdown = "";
  _rendered = null;
  _searchQuery = "";
  _activeMatch = -1;
  // What the screen shows now: the search applied, the current match and its <mark> elements
  _appliedQuery = "";
  _appliedActive = -1;
  _marks = [];
  // The collapsed sections the search opened, closed again when the search changes
  _openedBySearch = [];

  @api
  get markdown() {
    return this._markdown;
  }
  set markdown(value) {
    this._markdown = typeof value === "string" ? value : "";
    this._refresh();
  }

  @api
  get searchQuery() {
    return this._searchQuery;
  }
  set searchQuery(value) {
    this._searchQuery = normalizeSearchQuery(value);
    this._refresh();
  }

  @api
  get activeMatch() {
    return this._activeMatch;
  }
  set activeMatch(value) {
    this._activeMatch = Number.isInteger(value) ? value : -1;
    this._refresh();
  }

  renderedCallback() {
    this._refresh();
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

  // A property only changes the template when the template reads it: the content and the
  // highlights are put on the screen here, from the setters as well as after a render
  _refresh() {
    const container = this.template.querySelector(".hardis-markdown");
    if (!container) {
      return;
    }
    if (this._rendered !== this._markdown) {
      this._render(container);
    }
    if (this._appliedQuery !== this._searchQuery) {
      this._clearHighlights(container);
      this._marks = this._searchQuery
        ? this._highlight(container, this._searchQuery)
        : [];
      this._appliedQuery = this._searchQuery;
      this._appliedActive = -1;
    }
    if (this._appliedActive !== this._activeMatch) {
      this._showActiveMatch();
    }
  }

  _render(container) {
    this._rendered = this._markdown;
    // The new content holds no highlight and no section opened by the search
    this._marks = [];
    this._openedBySearch = [];
    this._appliedQuery = "";
    this._appliedActive = -1;
    const html = markdownToSafeHtml(this._markdown);
    if (html === null) {
      container.textContent = this._markdown;
      return;
    }
    container.innerHTML = html;
    for (const link of container.querySelectorAll("a")) {
      link.setAttribute("rel", "noopener noreferrer");
    }
  }

  // Wraps each match in a <mark>, and opens every collapsed section holding one
  _highlight(container, query) {
    const marks = [];
    for (const node of textNodesOf(container)) {
      const matches = findMatches(node.nodeValue || "", query);
      let rest = node;
      let offset = 0;
      for (const match of matches) {
        const hit = rest.splitText(match.start - offset);
        rest = hit.splitText(match.end - match.start);
        offset = match.end;
        const mark = document.createElement("mark");
        mark.className = "hardis-search-hit";
        hit.parentNode.replaceChild(mark, hit);
        mark.appendChild(hit);
        marks.push(mark);
      }
    }
    for (const mark of marks) {
      this._openSectionsAround(mark, container);
    }
    return marks;
  }

  _openSectionsAround(element, container) {
    let parent = element.parentElement;
    while (parent && parent !== container) {
      if (parent.tagName === "DETAILS" && !parent.open) {
        parent.open = true;
        this._openedBySearch.push(parent);
      }
      parent = parent.parentElement;
    }
  }

  _clearHighlights(container) {
    const marks = container.querySelectorAll("mark.hardis-search-hit");
    for (const mark of marks) {
      mark.replaceWith(...mark.childNodes);
    }
    if (marks.length > 0) {
      container.normalize();
    }
    for (const section of this._openedBySearch) {
      section.open = false;
    }
    this._openedBySearch = [];
    this._marks = [];
  }

  _showActiveMatch() {
    const previous = this._marks[this._appliedActive];
    if (previous) {
      previous.classList.remove("active");
    }
    this._appliedActive = this._activeMatch;
    const current = this._marks[this._activeMatch];
    if (current) {
      current.classList.add("active");
      current.scrollIntoView({ block: "center" });
    }
  }
}
