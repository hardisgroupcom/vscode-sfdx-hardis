import { inWorkbenchAndWebviews } from "./cdpWindow";

/**
 * Hides real values (org usernames, org ids, instance hosts, local paths) before a capture.
 *
 * The command screenshots of sfdx-hardis run real commands against real orgs, and what a command
 * prints carries the username of the org, its id, its address, the path of the project on the
 * machine. A documentation image must show none of them. Right before a capture, every text the
 * window can show is rewritten: the text nodes, the attributes a tooltip or a field reads from,
 * and the values of the fields, in the VS Code window and in every webview, through the shadow
 * roots. Then everything is read back, and a value still there is a leak: the capture must not be
 * saved.
 */

/** One value to hide, and what the image shows instead. */
export interface MaskRule {
  find: string;
  replace: string;
}

/** Where a value to hide was still found after masking. */
export interface MaskLeak {
  find: string;
  sample: string;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Runs in each page. `RULES` is replaced by the [regex source, replacement] pairs.
const MASK_SCRIPT = `
  const rules = RULES.map(([source, replacement]) => [new RegExp(source, "gi"), replacement]);
  const apply = (text) => {
    let out = text;
    for (const [pattern, replacement] of rules) {
      out = out.replace(pattern, replacement);
    }
    return out;
  };
  const ATTRIBUTES = ["title", "aria-label", "placeholder", "href", "alt", "data-tooltip", "value"];
  const texts = [];
  const visit = (root) => {
    const owner = root.ownerDocument || root;
    const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const masked = apply(node.nodeValue || "");
      if (masked !== node.nodeValue) {
        node.nodeValue = masked;
      }
      texts.push(node.nodeValue || "");
      node = walker.nextNode();
    }
    for (const element of root.querySelectorAll("*")) {
      for (const attribute of ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value) {
          const masked = apply(value);
          if (masked !== value) {
            element.setAttribute(attribute, masked);
          }
          texts.push(masked);
        }
      }
      if ("value" in element && typeof element.value === "string" && element.value) {
        const masked = apply(element.value);
        if (masked !== element.value) {
          element.value = masked;
        }
        texts.push(masked);
      }
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
    }
  };
  visit(document);
  if (panelDocument !== document) {
    visit(panelDocument);
  }
  if (document.title) {
    document.title = apply(document.title);
    texts.push(document.title);
  }
  const leaks = [];
  for (const [pattern] of rules) {
    for (const text of texts) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        leaks.push({ find: pattern.source, sample: text.slice(0, 160) });
        break;
      }
    }
  }
  return leaks;
`;

/**
 * Masks every rule in the window and in every webview, then returns what is still visible. An
 * empty list means the capture can be taken.
 */
export async function maskWindow(rules: MaskRule[]): Promise<MaskLeak[]> {
  const usable = rules.filter((rule) => rule.find && rule.find.length >= 3);
  if (usable.length === 0) {
    return [];
  }
  // Longest first: a username is masked before the domain it contains
  const pairs = [...usable]
    .sort((a, b) => b.find.length - a.find.length)
    .map((rule) => [escapeRegex(rule.find), rule.replace]);
  const script = MASK_SCRIPT.replace("RULES", JSON.stringify(pairs));
  const results = await inWorkbenchAndWebviews(script);
  const leaks: MaskLeak[] = [];
  for (const result of results) {
    if (Array.isArray(result)) {
      leaks.push(...result);
    }
  }
  return leaks;
}
