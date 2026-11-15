import { isTrustedCommentImage } from "s/pullRequestUtils";
import { countMatches } from "s/searchUtils";

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
const ALLOWED_ATTR = ["href", "alt", "title", "align", "open", "src", "width"];

// The texts of the last markdowns searched, so a key typed does not parse every comment again
const SEARCH_TEXTS_MAX = 50;
const searchTexts = new Map();
let inertDocument = null;

let imageHookInstalled = false;

/**
 * Markdown turned into HTML that only keeps a short list of tags and attributes, or null when
 * the panel did not load marked and DOMPurify (the text is then shown as it is).
 *
 * The text comes from a Pull Request comment, which anyone allowed to comment can write: it is
 * never trusted. Links are limited to web addresses, and images are replaced by their
 * alternative text so nothing is loaded from an address the author chose.
 * @param {string} markdown
 * @returns {string | null}
 */
export function markdownToSafeHtml(markdown) {
  const marked = window.marked;
  const purify = window.DOMPurify;
  if (!marked || typeof marked.parse !== "function" || !purify) {
    return null;
  }
  try {
    installImageHook(purify);
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

/**
 * The text nodes under an element, in the order they are read.
 * @param {Node} root
 * @returns {Text[]}
 */
export function textNodesOf(root) {
  const nodes = [];
  if (!root) {
    return nodes;
  }
  const owner = root.ownerDocument || document;
  const walker = owner.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

/**
 * The texts a rendered markdown shows, one per text node: what the search runs on. They are read
 * from the same HTML as the screen, so a tab never opened yet counts exactly the matches it will
 * highlight. The HTML is parsed in a document without a window: nothing it holds is loaded.
 * @param {string} markdown
 * @returns {string[]}
 */
export function markdownSearchTexts(markdown) {
  const source = typeof markdown === "string" ? markdown : "";
  if (searchTexts.has(source)) {
    return searchTexts.get(source);
  }
  const html = markdownToSafeHtml(source);
  if (html === null) {
    // Shown as it is: not kept, the libraries may still be loading
    return [source];
  }
  if (!inertDocument) {
    inertDocument = document.implementation.createHTMLDocument("");
  }
  const holder = inertDocument.createElement("div");
  holder.innerHTML = html;
  const texts = textNodesOf(holder).map((node) => node.nodeValue || "");
  if (searchTexts.size >= SEARCH_TEXTS_MAX) {
    searchTexts.delete(searchTexts.keys().next().value);
  }
  searchTexts.set(source, texts);
  return texts;
}

/**
 * How many times a query is found in what a markdown shows.
 * @param {string} markdown
 * @param {string} query an already normalized query (normalizeSearchQuery)
 */
export function countMarkdownMatches(markdown, query) {
  if (!query || !markdown) {
    return 0;
  }
  return countMatches(markdownSearchTexts(markdown), query);
}

// An image is replaced by its alternative text: the text comes from anyone allowed to comment,
// and loading an image from the address they chose would tell them who opened the tab, and when.
// The banners of sfdx-hardis and MegaLinter are kept: see isTrustedCommentImage.
function installImageHook(purify) {
  if (imageHookInstalled) {
    return;
  }
  imageHookInstalled = true;
  purify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "img" || !node.parentNode) {
      return;
    }
    if (node.getAttribute && isTrustedCommentImage(node.getAttribute("src"))) {
      return;
    }
    const alt = node.getAttribute ? node.getAttribute("alt") || "" : "";
    node.parentNode.replaceChild(node.ownerDocument.createTextNode(alt), node);
  });
}
