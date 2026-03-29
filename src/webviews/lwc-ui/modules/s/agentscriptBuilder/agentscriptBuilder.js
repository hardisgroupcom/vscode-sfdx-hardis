/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, api, track } from "lwc";
import { SharedMixin } from "s/sharedMixin";

export default class AgentscriptBuilder extends SharedMixin(LightningElement) {
  @track scriptContent = "";
  @track filePath = "";
  @track currentDiagram = "";
  lastDiagram = "";
  @track error = "";
  @track isLoading = true;
  @track activeView = "diagram"; // 'diagram' | 'source'

  // Topic modal
  @track showTopicModal = false;
  @track topicModalName = "";
  @track topicModalIsStartAgent = false;
  @track topicModalRawText = "";
  @track topicModalIsNew = false;
  @track topicModalMode = "form"; // 'form' | 'text'
  // Form fields
  @track topicFormLabel = "";
  @track topicFormDescription = "";
  @track topicFormInstructions = "";
  @track topicFormActionsRaw = "";
  _editingTopic = null; // { name, isStartAgent, blockStart, blockEnd, rawText, description, transitions }

  // Config modal
  @track showConfigModal = false;
  @track configModalMode = "form"; // 'form' | 'text'
  @track configModalRaw = "";
  @track systemModalRaw = "";
  @track variablesModalRaw = "";
  // Config form fields
  @track configFormDeveloperName = "";
  @track configFormAgentLabel = "";
  @track configFormDefaultAgentUser = "";
  @track configFormDescription = "";
  @track configFormAgentType = "AgentforceServiceAgent";
  @track configFormAgentRole = "";
  @track configFormCompany = "";
  @track configFormUserLocale = "";
  @track configFormEnhancedLogs = "False";
  // System form fields
  @track configFormSystemInstructions = "";
  @track configFormSystemWelcome = "";
  @track configFormSystemError = "";
  // Variables form fields: array of { id, name, mutability, type, source }
  @track variablesFormList = [];
  @track _editingVarId = null; // id of variable being edited inline
  @track varEditError = "";

  // Parsed data cache
  _parsedScript = null;

  // ─── API ─────────────────────────────────────────────────────────────────────

  @api
  initialize(data) {
    this.scriptContent = data?.scriptContent || "";
    this.filePath = data?.filePath || "";
    this.isLoading = false;
    if (this.scriptContent) {
      this._refreshDiagram();
    }
  }

  @api
  handleMessage(type, data) {
    if (type === "scriptContentUpdated") {
      this.scriptContent = data?.scriptContent || "";
      this._refreshDiagram();
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  renderedCallback() {
    if (
      this.activeView === "diagram" &&
      this.currentDiagram &&
      this.currentDiagram !== this.lastDiagram
    ) {
      this.renderMermaid();
    }
  }

  // ─── Diagram ─────────────────────────────────────────────────────────────────

  _refreshDiagram() {
    this._parsedScript = this._parseScript(this.scriptContent);
    this.currentDiagram = this._generateMermaid(this._parsedScript);
    setTimeout(() => this.renderMermaid(), 50);
  }

  renderMermaid() {
    const mermaidDiv = this.template.querySelector(".mermaid");
    if (!mermaidDiv) {
      return;
    }
    if (!window.mermaid) {
      this.error = "Mermaid library is not loaded.";
      return;
    }
    const diagram = (this.currentDiagram || "").trim();
    if (!diagram) {
      return;
    }
    this.lastDiagram = diagram;
    mermaidDiv.innerHTML = "";

    window.mermaid
      .render("agentScriptGraphDiv_" + Date.now(), diagram)
      .then(({ svg }) => {
        mermaidDiv.innerHTML = svg;
        this.error = "";

        const mermaidSvg = this.template.querySelector(".mermaid svg");
        if (mermaidSvg) {
          mermaidSvg.querySelectorAll("g.node").forEach((node) => {
            node.style.cursor = "pointer";
          });
          mermaidSvg.addEventListener("click", (event) => {
            const mermaidNode = event.target.closest("g.node");
            if (!mermaidNode) {
              return;
            }
            const rawId = mermaidNode.getAttribute("id") || "";
            const nodeId = rawId
              .replace(/^flowchart-/, "")
              .replace(/-\d+$/, "");
            if (nodeId) {
              this._openTopicModal(nodeId);
            }
          });
        }
      })
      .catch((err) => {
        this.error = err?.message || "Mermaid rendering error";
        mermaidDiv.innerHTML = "";
      });
  }

  // ─── Parser ───────────────────────────────────────────────────────────────────

  _parseScript(text) {
    const EMPTY = {
      topics: [],
      configBlock: null,
      systemBlock: null,
      variablesBlock: null,
      languageBlock: null,
    };
    if (!text) {
      return EMPTY;
    }

    const lines = text.split("\n");
    const result = { ...EMPTY, topics: [] };

    const collectBlock = (startIdx) => {
      let i = startIdx + 1;
      while (i < lines.length) {
        const nl = lines[i];
        // New top-level block ends this one (non-empty, not indented, not a comment)
        if (
          nl.length > 0 &&
          nl[0] !== " " &&
          nl[0] !== "\t" &&
          !nl.trimStart().startsWith("#")
        ) {
          break;
        }
        i++;
      }
      return { blockStart: startIdx, blockEnd: i - 1, rawText: lines.slice(startIdx, i).join("\n") };
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // Only process top-level lines (no leading whitespace)
      if (line[0] === " " || line[0] === "\t") {
        i++;
        continue;
      }
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith("#")) {
        i++;
        continue;
      }

      const topicMatch = trimmed.match(/^topic\s+(\w+)\s*:/);
      const startAgentMatch = trimmed.match(/^start_agent\s+(\w+)\s*:/);

      if (topicMatch || startAgentMatch) {
        const name = (topicMatch || startAgentMatch)[1];
        const isStartAgent = !!startAgentMatch;
        const block = collectBlock(i);
        i = block.blockEnd + 1;

        const blockLines = block.rawText.split("\n");
        let description = "";
        let label = "";
        for (const bLine of blockLines) {
          if (!label) {
            const labelMatch = bLine.match(/^\s+label\s*:\s*(.+?)\s*$/);
            if (labelMatch) {
              label = labelMatch[1].replace(/^["']|["']$/g, "").trim();
            }
          }
          if (!description) {
            const descMatch = bLine.match(/^\s+description\s*:\s*(.+?)\s*$/);
            if (descMatch) {
              description = descMatch[1].replace(/^["']|["']$/g, "").trim();
            }
          }
          if (label && description) { break; }
        }

        const transitions = [];
        for (const bLine of blockLines) {
          // @utils.transition to @topic.X
          const utilsTransMatch = bLine.match(
            /@utils\.transition\s+to\s+@topic\.(\w+)/,
          );
          if (utilsTransMatch) {
            const actionNameMatch = bLine.match(/^\s+(\w+)\s*:/);
            transitions.push({
              target: utilsTransMatch[1],
              label: actionNameMatch ? actionNameMatch[1] : "",
              type: "transition",
            });
          }
          // delegation: someLabel: @topic.X (not a transition)
          const delegMatch = bLine.match(/^\s+(\w+)\s*:\s*@topic\.(\w+)/);
          if (delegMatch && !bLine.includes("@utils.transition")) {
            transitions.push({
              target: delegMatch[2],
              label: delegMatch[1],
              type: "delegation",
            });
          }
        }

        result.topics.push({
          name,
          isStartAgent,
          blockStart: block.blockStart,
          blockEnd: block.blockEnd,
          rawText: block.rawText,
          label,
          description,
          transitions,
        });
      } else if (trimmed.match(/^config\s*:/)) {
        const block = collectBlock(i);
        result.configBlock = block;
        i = block.blockEnd + 1;
      } else if (trimmed.match(/^system\s*:/)) {
        const block = collectBlock(i);
        result.systemBlock = block;
        i = block.blockEnd + 1;
      } else if (trimmed.match(/^variables\s*:/)) {
        const block = collectBlock(i);
        result.variablesBlock = block;
        i = block.blockEnd + 1;
      } else if (trimmed.match(/^language\s*:/)) {
        const block = collectBlock(i);
        result.languageBlock = block;
        i = block.blockEnd + 1;
      } else {
        i++;
      }
    }

    return result;
  }

  // ─── Mermaid Generator ────────────────────────────────────────────────────────

  _generateMermaid(parsed) {
    if (!parsed || parsed.topics.length === 0) {
      return "";
    }

    const lines = ["flowchart TD"];

    // Nodes
    for (const topic of parsed.topics) {
      const displayName = (topic.label || topic.name).replace(/_/g, " ");
      const rawDesc = topic.description || "";
      const shortDesc =
        rawDesc.length > 45 ? rawDesc.substring(0, 42) + "..." : rawDesc;
      const safeDesc = shortDesc.replace(/"/g, "'");
      const nodeLabel = safeDesc ? `${displayName}<br/>${safeDesc}` : displayName;
      if (topic.isStartAgent) {
        lines.push(`  ${topic.name}(["🚀 ${nodeLabel}"])`);
      } else {
        lines.push(`  ${topic.name}["📋 ${nodeLabel}"]`);
      }
    }

    lines.push("");

    // Edges
    const knownNames = new Set(parsed.topics.map((t) => t.name));
    for (const topic of parsed.topics) {
      for (const trans of topic.transitions) {
        if (!knownNames.has(trans.target)) {
          continue;
        }
        const edgeLabel = (trans.label || "").replace(/_/g, " ");
        if (trans.type === "transition") {
          lines.push(
            `  ${topic.name} --> |"${edgeLabel}"| ${trans.target}`,
          );
        } else {
          lines.push(
            `  ${topic.name} -.-> |"${edgeLabel}"| ${trans.target}`,
          );
        }
      }
    }

    // Styling
    lines.push("");
    lines.push(
      "  classDef startNode fill:#4CAF50,color:#fff,stroke:#388E3C,rx:10",
    );
    lines.push(
      "  classDef topicNode fill:#1565C0,color:#fff,stroke:#0D47A1",
    );

    const startNames = parsed.topics
      .filter((t) => t.isStartAgent)
      .map((t) => t.name);
    const topicNames = parsed.topics
      .filter((t) => !t.isStartAgent)
      .map((t) => t.name);

    if (startNames.length > 0) {
      lines.push(`  class ${startNames.join(",")} startNode`);
    }
    if (topicNames.length > 0) {
      lines.push(`  class ${topicNames.join(",")} topicNode`);
    }

    return lines.join("\n");
  }

  // ─── Topic Modal ──────────────────────────────────────────────────────────────

  // ─── Topic form helpers ───────────────────────────────────────────────────────

  _parseTopicForForm(rawText) {
    const lines = rawText.split("\n");
    let label = "";
    let description = "";
    let instructionsLines = [];
    let actionsLines = [];

    // States: idle | instructions | actions
    let state = "idle";
    for (const line of lines) {
      // top-level topic fields (indented by exactly 4 spaces, not deeper)
      if (!label) {
        const m = line.match(/^    label\s*:\s*(.+?)\s*$/);
        if (m) { label = m[1].replace(/^["']|["']$/g, "").trim(); }
      }
      if (!description) {
        const m = line.match(/^    description\s*:\s*(.+?)\s*$/);
        if (m) { description = m[1].replace(/^["']|["']$/g, "").trim(); }
      }
      // reasoning.instructions block (8-space indented)
      if (line.match(/^        instructions\s*:/)) {
        state = "instructions";
        continue;
      }
      // reasoning.actions block (8-space indented)
      if (line.match(/^        actions\s*:/)) {
        state = "actions";
        continue;
      }
      // another reasoning sub-block or shallower block ends current state
      if (state !== "idle" && line.match(/^        \w/) && !line.match(/^          /)) {
        state = "idle";
      }
      if (state === "instructions") { instructionsLines.push(line); }
      if (state === "actions") { actionsLines.push(line); }
    }

    // Strip common leading whitespace from instructions (10 spaces = indent under instructions: ->)
    const trimInstructions = (lns) => {
      // find minimum indentation of non-empty lines
      const nonEmpty = lns.filter((l) => l.trim().length > 0);
      if (nonEmpty.length === 0) { return ""; }
      const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^( *)/)[1].length));
      return lns.map((l) => l.slice(minIndent)).join("\n").trim();
    };

    return {
      label,
      description,
      instructions: trimInstructions(instructionsLines),
      actionsRaw: actionsLines.join("\n").trimEnd(),
    };
  }

  _buildRawTextFromForm() {
    const prefix = this.topicModalIsStartAgent ? "start_agent" : "topic";
    const name = this.topicModalName || "new_topic";
    const label = (this.topicFormLabel || "").trim();
    const description = (this.topicFormDescription || "").trim();
    const instructions = (this.topicFormInstructions || "").trim();
    const actionsRaw = (this.topicFormActionsRaw || "").trimEnd();

    const lines = [`${prefix} ${name}:`];
    if (label) { lines.push(`    label: "${label}"`); }
    if (description) { lines.push(`    description: "${description}"`); }
    lines.push("");
    lines.push("    reasoning:");

    if (instructions || actionsRaw) {
      if (instructions) {
        lines.push("        instructions: ->");
        // indent each line of instructions by 12 spaces
        for (const l of instructions.split("\n")) {
          lines.push("            " + l);
        }
      }
      if (actionsRaw) {
        lines.push("        actions:");
        for (const l of actionsRaw.split("\n")) {
          lines.push(l); // already indented
        }
      }
    } else {
      lines.push("        instructions: ->");
      lines.push("            | Help the user with their request.");
    }

    return lines.join("\n") + "\n";
  }

  _populateFormFromRaw(rawText) {
    const parsed = this._parseTopicForForm(rawText);
    this.topicFormLabel = parsed.label;
    this.topicFormDescription = parsed.description;
    this.topicFormInstructions = parsed.instructions;
    this.topicFormActionsRaw = parsed.actionsRaw;
  }

  _openTopicModal(topicName) {
    const parsed =
      this._parsedScript || this._parseScript(this.scriptContent);
    const topic = parsed.topics.find((t) => t.name === topicName);
    if (!topic) {
      return;
    }
    this._editingTopic = topic;
    this.topicModalName = topic.name;
    this.topicModalIsStartAgent = topic.isStartAgent;
    this.topicModalRawText = topic.rawText;
    this.topicModalMode = "form";
    this._populateFormFromRaw(topic.rawText);
    this.topicModalIsNew = false;
    this.showTopicModal = true;
  }

  handleAddNewTopic() {
    this._editingTopic = null;
    this.topicModalName = "new_topic";
    this.topicModalIsStartAgent = false;
    const defaultRaw = 'topic new_topic:\n    label: "New Topic"\n    description: "Describe what this topic handles."\n\n    reasoning:\n        instructions: ->\n            | Help the user with their request.\n';
    this.topicModalRawText = defaultRaw;
    this.topicModalMode = "form";
    this._populateFormFromRaw(defaultRaw);
    this.topicModalIsNew = true;
    this.showTopicModal = true;
  }

  handleTopicRawTextChange(event) {
    this.topicModalRawText = event.target.value;
  }

  handleTopicFormLabelChange(event) {
    this.topicFormLabel = event.target.value;
  }

  handleTopicFormDescriptionChange(event) {
    this.topicFormDescription = event.target.value;
  }

  handleTopicFormInstructionsChange(event) {
    this.topicFormInstructions = event.target.value;
  }

  handleTopicFormActionsChange(event) {
    this.topicFormActionsRaw = event.target.value;
  }

  handleSwitchToFormMode() {
    // Sync form fields from current raw text before switching
    this._populateFormFromRaw(this.topicModalRawText);
    this.topicModalMode = "form";
  }

  handleSwitchToTextMode() {
    // Sync raw text from form fields before switching
    this.topicModalRawText = this._buildRawTextFromForm();
    this.topicModalMode = "text";
  }

  handleCloseTopic() {
    this.showTopicModal = false;
    this._editingTopic = null;
  }

  handleSaveTopic() {
    // Build raw text from whichever mode is active
    const rawText = this.topicModalMode === "form"
      ? this._buildRawTextFromForm().trimEnd()
      : (this.topicModalRawText || "").trimEnd();
    if (!rawText) {
      return;
    }

    if (this.topicModalIsNew) {
      this.scriptContent =
        (this.scriptContent || "").trimEnd() + "\n\n" + rawText + "\n";
    } else {
      const topic = this._editingTopic;
      if (!topic) {
        return;
      }
      const lines = this.scriptContent.split("\n");
      const newLines = [
        ...lines.slice(0, topic.blockStart),
        ...rawText.split("\n"),
        ...lines.slice(topic.blockEnd + 1),
      ];
      this.scriptContent = newLines.join("\n");
    }

    this.showTopicModal = false;
    this._editingTopic = null;
    this._refreshDiagram();
    this._saveScript();
  }

  handleDeleteTopic() {
    const topic = this._editingTopic;
    if (!topic) {
      return;
    }
    const lines = this.scriptContent.split("\n");
    const newLines = [
      ...lines.slice(0, topic.blockStart),
      ...lines.slice(topic.blockEnd + 1),
    ];
    this.scriptContent = newLines.join("\n");
    this.showTopicModal = false;
    this._editingTopic = null;
    this._refreshDiagram();
    this._saveScript();
  }

  // ─── Config Modal ─────────────────────────────────────────────────────────────

  handleOpenConfigModal() {
    const parsed =
      this._parsedScript || this._parseScript(this.scriptContent);
    this.configModalRaw =
      parsed.configBlock?.rawText ||
      'config:\n    developer_name: "my_agent"\n    agent_label: "My Agent"\n    description: "My Agent description"\n';
    this.systemModalRaw =
      parsed.systemBlock?.rawText ||
      'system:\n    instructions: "You are a helpful assistant."\n    messages:\n        welcome: "Hello! How can I help you?"\n        error: "Sorry, something went wrong."\n';
    this.variablesModalRaw =
      parsed.variablesBlock?.rawText || "variables:\n    # Add global variables here\n    # Example: my_var: mutable string\n    #          linked_var: linked string\n    #              source: @MessagingSession.Id\n";
    this.configModalMode = "form";
    this._populateConfigFormFromRaw(this.configModalRaw);
    this._populateSystemFormFromRaw(this.systemModalRaw);
    this._populateVariablesFormFromRaw(this.variablesModalRaw);
    this.showConfigModal = true;
  }

  _parseConfigBlockForForm(raw) {
    const result = { developerName: "", agentLabel: "", defaultAgentUser: "", description: "", agentType: "", agentRole: "", company: "", userLocale: "", enhancedLogs: "" };
    if (!raw) {
      return result;
    }
    for (const line of raw.split("\n")) {
      const m = line.match(/^ {4}([\w]+):\s+(.*)/);
      if (!m) {
        continue;
      }
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "developer_name") {
        result.developerName = val;
      }
      else if (key === "agent_label") {
        result.agentLabel = val;
      }
      else if (key === "default_agent_user") {
        result.defaultAgentUser = val;
      }
      else if (key === "description") {
        result.description = val;
      }
      else if (key === "agent_type") {
        result.agentType = val;
      }
      else if (key === "role") {
        result.agentRole = val;
      }
      else if (key === "company") {
        result.company = val;
      }
      else if (key === "user_locale") {
        result.userLocale = val;
      }
      else if (key === "enable_enhanced_event_logs") {
        result.enhancedLogs = val;
      }
    }
    return result;
  }

  _buildConfigRawFromForm() {
    const lines = ["config:"];
    if (this.configFormDeveloperName) {
      lines.push(`    developer_name: "${this.configFormDeveloperName}"`);
    }
    if (this.configFormAgentLabel) {
      lines.push(`    agent_label: "${this.configFormAgentLabel}"`);
    }
    if (this.configFormDefaultAgentUser) {
      lines.push(`    default_agent_user: "${this.configFormDefaultAgentUser}"`);
    }
    if (this.configFormAgentType) {
      lines.push(`    agent_type: ${this.configFormAgentType}`);
    }
    if (this.configFormCompany) {
      lines.push(`    company: "${this.configFormCompany}"`);
    }
    if (this.configFormUserLocale) {
      lines.push(`    user_locale: "${this.configFormUserLocale}"`);
    }
    if (this.configFormEnhancedLogs && this.configFormEnhancedLogs !== "False") {
      lines.push(`    enable_enhanced_event_logs: ${this.configFormEnhancedLogs}`);
    }
    if (this.configFormDescription) {
      lines.push(`    description: "${this.configFormDescription}"`);
    }
    if (this.configFormAgentRole) {
      lines.push(`    role: "${this.configFormAgentRole}"`);
    }
    return lines.join("\n") + "\n";
  }

  _populateConfigFormFromRaw(raw) {
    const parsed = this._parseConfigBlockForForm(raw);
    this.configFormDeveloperName = parsed.developerName;
    this.configFormAgentLabel = parsed.agentLabel;
    this.configFormDefaultAgentUser = parsed.defaultAgentUser;
    this.configFormDescription = parsed.description;
    this.configFormAgentType = parsed.agentType || "AgentforceServiceAgent";
    this.configFormAgentRole = parsed.agentRole;
    this.configFormCompany = parsed.company;
    this.configFormUserLocale = parsed.userLocale;
    this.configFormEnhancedLogs = parsed.enhancedLogs || "False";
  }

  _parseSystemBlockForForm(raw) {
    const result = { instructions: "", welcome: "", error: "" };
    if (!raw) {
      return result;
    }
    const lines = raw.split("\n");
    let inMessages = false;
    let inInstructions = false;
    const instrLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^ {4}instructions:\s*->\s*$/.test(line)) {
        inInstructions = true;
        inMessages = false;
        continue;
      }
      if (/^ {4}instructions:\s+\S/.test(line)) {
        const mm = line.match(/^ {4}instructions:\s+(.*)/);
        if (mm) {
          result.instructions = mm[1].replace(/^["']|["']$/g, "");
        }
        continue;
      }
      if (/^ {4}messages:/.test(line)) {
        if (inInstructions && instrLines.length > 0) {
          result.instructions = instrLines.join("\n");
          inInstructions = false;
        }
        inMessages = true;
        continue;
      }
      if (inInstructions) {
        if (/^ {8}/.test(line)) {
          instrLines.push(line.replace(/^ {8}/, ""));
          continue;
        }
        else if (line.trim() !== "") {
          result.instructions = instrLines.join("\n");
          inInstructions = false;
        }
      }
      if (inMessages) {
        const wm = line.match(/^ {8}welcome:\s+(.*)/);
        if (wm) {
          result.welcome = wm[1].replace(/^["']|["']$/g, "");
          continue;
        }
        const em = line.match(/^ {8}error:\s+(.*)/);
        if (em) {
          result.error = em[1].replace(/^["']|["']$/g, "");
          continue;
        }
      }
    }
    if (inInstructions && instrLines.length > 0) {
      result.instructions = instrLines.join("\n");
    }
    return result;
  }

  _buildSystemRawFromForm() {
    const lines = ["system:"];
    if (this.configFormSystemInstructions) {
      const instrLines = this.configFormSystemInstructions.split("\n");
      if (instrLines.length > 1) {
        lines.push("    instructions: ->");
        for (const il of instrLines) {
          const trimmed = il.trimStart();
          lines.push(`        ${trimmed.startsWith("| ") ? trimmed : "| " + trimmed}`);
        }
      }
      else {
        lines.push(`    instructions: "${this.configFormSystemInstructions}"`);
      }
    }
    lines.push("    messages:");
    if (this.configFormSystemWelcome) {
      lines.push(`        welcome: "${this.configFormSystemWelcome}"`);
    }
    if (this.configFormSystemError) {
      lines.push(`        error: "${this.configFormSystemError}"`);
    }
    return lines.join("\n") + "\n";
  }

  _populateSystemFormFromRaw(raw) {
    const parsed = this._parseSystemBlockForForm(raw);
    this.configFormSystemInstructions = parsed.instructions;
    this.configFormSystemWelcome = parsed.welcome;
    this.configFormSystemError = parsed.error;
  }

  _parseVariablesBlockForForm(raw) {
    const result = [];
    if (!raw) {
      return result;
    }
    const lines = raw.split("\n");
    let currentVar = null;
    for (const line of lines) {
      if (line.trim() === "" || line.trim().startsWith("#") || line.trim() === "variables:") {
        continue;
      }
      // name: mutable|linked type [= value]
      const kwMatch = line.match(/^ {4}([\w]+):\s+(mutable|linked)\s+([\w\[\]]+)(?:\s*=\s*(.+))?$/);
      if (kwMatch) {
        if (currentVar) {
          result.push(currentVar);
        }
        currentVar = {
          id: kwMatch[1] + "_" + result.length,
          name: kwMatch[1],
          mutability: kwMatch[2],
          type: kwMatch[3],
          source: "",
          defaultValue: kwMatch[4] ? kwMatch[4].trim().replace(/^["']|["']$/g, "") : "",
        };
        continue;
      }
      // name: type [= value] (immutable — no mutability keyword)
      const immutableMatch = line.match(/^ {4}([\w]+):\s+([\w\[\]]+)(?:\s*=\s*(.+))?$/);
      if (immutableMatch) {
        if (currentVar) {
          result.push(currentVar);
        }
        currentVar = {
          id: immutableMatch[1] + "_" + result.length,
          name: immutableMatch[1],
          mutability: "immutable",
          type: immutableMatch[2],
          source: "",
          defaultValue: immutableMatch[3] ? immutableMatch[3].trim().replace(/^["']|["']$/g, "") : "",
        };
        continue;
      }
      // source sub-key: "        source: ..."
      const sourceMatch = line.match(/^ {8}source:\s+(.*)/);
      if (sourceMatch && currentVar) {
        currentVar.source = sourceMatch[1].trim();
      }
    }
    if (currentVar) {
      result.push(currentVar);
    }
    return result;
  }

  _buildVariablesRawFromForm() {
    const lines = ["variables:"];
    for (const v of this.variablesFormList) {
      if (!v.name) {
        continue;
      }
      const defaultStr = v.defaultValue ? ` = ${v.defaultValue}` : "";
      if (v.mutability === "immutable") {
        lines.push(`    ${v.name}: ${v.type || "string"}${defaultStr}`);
      }
      else {
        lines.push(`    ${v.name}: ${v.mutability || "mutable"} ${v.type || "string"}${defaultStr}`);
      }
      if (v.source && v.mutability === "linked") {
        lines.push(`        source: ${v.source}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  _populateVariablesFormFromRaw(raw) {
    this.variablesFormList = this._parseVariablesBlockForForm(raw);
  }

  handleAddVariable() {
    this.varEditError = "";
    const newVar = {
      id: "new_" + Date.now(),
      name: "",
      mutability: "mutable",
      type: "string",
      source: "",
      defaultValue: "",
    };
    this.variablesFormList = [...this.variablesFormList, newVar];
    this._editingVarId = newVar.id;
  }

  handleEditVariable(event) {
    this.varEditError = "";
    this._editingVarId = event.currentTarget.dataset.varId;
    this.variablesFormList = [...this.variablesFormList];
  }

  handleDeleteVariable(event) {
    const id = event.currentTarget.dataset.varId;
    this.variablesFormList = this.variablesFormList.filter((v) => v.id !== id);
    if (this._editingVarId === id) {
      this._editingVarId = null;
    }
  }

  handleVarFieldChange(event) {
    const id = event.currentTarget.dataset.varId;
    const field = event.currentTarget.dataset.field;
    const value = event.detail?.value ?? event.target.value;
    this.variablesFormList = this.variablesFormList.map((v) => {
      if (v.id === id) {
        return { ...v, [field]: value };
      }
      return v;
    });
  }

  handleVarEditDone(event) {
    const id = event.currentTarget.dataset.varId;
    if (this._editingVarId !== id) {
      return;
    }
    const variable = this.variablesFormList.find((v) => v.id === id);
    if (!variable || !variable.name || !variable.mutability || !variable.type) {
      this.varEditError = this.t("deploymentActionMissingRequiredFields");
      return;
    }
    this.varEditError = "";
    this._editingVarId = null;
    this.variablesFormList = [...this.variablesFormList];
  }

  handleConfigRawChange(event) {
    this.configModalRaw = event.target.value;
  }

  handleSystemRawChange(event) {
    this.systemModalRaw = event.target.value;
  }

  handleVariablesRawChange(event) {
    this.variablesModalRaw = event.target.value;
  }

  handleConfigSwitchToFormMode() {
    this._populateConfigFormFromRaw(this.configModalRaw);
    this._populateSystemFormFromRaw(this.systemModalRaw);
    this._populateVariablesFormFromRaw(this.variablesModalRaw);
    this.configModalMode = "form";
  }

  handleConfigSwitchToTextMode() {
    this.configModalRaw = this._buildConfigRawFromForm();
    this.systemModalRaw = this._buildSystemRawFromForm();
    this.variablesModalRaw = this._buildVariablesRawFromForm();
    this.configModalMode = "text";
  }

  handleConfigModeToggle(event) {
    if (event.target.checked) {
      this.handleConfigSwitchToTextMode();
    }
    else {
      this.handleConfigSwitchToFormMode();
    }
  }

  handleConfigFormDeveloperNameChange(event) {
    this.configFormDeveloperName = event.target.value;
  }

  handleConfigFormAgentLabelChange(event) {
    this.configFormAgentLabel = event.target.value;
  }

  handleConfigFormDefaultAgentUserChange(event) {
    this.configFormDefaultAgentUser = event.target.value;
  }

  handleConfigFormDescriptionChange(event) {
    this.configFormDescription = event.target.value;
  }

  handleConfigFormAgentTypeChange(event) {
    this.configFormAgentType = event.detail?.value ?? event.target.value;
  }

  handleConfigFormAgentRoleChange(event) {
    this.configFormAgentRole = event.target.value;
  }

  handleConfigFormCompanyChange(event) {
    this.configFormCompany = event.target.value;
  }

  handleConfigFormUserLocaleChange(event) {
    this.configFormUserLocale = event.target.value;
  }

  handleConfigFormEnhancedLogsChange(event) {
    this.configFormEnhancedLogs = event.detail?.value ?? event.target.value;
  }

  handleConfigFormSystemInstructionsChange(event) {
    this.configFormSystemInstructions = event.target.value;
  }

  handleConfigFormSystemWelcomeChange(event) {
    this.configFormSystemWelcome = event.target.value;
  }

  handleConfigFormSystemErrorChange(event) {
    this.configFormSystemError = event.target.value;
  }

  handleCloseConfigModal() {
    this.showConfigModal = false;
  }

  handleSaveConfig() {
    // Build raw from form fields when in form mode
    if (this.configModalMode === "form") {
      this.configModalRaw = this._buildConfigRawFromForm();
      this.systemModalRaw = this._buildSystemRawFromForm();
      this.variablesModalRaw = this._buildVariablesRawFromForm();
    }

    const parsed =
      this._parsedScript || this._parseScript(this.scriptContent);

    // Collect existing blocks sorted descending (replace bottom-up to preserve line numbers)
    const blocksToReplace = [
      { block: parsed.variablesBlock, newRaw: this.variablesModalRaw },
      { block: parsed.systemBlock, newRaw: this.systemModalRaw },
      { block: parsed.configBlock, newRaw: this.configModalRaw },
    ].filter((b) => b.block !== null);
    blocksToReplace.sort((a, b) => b.block.blockStart - a.block.blockStart);

    let lines = this.scriptContent.split("\n");
    for (const { block, newRaw } of blocksToReplace) {
      const newBlockLines = (newRaw || "").trimEnd().split("\n");
      lines = [
        ...lines.slice(0, block.blockStart),
        ...newBlockLines,
        ...lines.slice(block.blockEnd + 1),
      ];
    }

    if (blocksToReplace.length === 0) {
      // Prepend new blocks to script
      const prefix = [
        this.configModalRaw,
        this.systemModalRaw,
        this.variablesModalRaw,
      ]
        .filter((r) => r && r.trim())
        .join("\n\n");
      this.scriptContent = prefix.trimEnd() + "\n\n" + (this.scriptContent || "");
    } else {
      this.scriptContent = lines.join("\n");
    }

    this.showConfigModal = false;
    this._refreshDiagram();
    this._saveScript();
  }

  // ─── Raw Source View ──────────────────────────────────────────────────────────

  handleScriptContentChange(event) {
    this.scriptContent = event.target.value;
  }

  handleApplyRawScript() {
    this._refreshDiagram();
    this._saveScript();
  }

  handleSwitchToDiagram() {
    this.activeView = "diagram";
    setTimeout(() => this.renderMermaid(), 50);
  }

  handleSwitchToSource() {
    this.activeView = "source";
  }

  // ─── Save ─────────────────────────────────────────────────────────────────────

  _saveScript() {
    window.sendMessageToVSCode({
      type: "saveAgentScript",
      data: {
        scriptContent: this.scriptContent,
        filePath: this.filePath,
      },
    });
  }

  // ─── Docs ─────────────────────────────────────────────────────────────────────

  handleOpenDocs() {
    window.sendMessageToVSCode({
      type: "openExternal",
      data: "https://developer.salesforce.com/docs/ai/agentforce/guide/agent-script.html",
    });
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  get agentTitle() {
    const parsed = this._parsedScript;
    if (parsed && parsed.configBlock) {
      const labelMatch = parsed.configBlock.rawText.match(
        /agent_label\s*:\s*(.+?)\s*$/m,
      );
      if (labelMatch) {
        return labelMatch[1].replace(/^["']|["']$/g, "").trim();
      }
      const nameMatch = parsed.configBlock.rawText.match(
        /developer_name\s*:\s*(.+?)\s*$/m,
      );
      if (nameMatch) {
        return nameMatch[1].replace(/^["']|["']$/g, "").trim();
      }
    }
    if (this.filePath) {
      const parts = this.filePath.replace(/\\/g, "/").split("/");
      const fileName = parts[parts.length - 1] || "";
      // Strip .agent extension for display
      return fileName.replace(/\.agent$/, "") || this.i18n.agentscriptBuilderTitle;
    }
    return this.i18n.agentscriptBuilderTitle;
  }

  get hasScript() {
    return !!(this.scriptContent && this.scriptContent.trim());
  }

  get isDiagramView() {
    return this.activeView === "diagram";
  }

  get isSourceView() {
    return this.activeView === "source";
  }

  get diagramTabClass() {
    return this.activeView === "diagram"
      ? "slds-tabs_default__link slds-is-active"
      : "slds-tabs_default__link";
  }

  get sourceTabClass() {
    return this.activeView === "source"
      ? "slds-tabs_default__link slds-is-active"
      : "slds-tabs_default__link";
  }

  get isTopicFormMode() {
    return this.topicModalMode === "form";
  }

  get isTopicTextMode() {
    return this.topicModalMode === "text";
  }

  get topicFormButtonVariant() {
    return this.topicModalMode === "form" ? "brand" : "neutral";
  }

  get topicTextButtonVariant() {
    return this.topicModalMode === "text" ? "brand" : "neutral";
  }

  get topicFormTabClass() {
    return this.topicModalMode === "form"
      ? "slds-tabs_default__link slds-is-active"
      : "slds-tabs_default__link";
  }

  get topicTextTabClass() {
    return this.topicModalMode === "text"
      ? "slds-tabs_default__link slds-is-active"
      : "slds-tabs_default__link";
  }

  get agentTypeOptions() {
    return [
      { label: "AgentforceServiceAgent", value: "AgentforceServiceAgent" },
      { label: "AgentforceEmployeeAgent", value: "AgentforceEmployeeAgent" },
    ];
  }

  get enableEnhancedLogsOptions() {
    return [
      { label: "False", value: "False" },
      { label: "True", value: "True" },
    ];
  }

  get isConfigFormMode() {
    return this.configModalMode === "form";
  }

  get isConfigTextMode() {
    return this.configModalMode === "text";
  }

  get configFormButtonVariant() {
    return this.configModalMode === "form" ? "brand" : "neutral";
  }

  get configTextButtonVariant() {
    return this.configModalMode === "text" ? "brand" : "neutral";
  }

  get variablesFormListWithState() {
    const allTypes = [
      { label: "string", value: "string" },
      { label: "number", value: "number" },
      { label: "boolean", value: "boolean" },
      { label: "object", value: "object" },
      { label: "date", value: "date" },
      { label: "id", value: "id" },
      { label: "list[string]", value: "list[string]" },
      { label: "list[number]", value: "list[number]" },
      { label: "list[boolean]", value: "list[boolean]" },
      { label: "list[date]", value: "list[date]" },
      { label: "list[id]", value: "list[id]" },
    ];
    const linkedTypes = [
      { label: "string", value: "string" },
      { label: "number", value: "number" },
      { label: "boolean", value: "boolean" },
      { label: "date", value: "date" },
      { label: "id", value: "id" },
    ];
    const mutabilityOpts = [
      { label: "mutable", value: "mutable" },
      { label: "linked", value: "linked" },
      { label: "immutable", value: "immutable" },
    ];
    return this.variablesFormList.map((v) => ({
      ...v,
      isEditing: v.id === this._editingVarId,
      isLinked: v.mutability === "linked",
      typeOptions: v.mutability === "linked" ? linkedTypes : allTypes,
      mutabilityOptions: mutabilityOpts,
    }));
  }

  get hasVariables() {
    return this.variablesFormList.length > 0;
  }

  get topicModalTitle() {
    return this.topicModalIsNew
      ? this.i18n.addNewTopic
      : this.i18n.editTopic;
  }

  get isExistingTopic() {
    return !this.topicModalIsNew;
  }
}
