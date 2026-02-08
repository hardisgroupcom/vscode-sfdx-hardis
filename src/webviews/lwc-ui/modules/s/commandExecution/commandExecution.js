/* eslint-disable */
// LWC: ignore parsing errors for import/export, handled by LWC compiler
// @ts-nocheck
// eslint-env es6
import { LightningElement, track, api } from "lwc";
import PromptInput from "s/promptInput";

export default class CommandExecution extends LightningElement {
  // Track user-toggled expanded state for sections in simple mode
  userSectionExpandState = {}; // { [sectionId]: boolean }
  // Table logs storage (sectionId -> table data)
  tableLogs = {};
  // For embedded prompt
  @track showEmbeddedPrompt = false;
  @track embeddedPromptData = null;
  embeddedPromptListener = null;
  @track commandContext = null;
  @track commandDocUrl = null;
  @track commandLogFile = null;
  @track reportFiles = []; // Track report files
  @track logLines = [];
  @track logSections = [];
  @track currentSection = null;
  @track isCompleted = false;
  @track hasError = false;
  @track startTime = null;
  @track endTime = null;
  @track currentSubCommands = [];
  @track isWaitingForAnswer = false;
  @track latestQuestionId = null;
  @track lastQueryLogId = null;
  @track detailsMode = "simple"; // 'advanced' or 'simple'
  @track currentProgressSection = null; // Track current progress section
  readyMessageSent = false;
  @track isInAutocloseList = false;
  @track autocloseCommands = [];

  containsCopyMarkup(message) {
    return (
      typeof message === "string" && /<copy>[\s\S]*?<\/copy>/i.test(message)
    );
  }

  connectedCallback() {
    // Make component available globally for VS Code message handling
    if (typeof window !== "undefined") {
      window.commandExecutionComponent = this;
    }
    // Handle scrolling state
    this.userScrolledUp = false;
    setTimeout(() => {
      const rootContainer = this.template.querySelector(".command-execution");
      if (rootContainer) {
        rootContainer.addEventListener("scroll", () => {
          const threshold = 500; // px, require user to scroll way up
          const distanceFromBottom =
            rootContainer.scrollHeight -
            (rootContainer.scrollTop + rootContainer.clientHeight);
          // Only set userScrolledUp to true if user is more than threshold away from bottom
          this.userScrolledUp = distanceFromBottom > threshold;
        });
      }
      this.scrollToBottom();
    }, 100);

    // Bind document click handler once so we can remove the exact same reference later
    this._boundHandleDocumentClick = this.handleDocumentClick.bind(this);
  }

  renderedCallback() {
    if (
      !this.readyMessageSent &&
      window &&
      window.sendMessageToVSCode &&
      this.logSections.length > 0
    ) {
      // Notify VS Code that the LWC panel is ready to receive messages
      window.sendMessageToVSCode({
        type: "commandLWCReady",
        data: {},
      });
      this.readyMessageSent = true;
    }
  }

  disconnectedCallback() {
    // Clean up global reference
    if (
      typeof window !== "undefined" &&
      window.commandExecutionComponent === this
    ) {
      window.commandExecutionComponent = null;
    }
    // Remove embedded prompt listeners if any
    if (this.embeddedPromptListener) {
      this.removeEventListener("promptsubmit", this.embeddedPromptListener);
      this.removeEventListener("promptexit", this.embeddedPromptListener);
    }

    if (this._boundHandleDocumentClick) {
      document.removeEventListener("click", this._boundHandleDocumentClick);
    }
  }

  @api
  initialize(initData) {
    this.initializeCommand(initData);
  }

  @api
  handleMessage(messageType, data) {
    switch (messageType) {
      case "initializeCommand":
        this.initializeCommand(data);
        break;
      case "addLogLine":
        // Support for logType 'table'
        if (data && data.logType === "table" && data.message) {
          let tableData;
          try {
            tableData = JSON.parse(data.message);
          } catch (e) {
            // fallback: show as plain log
            this.addLogLine({
              logType: "error",
              message: "Could not parse table data: " + e.message,
              timestamp: data.timestamp,
            });
            break;
          }
          if (Array.isArray(tableData) && tableData.length > 0) {
            // Derive columns from keys of first row
            const columns = Object.keys(tableData[0]).map((key) => ({
              label: this.humanizeKey(key),
              fieldName: key,
              type: typeof tableData[0][key] === "number" ? "number" : "text",
              sortable: true,
            }));
            // Add a log line as a placeholder for the table
            const logLine = {
              id: this.generateId(),
              logType: "table",
              message: "[Table]",
              timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
              tableSectionId: null, // will be set below
            };
            // Add to current section
            if (!this.currentSection) {
              this.startNewSection({
                logType: "action",
                message: "Table Output",
                timestamp: logLine.timestamp,
              });
            }
            this.addLogToCurrentSection(logLine);
            // Store table data for this section
            const sectionId = this.currentSection.id;
            logLine.tableSectionId = sectionId;
            this.tableLogs[sectionId] = {
              columns,
              rows: tableData,
              showAll: false,
            };
            // Update logSections to trigger reactivity
            this.logSections = [...this.logSections];
            break;
          } else {
            // fallback: show as plain log
            this.addLogLine({
              logType: "log",
              message: "[Empty Table]",
              timestamp: data.timestamp,
            });
            break;
          }
        } else {
          this.addLogLine(data);
        }
        break;
      case "addSubCommandStart":
        this.addSubCommandStart(data);
        break;
      case "addSubCommandEnd":
        this.addSubCommandEnd(data);
        break;
      case "completeCommand":
        this.completeCommand(data);
        break;
      case "reportFile":
        this.addReportFile(data);
        break;
      case "showPrompt":
        this.showPromptInPanel(data);
        break;
      case "hidePrompt":
        this.hidePromptInPanel();
        break;
      case "vsCodeSfdxHardisConfigurationChanged":
        this.handleVsCodeSfdxHardisConfigurationChanged(data);
        break;
      case "downloadFileFromPanel":
        this.handleDownloadFileFromPanel(data);
        break;
      case "backgroundCommandEnded":
        this.handleBackgroundCommandEnded(data);
        break;
      case "progressStart":
        this.handleProgressStart(data);
        break;
      case "progressStep":
        this.handleProgressStep(data);
        break;
      case "progressEnd":
        this.handleProgressEnd(data);
        break;
      default:
        console.log("Unknown message type:", messageType, data);
    }
  }

  // Computed property for lightning-input toggle
  get isAdvancedMode() {
    return this.detailsMode === "advanced";
  }

  handleVsCodeSfdxHardisConfigurationChanged(data) {
    const vsCodeSfdxHardisConfiguration = data.vsCodeSfdxHardisConfiguration;
    const newDetailsMode = vsCodeSfdxHardisConfiguration?.[
      "showCommandsDetails"
    ]
      ? "advanced"
      : "simple";
    if (newDetailsMode !== this.detailsMode) {
      this.detailsMode = newDetailsMode;
    }
  }

  // Handler for lightning-input toggle
  handleToggleDetailsMode(event) {
    // lightning-input toggle passes event.detail.checked
    this.detailsMode =
      event.detail && event.detail.checked ? "advanced" : "simple";
    // Optionally persist to VS Code config if needed
    window.sendMessageToVSCode({
      type: "updateVsCodeSfdxHardisConfiguration",
      data: {
        configKey: "showCommandsDetails",
        value: this.detailsMode === "advanced" ? true : false,
      },
    });
  }

  showPromptInPanel(data) {
    this.embeddedPromptData = { prompts: [data.prompt] };
    this.showEmbeddedPrompt = true;
    // Remove any previous listener
    if (this.embeddedPromptListener) {
      this.removeEventListener("promptsubmit", this.embeddedPromptListener);
      this.removeEventListener("promptexit", this.embeddedPromptListener);
    }
    // Listen for submit/exit from embedded prompt
    this.embeddedPromptListener = (event) => {
      if (event.type === "promptsubmit") {
        this.showEmbeddedPrompt = false;
        this.embeddedPromptData = null;
        // Relay to VS Code
        window.sendMessageToVSCode({
          type: "promptSubmit",
          data: event.detail,
        });
      } else if (event.type === "promptexit") {
        this.showEmbeddedPrompt = false;
        this.embeddedPromptData = null;
        window.sendMessageToVSCode({
          type: "promptExit",
          data: event.detail,
        });
      }
    };
    this.addEventListener("promptsubmit", this.embeddedPromptListener);
    this.addEventListener("promptexit", this.embeddedPromptListener);

    // Ensure the embedded promptInput is initialized after rendering
    setTimeout(() => {
      const promptInput = this.template.querySelector("s-prompt-input");
      if (promptInput && typeof promptInput.initialize === "function") {
        promptInput.initialize(this.embeddedPromptData);
      }
      // // Scroll the promptInput into view for better UX
      // if (promptInput && typeof promptInput.scrollIntoView === "function") {
      //   promptInput.scrollIntoView({ behavior: "smooth", block: "center" });
      // } else if (promptInput && promptInput instanceof HTMLElement) {
      //   promptInput.scrollIntoView({ behavior: "smooth", block: "center" });
      // }
    }, 0);
  }

  hidePromptInPanel() {
    this.showEmbeddedPrompt = false;
    this.embeddedPromptData = null;
    // Remove any previous listener
    if (this.embeddedPromptListener) {
      this.removeEventListener("promptsubmit", this.embeddedPromptListener);
      this.removeEventListener("promptexit", this.embeddedPromptListener);
      this.embeddedPromptListener = null;
    }
  }

  // Handler for embedded prompt events (for template wiring)
  handleEmbeddedPromptSubmit(event) {
    // Dispatch as DOM event for showPromptInPanel to catch
    this.dispatchEvent(
      new CustomEvent("promptsubmit", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  handleEmbeddedPromptExit(event) {
    this.dispatchEvent(
      new CustomEvent("promptexit", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  handleLogContainerClick(event) {
    // Handles clicks inside lightning-formatted-rich-text content
    try {
      const target = event && event.target;

      // In shadow DOM (lightning-formatted-rich-text), event.target is often retargeted.
      // Use composedPath() to find the actual anchor element.
      const path =
        event && typeof event.composedPath === "function"
          ? event.composedPath()
          : [];
      let copyLink = null;

      for (const node of path) {
        if (!node || !node.getAttribute || !node.tagName) {
          continue;
        }
        if (String(node.tagName).toUpperCase() !== "A") {
          continue;
        }
        const href = node.getAttribute("href") || "";
        const hasData = !!node.getAttribute("data-copy");
        const isCopyHref =
          href.startsWith("#copy=") || href.startsWith("#copy:");
        const hasCopyClass =
          node.classList && node.classList.contains("copy-token__icon");
        if (hasData || isCopyHref || hasCopyClass) {
          copyLink = node;
          break;
        }
      }

      // Fallback for cases where composedPath isn't available
      if (!copyLink && target && target.closest) {
        copyLink = target.closest("a.copy-token__icon");
      }
      if (!copyLink) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      // Prefer data attribute if it survives sanitization, otherwise parse from href hash
      const encodedFromData = copyLink.getAttribute("data-copy") || "";
      let value = "";
      if (encodedFromData) {
        value = decodeURIComponent(encodedFromData);
      } else {
        const href = copyLink.getAttribute("href") || "";
        const match = href.match(/^#copy[=:](.*)$/);
        if (match && match[1]) {
          value = decodeURIComponent(match[1]);
        }
      }
      if (!value) {
        return;
      }

      this.copyToClipboard(value);

      // Lightweight UI feedback
      const previousTitle = copyLink.getAttribute("title") || "";
      copyLink.setAttribute("title", "Copied!");
      setTimeout(() => {
        try {
          copyLink.setAttribute("title", previousTitle);
        } catch (e) {
          // ignore
        }
      }, 1000);
    } catch (e) {
      // ignore
    }
  }

  async copyToClipboard(text) {
    if (!text) {
      return;
    }

    // Prefer VS Code backend clipboard for reliability in webviews
    try {
      if (typeof window !== "undefined" && window.sendMessageToVSCode) {
        window.sendMessageToVSCode({
          type: "copyToClipboard",
          data: { text },
        });
        return;
      }
    } catch (e) {
      // fallback below
    }

    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      // fallback below
    }

    // Fallback for environments where Clipboard API is unavailable
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch (e) {
      // ignore
    }
  }

  @api
  initializeCommand(data) {
    this.readyMessageSent = false;
    let context = data.context ? data.context : data;
    this.commandContext = context;

    // Handle details mode initialization
    if (data.vsCodeSfdxHardisConfiguration) {
      const vscodeConfig = data.vsCodeSfdxHardisConfiguration;
      this.detailsMode = vscodeConfig?.["showCommandsDetails"]
        ? "advanced"
        : "simple";
      // Load autoclose configuration
      this.autocloseCommands = vscodeConfig?.["autocloseCommands"] || [];
      this.updateAutocloseStatus();
    }

    // Only set commandDocUrl if it's provided, preserve existing value otherwise
    if (context.commandDocUrl) {
      this.commandDocUrl = context.commandDocUrl;
    } else if (!this.commandDocUrl) {
      // Only set to null if we don't already have a URL
      this.commandDocUrl = null;
    }

    // If initialization data contains commandLogFile, set it
    if (context.commandLogFile) {
      this.commandLogFile = context.commandLogFile;
    } else if (!this.commandLogFile) {
      // Reset commandLogFile if not provided
      this.commandLogFile = null;
    }

    this.reportFiles = []; // Reset report files for new command
    this.logLines = [];
    this.logSections = [];
    this.currentSection = null;
    this.currentProgressSection = null; // Reset progress section
    this.isCompleted = false;
    this.hasError = false;
    this.isWaitingForAnswer = false;
    this.startTime = new Date();
    this.endTime = null;
    this.currentSubCommands = [];

    // Add initial "Started" action log
    this.addLogLine({
      logType: "action",
      message: `Started ${context.command || "SFDX Hardis Command"}`,
      timestamp: this.startTime,
    });
  }

  @api
  addReportFile(data) {
    if (data && data.file && data.title) {
      // Only accept the four allowed types
      const allowedTypes = ["actionCommand", "actionUrl", "report", "docUrl"];
      const type = allowedTypes.includes(data.type) ? data.type : "report";
      const reportFile = {
        id: this.generateId(),
        file: data.file,
        title: data.title,
        timestamp: new Date(),
        type: type,
        url: type === "actionUrl" ? data.file : null,
        vscodeCommand: type === "actionCommand" ? data.file : null,
      };
      this.reportFiles = [...this.reportFiles, reportFile];
      this.scrollToBottom();
    }
  }

  @api
  addLogLine(logData) {
    // Skip logs that contain "Please see detailed .* log in" pattern
    if (
      logData.message &&
      /Please see detailed .* log in/i.test(logData.message)
    ) {
      return;
    }

    const logLine = {
      id: this.generateId(),
      logType: logData.logType || "log",
      message: this.cleanMessage(logData.message || ""),
      timestamp: logData.timestamp
        ? logData.timestamp instanceof Date
          ? logData.timestamp
          : new Date(logData.timestamp)
        : new Date(),
      isSubCommand: logData.isSubCommand || false,
      subCommandId: logData.subCommandId || null,
      isQuestion: logData.isQuestion || false,
      isAnswer: this.isWaitingForAnswer,
      isQuery: logData.isQuery || false,
    };

    // Detect if this is a sub-command and determine its running state
    if (
      logLine.isSubCommand ||
      (logLine.message && logLine.message.includes("Running:"))
    ) {
      logLine.isSubCommand = true;
      logLine.isRunning =
        logLine.message && logLine.message.includes("Running:");

      // If this is a completion message, mark as not running and complete other instances
      if (
        logLine.message &&
        (logLine.message.includes("completed") ||
          logLine.message.includes("finished") ||
          logLine.message.includes("done"))
      ) {
        logLine.isRunning = false;

        // Extract command name from completion message and complete other running instances
        this.completeOtherRunningInstances(logLine);
      }
    } else {
      logLine.isRunning = false;
    }

    const isQueryOrResult =
      logLine.message.includes("[SOQL Query]") ||
      logLine.message.includes("[BulkApiV2]") ||
      logLine.message.includes("[SOQL Query Tooling]") ||
      logLine.message.includes("[DataCloudSqlQuery]");

    if (isQueryOrResult) {
      // Clean up the message for queries
      logLine.message = logLine.message
        .replace(/\[SOQL Query\]/g, "")
        .replace(/\[BulkApiV2\]/g, "")
        .replace(/\[SOQL Query Tooling\]/g, "")
        .replace(/\[DataCloudSqlQuery\]/g, "")
        .trim();
    }

    if (isQueryOrResult && this.lastQueryLogId) {
      // This is a result for the last query, merge it
      this.mergeQueryResult(this.lastQueryLogId, logLine.message);
      this.lastQueryLogId = null; // Reset after merging
      return; // Skip adding the result as a separate line
    }

    // Detect if this is a new query
    if (isQueryOrResult) {
      logLine.isQuery = true;
      logLine.logType = "query";
      this.lastQueryLogId = logLine.id;
    }

    // Handle question/answer logic
    if (logLine.isQuestion) {
      this.isWaitingForAnswer = true;
      // Track the latest question ID
      this.latestQuestionId = logLine.id;
    } else if (this.isWaitingForAnswer && !logLine.isQuestion) {
      // This is an answer
      logLine.isAnswer = true;
      this.isWaitingForAnswer = false;
      this.latestQuestionId = null;

      // Try to parse and prettify JSON answers
      logLine.formattedMessage = this.formatAnswerMessage(logLine.message);
    }

    // If this is an action log and there's no active progress section, close current section and start a new one
    // Otherwise, treat action logs as regular log lines when progress is active
    if (
      logLine.logType === "action" &&
      !(this.currentProgressSection && this.currentProgressSection.isActive)
    ) {
      this.closeCurrentSection();
      this.startNewSection(logLine);
    } else {
      // Add log to current section or progress section
      if (this.currentProgressSection && this.currentProgressSection.isActive) {
        this.addLogToProgressSection(logLine);
      } else {
        this.addLogToCurrentSection(logLine);
      }
    }

    this.logLines = [...this.logLines, logLine];

    // Update error state if this is an error log
    if (logLine.logType === "error") {
      this.hasError = true;
    }

    // Auto-scroll to bottom after adding new log
    this.scrollToBottom();
  }

  closeCurrentSection() {
    if (this.currentSection) {
      this.currentSection.endTime = new Date();
      this.currentSection.isActive = false;

      // Remove empty sections only if they are the very first "Started" action section
      // (i.e., the initial section created during initializeCommand)
      if (
        this.currentSection.logs.length === 0 &&
        this.currentSection.actionLog &&
        this.currentSection.actionLog.message &&
        this.currentSection.actionLog.message.startsWith("Started ") &&
        this.logSections.length === 1
      ) {
        // Only if it's the first and only section
        // Remove the empty initial "Started" section from logSections
        this.logSections = this.logSections.filter(
          (section) => section.id !== this.currentSection.id,
        );
      }
    }

    // Also close any active progress section when starting a new action section
    if (this.currentProgressSection && this.currentProgressSection.isActive) {
      this.currentProgressSection.isActive = false;
      this.currentProgressSection.endTime = new Date();

      // Auto-collapse the progress section when it ends, unless user has manually toggled it
      if (
        !this.userSectionExpandState.hasOwnProperty(
          this.currentProgressSection.id,
        )
      ) {
        this.userSectionExpandState[this.currentProgressSection.id] = false;
      }

      this.currentProgressSection = null;
    }
  }

  startNewSection(actionLog) {
    const iconInfo = this.getLogTypeIcon(
      actionLog.logType,
      actionLog.isQuestion,
      actionLog.isAnswer,
    );

    // Format message for multi-line and bullets
    const formattedMessage = this.formatMultiLineMessage(actionLog.message);

    const newSection = {
      id: this.generateId(),
      actionLog: {
        ...actionLog,
        formattedMessage: formattedMessage,
        iconName: iconInfo.iconName,
        iconVariant: iconInfo.variant,
        useSpinner: this.shouldUseSpinner(actionLog),
        formattedTimestamp: this.formatTimestamp(actionLog.timestamp),
        cssClass: this.getLogTypeClass(actionLog.logType),
      },
      logs: [],
      startTime: actionLog.timestamp,
      endTime: null,
      isActive: true,
      isExpanded: true,
      hasError: false,
      isQuestion: actionLog.isQuestion || false,
      hasCopyTokens: this.containsCopyMarkup(actionLog.message),
    };

    // Collapse the previous section if it's not a question
    if (this.logSections.length > 0) {
      const previousSection = this.logSections[this.logSections.length - 1];
      if (
        previousSection &&
        !previousSection.isQuestion &&
        !previousSection.hasCopyTokens
      ) {
        previousSection.isExpanded = false;
      }
    }

    this.currentSection = newSection;
    this.logSections = [...this.logSections, newSection];

    // Auto-scroll to bottom after adding new section
    this.scrollToBottom();
  }

  addLogToCurrentSection(logLine) {
    if (!this.currentSection) {
      // If no current section, create a default one
      this.startNewSection({
        id: this.generateId(),
        logType: "action",
        message: "Logs",
        timestamp: new Date(),
      });
    }

    const iconInfo = this.getLogTypeIcon(
      logLine.logType,
      logLine.isQuestion,
      logLine.isAnswer,
    );
    const formattedLog = {
      ...logLine,
      iconName: iconInfo.iconName,
      iconVariant: iconInfo.variant,
      useSpinner: this.shouldUseSpinner(logLine),
      formattedTimestamp: this.formatTimestamp(logLine.timestamp),
      cssClass: this.getLogTypeClass(logLine.logType),
      isSubCommand: logLine.isSubCommand || false,
      isRunning: logLine.isRunning || false,
      isQuery: logLine.isQuery || false,
      tableSectionId: logLine.tableSectionId || null,
      isTable: logLine.logType === "table",
    };

    // Format multi-line messages and bullets
    if (!formattedLog.formattedMessage) {
      formattedLog.formattedMessage = this.formatMultiLineMessage(
        formattedLog.message,
      );
    }

    // If this section contains copy values, keep it expanded by default
    if (this.containsCopyMarkup(formattedLog.message)) {
      this.currentSection.hasCopyTokens = true;
    }

    this.currentSection.logs = [...this.currentSection.logs, formattedLog];

    // Update section error state
    if (logLine.logType === "error") {
      this.currentSection.hasError = true;
    }

    // Update the sections array to trigger reactivity
    this.logSections = [...this.logSections];

    // Auto-scroll to bottom after adding new log to section
    this.scrollToBottom();
  }

  addLogToProgressSection(logLine) {
    if (!this.currentProgressSection) return;

    const iconInfo = this.getLogTypeIcon(
      logLine.logType,
      logLine.isQuestion,
      logLine.isAnswer,
    );
    const formattedLog = {
      ...logLine,
      iconName: iconInfo.iconName,
      iconVariant: iconInfo.variant,
      useSpinner: this.shouldUseSpinner(logLine),
      formattedTimestamp: this.formatTimestamp(logLine.timestamp),
      cssClass: this.getLogTypeClass(logLine.logType),
      isSubCommand: logLine.isSubCommand || false,
      isRunning: logLine.isRunning || false,
      isQuery: logLine.isQuery || false,
    };

    // Format multi-line messages and bullets
    if (!formattedLog.formattedMessage) {
      formattedLog.formattedMessage = this.formatMultiLineMessage(
        formattedLog.message,
      );
    }

    // Add to progress logs and keep only the latest 5
    this.currentProgressSection.progressLogs = [
      ...this.currentProgressSection.progressLogs,
      formattedLog,
    ].slice(-5); // Keep only last 5 logs

    // Update the sections array to trigger reactivity
    this.logSections = [...this.logSections];

    // Auto-scroll to bottom after adding new log to progress section
    this.scrollToBottom();
  }

  // Handler for "See more" button in table logs
  handleSeeMoreTable(event) {
    const sectionId = event.target.dataset.sectionId;
    if (sectionId && this.tableLogs[sectionId]) {
      this.tableLogs[sectionId].showAll = true;
      // Force reactivity
      this.tableLogs = { ...this.tableLogs };
    }
  }
  // Helper to get table log data for a section
  getTableLog(sectionId) {
    return this.tableLogs[sectionId] || null;
  }

  mergeQueryResult(queryLogId, resultMessage) {
    const logIndex = this.logLines.findIndex((log) => log.id === queryLogId);
    if (logIndex === -1) {
      return; // Query log not found, nothing to do
    }

    const queryLog = this.logLines[logIndex];
    const newMergedMessage = `${queryLog.message}
${resultMessage}`;

    const updatedLog = {
      ...queryLog,
      message: newMergedMessage,
    };

    // Update logLines immutably
    this.logLines = [
      ...this.logLines.slice(0, logIndex),
      updatedLog,
      ...this.logLines.slice(logIndex + 1),
    ];

    // Update logSections immutably
    if (this.currentSection && this.currentSection.logs) {
      const sectionLogIndex = this.currentSection.logs.findIndex(
        (log) => log.id === queryLogId,
      );
      if (sectionLogIndex !== -1) {
        const updatedSectionLog = {
          ...this.currentSection.logs[sectionLogIndex],
          message: newMergedMessage,
        };

        this.currentSection.logs = [
          ...this.currentSection.logs.slice(0, sectionLogIndex),
          updatedSectionLog,
          ...this.currentSection.logs.slice(sectionLogIndex + 1),
        ];
        this.logSections = [...this.logSections];
      }
    }
  }

  @api
  addSubCommandStart(subCommandData) {
    const subCommand = {
      id: this.generateId(),
      command: subCommandData.command,
      cwd: subCommandData.cwd,
      startTime: new Date(),
      endTime: null,
      success: null,
      isExpanded: false,
    };

    this.currentSubCommands = [...this.currentSubCommands, subCommand];

    // Add log line for sub-command start (this will be replaced when sub-command ends)
    this.addLogLine({
      logType: "log",
      message: `Running: ${subCommand.command}`,
      timestamp: subCommand.startTime,
      isSubCommand: true,
      subCommandId: subCommand.id,
    });
  }

  @api
  addSubCommandEnd(subCommandData) {
    // Find all running instances of this command
    const runningCommands = this.currentSubCommands.filter(
      (subCmd) => subCmd.command === subCommandData.command && !subCmd.endTime,
    );

    if (runningCommands.length === 0) return;

    // Update all instances of this command to completed
    const updatedSubCommands = this.currentSubCommands.map((subCmd) => {
      if (subCmd.command === subCommandData.command && !subCmd.endTime) {
        return {
          ...subCmd,
          endTime: new Date(),
          success: subCommandData.success,
          result: subCommandData.result,
        };
      }
      return subCmd;
    });

    this.currentSubCommands = updatedSubCommands;

    // Complete all running instances of this command
    runningCommands.forEach((subCommand) => {
      const duration = this.calculateDuration(
        subCommand.startTime,
        subCommand.endTime || new Date(),
      );
      // Remove 'Running: ' prefix only if present
      let cleanCommand = subCommandData.command;
      if (cleanCommand.startsWith("Running: ")) {
        cleanCommand = cleanCommand.slice("Running: ".length);
      }
      this.replaceSubCommandLog(subCommand.id, {
        logType: subCommandData.success ? "success" : "error",
        message: `${subCommandData.command.replace("Running: ", "")} (${duration})`,
        timestamp: subCommand.endTime || new Date(),
        isSubCommand: true,
        subCommandId: subCommand.id,
      });
    });

    if (!subCommandData.success) {
      this.hasError = true;
    }
  }

  replaceSubCommandLog(subCommandId, newLogData) {
    // Find and replace the sub-command log in the current section
    if (this.currentSection && this.currentSection.logs) {
      const logIndex = this.currentSection.logs.findIndex(
        (log) => log.isSubCommand && log.subCommandId === subCommandId,
      );

      if (logIndex !== -1) {
        const iconInfo = this.getLogTypeIcon(
          newLogData.logType,
          newLogData.isQuestion,
          newLogData.isAnswer,
        );
        const baseLog = {
          ...this.currentSection.logs[logIndex],
          ...newLogData,
        };

        // Detect running state for updated sub-command
        const isRunning =
          newLogData.message &&
          newLogData.message.includes("Running:") &&
          !(
            newLogData.message.includes("completed") ||
            newLogData.message.includes("finished") ||
            newLogData.message.includes("done")
          );

        const updatedLog = {
          ...baseLog,
          logType: newLogData.logType,
          message: newLogData.message,
          timestamp: newLogData.timestamp,
          iconName: iconInfo.iconName,
          iconVariant: iconInfo.variant,
          useSpinner: this.shouldUseSpinner(baseLog),
          formattedTimestamp: this.formatTimestamp(newLogData.timestamp),
          cssClass: this.getLogTypeClass(newLogData.logType),
          isSubCommand: true,
          isRunning: isRunning,
        };

        this.currentSection.logs[logIndex] = updatedLog;

        // Update section error state if needed
        if (newLogData.logType === "error") {
          this.currentSection.hasError = true;
        }

        // Update the sections array to trigger reactivity
        this.logSections = [...this.logSections];

        // Auto-scroll to bottom after updating sub-command log
        this.scrollToBottom();
      }
    }

    // Also update the main logLines array
    const mainLogIndex = this.logLines.findIndex(
      (log) => log.isSubCommand && log.subCommandId === subCommandId,
    );

    if (mainLogIndex !== -1) {
      this.logLines[mainLogIndex] = {
        ...this.logLines[mainLogIndex],
        ...newLogData,
      };
      this.logLines = [...this.logLines];
    }
  }

  completeOtherRunningInstances(completedCommand) {
    // Extract command name from completion message
    let commandName = "";
    if (completedCommand.includes("Completed: ")) {
      commandName = completedCommand.replace("Completed: ", "").split(" ")[0];
    }

    if (commandName) {
      this.subCommands.forEach((subCommand, index) => {
        if (
          subCommand.name.startsWith(commandName) &&
          subCommand.status === "running" &&
          subCommand.name !== completedCommand.replace("Completed: ", "")
        ) {
          this.subCommands[index] = {
            ...subCommand,
            status: "completed",
          };
        }
      });
      this.subCommands = [...this.subCommands];
    }
  }

  @api
  completeCommand(data) {
    // Handle new format - object with success and status
    const success = data.success !== undefined ? data.success : true;
    const status = data.status || null;

    this.isCompleted = true;
    this.endTime = new Date();

    if (this.currentSection) {
      this.currentSection.endTime = this.endTime;
      this.currentSection.isActive = false;
      if (!success) {
        this.currentSection.hasError = true;
      }
    }

    if (this.currentSubCommands.length > 0) {
      // Mark all sub-commands as completed
      this.currentSubCommands.forEach((subCommand) => {
        subCommand.endTime = this.endTime;
        subCommand.success = success;
      });
    }

    if (this.isWaitingForAnswer) {
      // If we were waiting for an answer, mark it as completed
      this.isWaitingForAnswer = false;
      this.latestQuestionId = null;
      this.showEmbeddedPrompt = false;
      this.embeddedPromptData = null;
    }

    const duration = this.calculateDuration(this.startTime, this.endTime);
    const logType = success ? "success" : "error";

    // Create completion message based on status
    let completionMessage = `Command ${success ? "completed successfully" : "failed"}`;
    if (status) {
      completionMessage = `Command ${status}`;
    }
    completionMessage += ` (${duration})`;
    if (data.error) {
      completionMessage += `\n${data.error.message || JSON.stringify(data.error, null, 2)}`;
    }

    this.addLogLine({
      logType: logType,
      message: completionMessage,
      timestamp: this.endTime,
    });

    if (!success) {
      this.hasError = true;
    }
  }

  get commandTitle() {
    if (!this.commandContext) return "Command Execution";

    const command = this.commandContext.command || "Unknown command";
    const status = this.isCompleted
      ? this.hasError
        ? "Failed"
        : "Completed"
      : "Running";

    return `${command} - ${status}`;
  }

  get commandDuration() {
    if (!this.startTime) return "";

    const endTime = this.endTime || new Date();
    return this.calculateDuration(this.startTime, endTime);
  }

  get statusIcon() {
    if (!this.isCompleted) {
      return null; // Will use spinner instead
    }
    return this.hasError
      ? { iconName: "utility:error", variant: "error" }
      : { iconName: "utility:success", variant: "success" };
  }

  get useSpinner() {
    return !this.isCompleted;
  }

  get statusClass() {
    if (!this.isCompleted) {
      return "slds-text-color_weak";
    }
    return this.hasError ? "slds-text-color_error" : "slds-text-color_success";
  }

  get filteredLogLines() {
    return this.logLines
      .filter((log) => log.message.trim() !== "")
      .map((log) => {
        const iconInfo = this.getLogTypeIcon(
          log.logType,
          log.isQuestion,
          log.isAnswer,
        );
        return {
          ...log,
          iconName: iconInfo.iconName,
          iconVariant: iconInfo.variant,
          useSpinner: this.shouldUseSpinner(log),
          formattedTimestamp: this.formatTimestamp(log.timestamp),
          cssClass: this.getLogTypeClass(log.logType),
        };
      });
  }

  get latestQuestionSectionId() {
    // Find the section whose actionLog.id matches latestQuestionId and is a question
    if (!this.latestQuestionId) return null;
    const section = this.logSections.find(
      (s) =>
        s.isQuestion && s.actionLog && s.actionLog.id === this.latestQuestionId,
    );
    return section ? section.id : null;
  }

  get logSectionsForDisplay() {
    const latestQuestionSectionId = this.latestQuestionSectionId;
    const shouldHideLatest = this.showEmbeddedPrompt;
    const isSimple = this.detailsMode === "simple";
    const isCompletedOrAborted = this.isCompleted || this.hasError;
    const lastSectionIdx = this.logSections.length - 1;
    return this.logSections.map((section, idx) => {
      const isLatest = section.id === latestQuestionSectionId;
      const isProgress = section.type === "progress";

      // Table log support
      let tableLog = this.tableLogs[section.id] || null;
      let tableShowAll = false;
      let tableShowMoreButton = false;
      let rowsLimited = [];
      let tableRows = [];
      let tableTruncatedMessage = null;
      if (tableLog) {
        tableShowAll = !!tableLog.showAll;
        rowsLimited = tableLog.rows ? tableLog.rows.slice(0, 10) : [];
        tableShowMoreButton =
          !tableShowAll && tableLog.rows && tableLog.rows.length > 10;
        let rawRows = tableShowAll ? tableLog.rows : rowsLimited;
        // Detect truncation message row
        if (
          rawRows.length > 0 &&
          rawRows[rawRows.length - 1].sfdxHardisTruncatedMessage
        ) {
          tableTruncatedMessage =
            rawRows[rawRows.length - 1].sfdxHardisTruncatedMessage;
          rawRows = rawRows.slice(0, rawRows.length - 1);
        }
        tableRows = rawRows;
      }

      // --- SIMPLE/ADVANCED LOGIC ---
      let isExpanded = section.isExpanded;
      // By default, question sections and progress sections are expanded, but user can collapse them
      if (this.userSectionExpandState.hasOwnProperty(section.id)) {
        isExpanded = this.userSectionExpandState[section.id];
      } else if (section.isQuestion) {
        isExpanded = true;
      } else if (isProgress) {
        // Progress sections are expanded when active, collapsed when ended (unless user manually toggled)
        isExpanded = section.isActive === true;
      } else if (isSimple) {
        // In simple mode, keep sections containing copyable values open
        if (section.hasCopyTokens) {
          isExpanded = true;
        } else if (this.showEmbeddedPrompt) {
          isExpanded = isLatest;
        } else if (idx === lastSectionIdx && isCompletedOrAborted) {
          isExpanded = true;
        } else {
          isExpanded = false;
        }
      }

      // Chevron should reflect actual expansion state for all sections
      const toggleIcon = isExpanded
        ? "utility:chevronup"
        : "utility:chevrondown";

      // Progress-specific properties
      let progressPercentage = 0;
      let progressAnimationClass = "";
      let isIndeterminate = false;
      let progressStepText = "";
      let progressTimeEstimation = "";

      if (isProgress && section.totalSteps > 0) {
        progressPercentage = Math.round(
          (section.currentStep / section.totalSteps) * 100,
        );
        progressStepText = `${section.currentStep} of ${section.totalSteps} steps`;
        progressTimeEstimation = section.estimatedRemainingTime || "";

        // Add shine animation for active progress with known steps
        if (section.isActive) {
          progressAnimationClass = "animated-progress-bar is-active";
        }
      } else if (isProgress && section.totalSteps === 0) {
        // If no total steps defined, show indeterminate progress
        // Show increasing progress based on steps taken, but cap at 90% for indeterminate feel
        progressPercentage =
          section.currentStep > 0
            ? Math.min(90, 20 + section.currentStep * 5)
            : 15; // Show some initial progress
        progressStepText =
          section.currentStep > 0
            ? `${section.currentStep} steps completed`
            : "Starting...";
        isIndeterminate = true;
        if (section.isActive) {
          progressAnimationClass = "animated-progress-bar is-indeterminate";
        }
      }

      return {
        ...section,
        isExpanded,
        isProgress,
        progressPercentage,
        progressAnimationClass,
        progressStepText,
        progressTimeEstimation,
        isIndeterminate,
        duration: this.calculateSectionDuration(section),
        toggleIcon,
        sectionStatusIcon:
          section.isQuestion && !this.isWaitingForAnswer
            ? { iconName: "utility:question", variant: "warning" }
            : isProgress && section.isActive
              ? { iconName: "utility:progress", variant: "brand" }
              : section.hasError
                ? { iconName: "utility:error", variant: "error" }
                : section.isActive
                  ? null
                  : { iconName: "utility:success", variant: "success" },
        sectionUseSpinner:
          section.isActive ||
          (section.isQuestion &&
            this.isWaitingForAnswer &&
            this.isLatestQuestionSection(section)),
        sectionStatusClass: section.hasError
          ? "slds-text-color_error"
          : section.isActive
            ? "slds-text-color_weak"
            : "slds-text-color_success",
        hasLogs:
          (section.logs && section.logs.length > 0) ||
          (isProgress &&
            section.progressLogs &&
            section.progressLogs.length > 0),
        showToggle:
          (section.logs && section.logs.length > 0) ||
          (isProgress &&
            section.progressLogs &&
            section.progressLogs.length > 0),
        isLatestQuestionSectionToHide: shouldHideLatest && isLatest,
        tableLog: tableLog ? { ...tableLog, rowsLimited } : null,
        tableShowAll,
        tableShowMoreButton,
        tableRows,
        tableTruncatedMessage,
      };
    });
  }

  // --- Report Files Section Helpers ---
  get reportFileTypesPresent() {
    // Returns an object: { hasActionCommands, hasActionUrls, hasReports, hasDocUrls }
    let hasActionCommands = false,
      hasActionUrls = false,
      hasReports = false,
      hasDocUrls = false;
    for (const f of this.reportFiles) {
      if (f.type === "actionCommand") hasActionCommands = true;
      else if (f.type === "actionUrl") hasActionUrls = true;
      else if (f.type === "report") hasReports = true;
      else if (f.type === "docUrl") hasDocUrls = true;
    }
    return { hasActionCommands, hasActionUrls, hasReports, hasDocUrls };
  }

  get reportFilesSectionTitle() {
    const { hasActionCommands, hasActionUrls, hasReports, hasDocUrls } =
      this.reportFileTypesPresent;
    const parts = [];
    if (hasActionCommands || hasActionUrls) parts.push("Actions");
    if (hasReports) parts.push("Reports");
    if (hasDocUrls) parts.push("Docs");
    return parts.length > 0 ? parts.join(", ") : "Report Files";
  }

  get sortedReportFiles() {
    // Sort: actionCommand, actionUrl, report, docUrl
    const actionCommands = [];
    const actionUrls = [];
    const reports = [];
    const docUrls = [];
    for (const f of this.reportFiles) {
      switch (f.type) {
        case "actionCommand":
          actionCommands.push(f);
          break;
        case "actionUrl":
          actionUrls.push(f);
          break;
        case "report":
          reports.push(f);
          break;
        case "docUrl":
          docUrls.push(f);
          break;
        default:
          reports.push(f);
      }
    }

    // Helper function to group files with similar labels
    const groupSimilarFiles = (files) => {
      const grouped = {};
      const standalone = [];

      for (const file of files) {
        // Check if the title ends with (CSV) or (XLSX)
        const csvMatch = file.title.match(/^(.+?)\s*\(CSV\)$/);
        const xlsxMatch = file.title.match(/^(.+?)\s*\(XLSX\)$/);

        if (csvMatch) {
          const baseTitle = csvMatch[1].trim();
          if (!grouped[baseTitle]) {
            grouped[baseTitle] = { base: baseTitle, files: [] };
          }
          grouped[baseTitle].files.push({ ...file, format: "CSV" });
        } else if (xlsxMatch) {
          const baseTitle = xlsxMatch[1].trim();
          if (!grouped[baseTitle]) {
            grouped[baseTitle] = { base: baseTitle, files: [] };
          }
          grouped[baseTitle].files.push({ ...file, format: "XLSX" });
        } else {
          standalone.push(file);
        }
      }

      // Convert grouped files to dropdown format or standalone if only one format
      const result = [];

      for (const [baseTitle, group] of Object.entries(grouped)) {
        if (group.files.length === 1) {
          // Only one format, keep as standalone
          result.push(group.files[0]);
        } else {
          // Multiple formats, create dropdown
          // Use a stable ID based on the title to prevent issues on re-render
          const stableId = `dropdown_${baseTitle.replace(/[^a-zA-Z0-9]/g, "")}`;
          result.push({
            id: stableId,
            title: baseTitle,
            type: group.files[0].type, // Use the type from the first file
            isDropdown: true,
            dropdownOptions: group.files.map((f) => ({
              label:
                f.format === "CSV"
                  ? "CSV"
                  : f.format === "XLSX"
                    ? "Excel"
                    : f.format,
              value: f.file, // Keep value for compatibility if needed elsewhere
              type: f.type,
              file: f.file,
              format: f.format,
            })),
          });
        }
      }

      return [...result, ...standalone];
    };

    // Group similar files for each category
    const groupedActionCommands = groupSimilarFiles(actionCommands);
    const groupedActionUrls = groupSimilarFiles(actionUrls);
    const groupedReports = groupSimilarFiles(reports);
    const groupedDocUrls = groupSimilarFiles(docUrls);

    // Map to add button/icon props as before
    const decorate = (f) => {
      const baseProps = {
        ...f,
        buttonVariant:
          f.type === "actionCommand"
            ? "brand"
            : f.type === "actionUrl"
              ? "brand"
              : f.type === "docUrl"
                ? "outline-brand"
                : "success",
        iconName:
          f.type === "actionCommand"
            ? "utility:play"
            : f.type === "actionUrl"
              ? "utility:link"
              : f.type === "docUrl"
                ? "utility:info"
                : "utility:page",
        iconVariant: f.type === "docUrl" ? "brand" : "inverse",
      };

      // Add dropdown-specific properties
      if (f.isDropdown) {
        baseProps.dropdownOptionsJson = JSON.stringify(f.dropdownOptions);
      }

      return baseProps;
    };

    return [
      ...groupedActionCommands.map(decorate),
      ...groupedActionUrls.map(decorate),
      ...groupedReports.map(decorate),
      ...groupedDocUrls.map(decorate),
    ];
  }

  calculateDuration(startTime, endTime) {
    if (!startTime || !endTime) return "";

    // Ensure we have Date objects
    const start = startTime instanceof Date ? startTime : new Date(startTime);
    const end = endTime instanceof Date ? endTime : new Date(endTime);

    // Check if dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return "";

    const diff = end.getTime() - start.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  calculateSectionDuration(section) {
    if (!section.startTime) return "";

    const startTime =
      section.startTime instanceof Date
        ? section.startTime
        : new Date(section.startTime);
    const endTime = section.endTime
      ? section.endTime instanceof Date
        ? section.endTime
        : new Date(section.endTime)
      : new Date();

    return this.calculateDuration(startTime, endTime);
  }

  cleanMessage(message) {
    if (!message || typeof message !== "string") return "";
    // Remove leading 🦙 from questions
    message = message.replace(/^🦙\s*/, "");
    // Remove ANSI escape codes
    return message
      .replace(/\x1b\[[0-9;]*m/g, "") // Standard ANSI codes
      .replace(/\[9[0-7]m/g, "") // Color codes
      .replace(/\[3[0-9]m/g, "") // Color codes
      .replace(/\[1m/g, "") // Bold
      .replace(/\[0m/g, "") // Reset
      .replace(/\[22m/g, "") // Normal intensity
      .replace(/\[2[0-9]m/g, "") // Various codes
      .replace(/\[4[0-9]m/g, "") // Background colors
      .replace(/\[[0-9]+m/g, "") // Any remaining numeric codes
      .replace(/\[[0-9;]+m/g, "") // Multiple codes
      .trim();
  }

  formatAnswerMessage(message) {
    // Try to parse as JSON and make it human-readable
    try {
      const parsed = JSON.parse(message);
      return this.makeJsonHumanReadable(parsed);
    } catch (e) {
      // Not valid JSON, return original message
      return this.linkifyUrls(message);
    }
  }

  linkifyUrls(message) {
    if (!message || typeof message !== "string") {
      return message;
    }
    const urlRegex = /(https?:\/\/[^\s"'`<>]+)/g;
    return message.replace(
      urlRegex,
      (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    );
  }

  makeJsonHumanReadable(obj) {
    if (obj === null) return "No value";
    if (obj === undefined) return "Not defined";
    if (typeof obj === "boolean") return obj ? "Yes" : "No";
    if (typeof obj === "string") return this.linkifyUrls(obj);
    if (typeof obj === "number") return obj.toString();

    if (Array.isArray(obj)) {
      if (obj.length === 0) return "No items";
      if (obj.length === 1) return this.makeJsonHumanReadable(obj[0]);

      // For arrays, create a readable list with HTML line breaks
      const items = obj
        .map((item, index) => {
          const readable = this.makeJsonHumanReadable(item);
          return `${index + 1}. ${readable}`;
        })
        .join("<br/>");

      return `${obj.length} items:<br/>${items}`;
    }

    if (typeof obj === "object") {
      const entries = Object.entries(obj);
      if (entries.length === 0) return "No properties";

      // If single property and value is a string, return just the string value
      if (entries.length === 1 && typeof entries[0][1] === "string") {
        return this.linkifyUrls(entries[0][1]);
      }

      // Convert object properties to human-readable format with HTML
      const readable = entries
        .map(([key, value]) => {
          const humanKey = this.humanizeKey(key);
          const humanValue = this.makeJsonHumanReadable(value);

          // Handle different value types with appropriate HTML formatting
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            const indentedValue = humanValue
              .split("<br/>")
              .join("<br/>&nbsp;&nbsp;");
            return `${humanKey}:<br/>&nbsp;&nbsp;${indentedValue}`;
          } else {
            return `${humanKey}: ${humanValue}`;
          }
        })
        .join("<br/>");

      return readable;
    }

    return obj.toString();
  }

  humanizeKey(key) {
    // Convert camelCase, snake_case, or kebab-case to human-readable format
    return key
      .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase
      .replace(/[_-]/g, " ") // snake_case and kebab-case
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase()) // Capitalize first letter
      .replace(/\bid\b/gi, "ID") // Special case for ID
      .replace(/\burl\b/gi, "URL") // Special case for URL
      .replace(/\bapi\b/gi, "API") // Special case for API
      .replace(/\bsfdx\b/gi, "SFDX") // Special case for SFDX
      .replace(/\bsf\b/gi, "SF"); // Special case for SF
  }

  generateId() {
    return "log_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
  }

  getLogTypeClass(logType) {
    switch (logType) {
      case "error":
        return "log-error";
      case "warning":
        return "log-warning";
      case "success":
        return "log-success";
      case "action":
        return "log-action";
      case "query":
        return "log-query";
      case "log":
      default:
        return "log-default";
    }
  }

  getLogTypeIcon(logType, isQuestion = false, isAnswer = false) {
    if (isQuestion) {
      return { iconName: "utility:question", variant: "warning" };
    }
    if (isAnswer) {
      return { iconName: "utility:reply", variant: "brand" };
    }

    switch (logType) {
      case "error":
        return { iconName: "utility:error", variant: "error" };
      case "warning":
        return { iconName: "utility:warning", variant: "warning" };
      case "success":
        return { iconName: "utility:success", variant: "success" };
      case "action":
        return { iconName: "utility:touch_action", variant: "brand" };
      case "query":
        return { iconName: "utility:database", variant: "brand" };
      case "log":
      default:
        return { iconName: "utility:info", variant: "inverse" };
    }
  }

  shouldUseSpinner(log) {
    // Use spinner for running sub-commands (those that contain "Running:")
    if (log.isSubCommand && log.message && log.message.includes("Running:")) {
      return true;
    }
    // Use spinner ONLY for the latest question that is waiting for an answer
    if (
      log.isQuestion &&
      this.isWaitingForAnswer &&
      log.id === this.latestQuestionId
    ) {
      return true;
    }
    return false;
  }

  isLatestQuestionSection(section) {
    // Check if this section contains the latest question
    if (!this.latestQuestionId || !section.isQuestion) {
      return false;
    }

    // Check if the section's action log is the latest question
    if (section.actionLog && section.actionLog.id === this.latestQuestionId) {
      return true;
    }

    // Check if any log in the section is the latest question
    return (
      section.logs &&
      section.logs.some((log) => log.id === this.latestQuestionId)
    );
  }

  formatMultiLineMessage(message) {
    if (!message || typeof message !== "string") return "";

    // 1) Extract <copy>...</copy> tokens first (message can contain multiple)
    const copyTokens = [];
    const tokenizedMessage = message.replace(
      /<copy>([\s\S]*?)<\/copy>/gi,
      (match, value) => {
        const token = `__COPY_TOKEN_${copyTokens.length}__`;
        copyTokens.push(value);
        return token;
      },
    );

    const escapeHtml = (str) => {
      if (str === null || str === undefined) {
        return "";
      }
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/`/g, "&#96;");
    };

    // Linkify on already-escaped HTML text (so we never insert raw user HTML)
    const linkifyEscapedText = (escapedText) => {
      if (!escapedText || typeof escapedText !== "string") {
        return escapedText;
      }
      const urlRegex = /(https?:\/\/[^\s"'`<>]+)/g;
      return escapedText.replace(urlRegex, (url) => {
        // url is already escaped for display, but href must be a real URL
        const href = url.replace(/&amp;/g, "&");
        const safeHref = href.replace(/"/g, "%22");
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
    };

    const renderCopyToken = (value) => {
      const displayed = escapeHtml(value);
      const encoded = encodeURIComponent(value);

      // Use a hash URL so it never opens an external browser even if interception fails.
      // We intercept clicks in handleLogContainerClick and prevent default.
      const href = `#copy=${encoded}`;
      return `<span class="copy-token"><span class="copy-token__value">${displayed}</span><a href="${href}" data-copy="${encoded}" class="copy-token__icon" title="Copy to clipboard" aria-label="Copy to clipboard">&#128203;</a></span>`;
    };

    const replaceCopyTokens = (html) => {
      let output = html;
      for (let i = 0; i < copyTokens.length; i++) {
        const token = `__COPY_TOKEN_${i}__`;
        output = output.split(token).join(renderCopyToken(copyTokens[i]));
      }
      return output;
    };

    const hasMultilineOrList =
      tokenizedMessage.includes("\n") ||
      tokenizedMessage.trim().startsWith("- ");

    // 2) Single-line: escape -> linkify -> replace copy tokens
    if (!hasMultilineOrList) {
      const escaped = escapeHtml(tokenizedMessage);
      const withLinks = linkifyEscapedText(escaped);
      return replaceCopyTokens(withLinks);
    }

    // 3) Multi-line: escape first (keeps token markers intact), then build list/html
    const safeMessage = escapeHtml(tokenizedMessage);

    const lines = safeMessage.split("\n");
    let html = "";
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith("- ")) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        const item = line.substring(line.indexOf("- ") + 2);
        html += `<li>${replaceCopyTokens(linkifyEscapedText(item))}</li>`;
      } else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += replaceCopyTokens(linkifyEscapedText(line));
        if (i < lines.length - 1) {
          html += "<br/>";
        }
      }
    }

    if (inList) {
      html += "</ul>";
    }
    return html;
  }

  formatTimestamp(timestamp) {
    if (!timestamp) return "";

    try {
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      if (isNaN(date.getTime())) return "";
      return date.toLocaleTimeString();
    } catch (error) {
      console.error("Error formatting timestamp:", error, timestamp);
      return "";
    }
  }

  handleToggleSection(event) {
    const sectionId = event.currentTarget.dataset.sectionId;
    const section = this.logSections.find((s) => s.id === sectionId);
    if (section) {
      // In simple mode, track user toggles separately
      if (this.detailsMode === "simple") {
        const prev = this.userSectionExpandState[sectionId] || false;
        this.userSectionExpandState = {
          ...this.userSectionExpandState,
          [sectionId]: !prev,
        };
      } else {
        section.isExpanded = !section.isExpanded;
      }
      this.logSections = [...this.logSections];
    }
  }

  scrollToBottom() {
    // Only scroll if user has not scrolled up
    if (this.userScrolledUp) return;
    requestAnimationFrame(() => {
      const rootContainer = this.template.querySelector(".command-execution");
      if (rootContainer) {
        rootContainer.scrollTop = rootContainer.scrollHeight;
      }
    });
  }

  get hasDocumentation() {
    return this.commandDocUrl && this.commandDocUrl.trim() !== "";
  }

  handleOpenDocumentation() {
    if (this.commandDocUrl) {
      // Use the VS Code webview API to send message
      window.sendMessageToVSCode({
        type: "openExternal",
        data: { url: this.commandDocUrl },
      });
    }
  }

  get hasReportFiles() {
    return this.reportFiles && this.reportFiles.length > 0;
  }

  get reportFilesCount() {
    return this.reportFiles ? this.reportFiles.length : 0;
  }

  // Handler for the log file icon button
  handleOpenCommandLogFile() {
    if (
      this.commandLogFile &&
      typeof window !== "undefined" &&
      window.sendMessageToVSCode
    ) {
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: this.commandLogFile },
      });
    }
  }

  handleOpenReportFile(event) {
    // Find the reportFile object by id or file path
    const filePath = event.target.dataset.filePath;
    const reportFile = this.reportFiles.find((f) => f.file === filePath);
    if (!reportFile) {
      console.error("Report file not found for:", filePath);
      return;
    }

    switch (reportFile.type) {
      case "actionCommand":
        // Run a VS Code command
        window.sendMessageToVSCode({
          type: "runVsCodeCommand",
          data: { command: reportFile.file },
        });
        break;
      case "actionUrl":
      case "docUrl":
        // Open external URL
        window.sendMessageToVSCode({
          type: "openExternal",
          data: { url: reportFile.file },
        });
        break;
      case "report":
      default:
        // Open file in VS Code
        window.sendMessageToVSCode({
          type: "openFile",
          data: { filePath: reportFile.file },
        });
        break;
    }
  }

  // Replace the dropdown toggle handler with a more defensive implementation
  handleReportDropdownToggle(event) {
    // Handle click on multi-format report button to toggle dropdown
    event.stopPropagation();

    // Defensive reportId resolution (lightning-button wraps the real button)
    const reportId =
      (event.currentTarget &&
        event.currentTarget.dataset &&
        event.currentTarget.dataset.reportId) ||
      (event.target && event.target.dataset && event.target.dataset.reportId) ||
      (event.target &&
        event.target.closest &&
        event.target.closest("[data-report-id]") &&
        event.target.closest("[data-report-id]").dataset.reportId);

    if (!reportId) return;

    // Close any other open dropdowns
    this.closeAllDropdowns();

    const container = this.template.querySelector(
      `[data-report-id="${reportId}"].report-dropdown-container`,
    );
    const dropdown = this.template.querySelector(
      `[data-report-id="${reportId}"].report-format-dropdown`,
    );

    if (!container || !dropdown) return;

    const isOpen = container.classList.contains("slds-is-open");

    if (!isOpen) {
      container.classList.add("slds-is-open");
      dropdown.classList.add("slds-is-open");

      // Add document listener (use pre-bound reference)
      setTimeout(() => {
        document.addEventListener("click", this._boundHandleDocumentClick);
      }, 0);
    } else {
      // Close it
      container.classList.remove("slds-is-open");
      dropdown.classList.remove("slds-is-open");
      if (this._boundHandleDocumentClick) {
        document.removeEventListener("click", this._boundHandleDocumentClick);
      }
    }
  }

  handleDropdownMainButtonClick(event) {
    // Handle click on the main button part of a dropdown button - open Excel by default
    event.stopPropagation();

    const reportId = event.currentTarget.dataset.reportId;
    if (!reportId) return;

    // Find the report file by ID
    const reportFile = this.sortedReportFiles.find((f) => f.id === reportId);
    if (!reportFile || !reportFile.isDropdown) return;

    // Look for Excel/XLSX option first, fallback to first option
    let targetOption = reportFile.dropdownOptions.find(
      (opt) => opt.format === "XLSX",
    );
    if (!targetOption) {
      targetOption = reportFile.dropdownOptions[0];
    }

    if (targetOption) {
      // Trigger the same file opening logic as dropdown selection
      this.handleReportFileAction(targetOption.file, targetOption.label);
    }
  }

  handleReportFileDropdownSelect(event) {
    // Handle selection from dropdown
    event.preventDefault();
    event.stopPropagation();

    const filePath = event.currentTarget.dataset.filePath;
    const reportId = event.currentTarget.dataset.reportId;

    // Close the dropdown
    this.closeAllDropdowns();

    // Find the parent report file group from the memoized/stable sortedReportFiles
    const parentReportFile = this.sortedReportFiles.find(
      (rf) => rf.id === reportId,
    );
    if (!parentReportFile) {
      return;
    }

    // Find the specific selected option from the dropdown
    const selectedOption = parentReportFile.dropdownOptions.find(
      (option) => option.file === filePath,
    );
    if (!selectedOption) {
      return;
    }

    // Use the common action handler
    this.handleReportFileAction(selectedOption.file, selectedOption.label);
  }

  handleDocumentClick(event) {
    // Close dropdowns when clicking outside
    const dropdownContainers = this.template.querySelectorAll(
      ".report-dropdown-container",
    );
    let clickedInside = false;

    dropdownContainers.forEach((container) => {
      if (container.contains(event.target)) {
        clickedInside = true;
      }
    });

    if (!clickedInside) {
      this.closeAllDropdowns();
    }
  }

  closeAllDropdowns() {
    // Close all open dropdowns
    const containers = this.template.querySelectorAll(
      ".report-dropdown-container",
    );
    const dropdowns = this.template.querySelectorAll(".report-format-dropdown");

    containers.forEach((container) => {
      container.classList.remove("slds-is-open");
      container.classList.remove("dropdown-above"); // Clean up positioning class
    });

    dropdowns.forEach((dropdown) => {
      dropdown.classList.remove("slds-is-open");
    });

    // Remove document click listener (use bound reference)
    if (this._boundHandleDocumentClick) {
      document.removeEventListener("click", this._boundHandleDocumentClick);
    }
  }

  handleReportFileAction(filePath, label) {
    // Common method to handle report file actions (download/open)
    if (!filePath) {
      return;
    }

    if (filePath.startsWith("http")) {
      // External URL - download or open external
      window.sendMessageToVSCode({
        type: "downloadFile",
        data: filePath,
      });
    } else {
      // Local file - open in VS Code
      window.sendMessageToVSCode({
        type: "openFile",
        data: { filePath: filePath },
      });
    }
  }

  handleDownloadFileFromPanel(data) {
    // const filePath = data.filePath;
    const fileName = data.fileName;
    const base64 = data.base64;
    if (!fileName || !base64) {
      console.error("Invalid data for file download:", data);
      return;
    }
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  handleBackgroundCommandEnded(data) {
    if (
      data?.exitCode > 0 &&
      !this.isCompleted &&
      data.commandShort === this.commandContext?.command
    ) {
      // If the background command ended with an error, and this command is still running, mark it as failed
      const stderrLinesStr = data?.stderrLines
        ? data.stderrLines.join("\n")
        : "";
      this.addLogLine({
        logType: "error",
        message: `Background command "${data.command}" failed with exit code ${data.exitCode}.\n${stderrLinesStr}`,
        timestamp: new Date(),
      });
      this.completeCommand({
        success: false,
        status: `Aborted (background command failed)`,
      });
    }
  }

  handleProgressStart(data) {
    // Close any existing progress section
    if (this.currentProgressSection) {
      this.currentProgressSection.isActive = false;
      this.currentProgressSection.endTime = new Date();

      // Auto-collapse the progress section when it ends, unless user has manually toggled it
      if (
        !this.userSectionExpandState.hasOwnProperty(
          this.currentProgressSection.id,
        )
      ) {
        this.userSectionExpandState[this.currentProgressSection.id] = false;
      }
    }

    // Deactivate all previous sections (stop their spinners)
    this.logSections.forEach((section) => {
      if (section.isActive && section.type !== "progress") {
        section.isActive = false;
        section.endTime = new Date();
      }
    });

    // Also deactivate the current section if it exists
    if (this.currentSection && this.currentSection.isActive) {
      this.currentSection.isActive = false;
      this.currentSection.endTime = new Date();
    }

    // Create new progress section
    const progressSection = {
      id: this.generateId(),
      type: "progress",
      title: data.title || "Progress",
      totalSteps: data.totalSteps || data.steps || 0,
      currentStep: 0,
      progressLogs: [], // Store the latest 5 log lines
      startTime: new Date(),
      endTime: null,
      isActive: true,
      isExpanded: true,
      // Time estimation properties
      stepTimes: [], // Track time taken for each step
      estimatedRemainingTime: null,
      averageStepTime: 0,
    };

    this.currentProgressSection = progressSection;
    this.logSections = [...this.logSections, progressSection];
    this.scrollToBottom();
  }

  handleProgressStep(data) {
    if (!this.currentProgressSection) return;

    const now = new Date();
    const previousStep = this.currentProgressSection.currentStep;

    // Update step count and total if provided
    if (data.step !== undefined) {
      this.currentProgressSection.currentStep = data.step;
    } else {
      this.currentProgressSection.currentStep++;
    }

    if (data.totalSteps !== undefined || data.steps !== undefined) {
      this.currentProgressSection.totalSteps = data.totalSteps || data.steps;
    }

    // Calculate time estimation based on step progress
    this.updateTimeEstimation(previousStep, now);

    // Update the sections array to trigger reactivity
    this.logSections = [...this.logSections];
    this.scrollToBottom();
  }

  handleProgressEnd(data) {
    if (!this.currentProgressSection) return;

    // Update final step count and total if provided
    if (data.totalSteps !== undefined || data.steps !== undefined) {
      this.currentProgressSection.totalSteps = data.totalSteps || data.steps;
    }

    // Ensure current step matches total steps
    if (this.currentProgressSection.totalSteps > 0) {
      this.currentProgressSection.currentStep =
        this.currentProgressSection.totalSteps;
    }

    this.currentProgressSection.isActive = false;
    this.currentProgressSection.endTime = new Date();
    this.currentProgressSection.estimatedRemainingTime = null; // Clear estimation

    // Auto-collapse the progress section when it ends, unless user has manually toggled it
    if (
      !this.userSectionExpandState.hasOwnProperty(
        this.currentProgressSection.id,
      )
    ) {
      this.userSectionExpandState[this.currentProgressSection.id] = false;
    }

    this.currentProgressSection = null;

    // Update the sections array to trigger reactivity
    this.logSections = [...this.logSections];
    this.scrollToBottom();
  }

  updateTimeEstimation(previousStep, currentTime) {
    if (!this.currentProgressSection) return;

    const progress = this.currentProgressSection;

    // Record step completion time if this is a new step
    if (progress.currentStep > previousStep) {
      const stepTime = currentTime.getTime() - progress.startTime.getTime();
      if (progress.stepTimes.length > 0) {
        // Calculate time since last step
        const lastStepTime = progress.stepTimes[progress.stepTimes.length - 1];
        const timeSinceLastStep = currentTime.getTime() - lastStepTime;
        progress.stepTimes.push(currentTime.getTime());

        // Calculate average step duration (excluding first step which includes setup time)
        if (progress.stepTimes.length > 2) {
          const stepDurations = [];
          for (let i = 1; i < progress.stepTimes.length; i++) {
            stepDurations.push(
              progress.stepTimes[i] - progress.stepTimes[i - 1],
            );
          }
          progress.averageStepTime =
            stepDurations.reduce((a, b) => a + b, 0) / stepDurations.length;
        }
      } else {
        // First step completed
        progress.stepTimes.push(
          progress.startTime.getTime(),
          currentTime.getTime(),
        );
        progress.averageStepTime = stepTime;
      }
    }

    // Calculate estimated remaining time if we have enough data
    if (
      progress.totalSteps > 0 &&
      progress.currentStep > 0 &&
      progress.averageStepTime > 0
    ) {
      const stepsRemaining = progress.totalSteps - progress.currentStep;
      if (stepsRemaining > 0) {
        const remainingTimeMs = stepsRemaining * progress.averageStepTime;
        progress.estimatedRemainingTime =
          this.formatRemainingTime(remainingTimeMs);
      } else {
        progress.estimatedRemainingTime = "Almost done";
      }
    }
  }

  formatRemainingTime(milliseconds) {
    const totalSeconds = Math.ceil(milliseconds / 1000);

    if (totalSeconds < 60) {
      return `~${totalSeconds}s remaining`;
    } else if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (seconds === 0) {
        return `~${minutes}m remaining`;
      }
      return `~${minutes}m ${seconds}s remaining`;
    } else {
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      if (minutes === 0) {
        return `~${hours}h remaining`;
      }
      return `~${hours}h ${minutes}m remaining`;
    }
  }

  updateAutocloseStatus() {
    const coreCommand = this.getCoreCommand();
    if (!coreCommand) {
      this.isInAutocloseList = false;
      return;
    }
    this.isInAutocloseList = this.autocloseCommands.includes(coreCommand);
  }

  getCoreCommand() {
    if (!this.commandContext || !this.commandContext.command) {
      return null;
    }
    const fullCommand = this.commandContext.command;
    // Extract core command without arguments
    // Split by space and take only the parts that form the command (sf hardis:category:action)
    const parts = fullCommand.split(/\s+/);
    // Find the command parts (sf hardis:... format)
    let commandParts = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Stop when we hit an argument (starts with -)
      if (part.startsWith("-")) {
        break;
      }
      commandParts.push(part);
      // If we have 'sf hardis:...' pattern, that's our command
      if (part.includes("hardis:") && commandParts.length >= 2) {
        break;
      }
    }
    return commandParts.join(" ");
  }

  handleToggleAutoclose(event) {
    const coreCommand = this.getCoreCommand();
    if (!coreCommand) {
      return;
    }

    // Get the new checked state from the toggle event
    const isChecked = event.detail.checked;

    // Update local state
    this.isInAutocloseList = isChecked;

    // Send update to VS Code using addElements/removeElements to support multiple panels
    if (isChecked) {
      // Add command to autoclose list
      window.sendMessageToVSCode({
        type: "updateVsCodeSfdxHardisConfiguration",
        data: {
          configKey: "autocloseCommands",
          addElements: [coreCommand],
        },
      });
      // Update local cache
      if (!this.autocloseCommands.includes(coreCommand)) {
        this.autocloseCommands = [...this.autocloseCommands, coreCommand];
      }
    } else {
      // Remove command from autoclose list
      window.sendMessageToVSCode({
        type: "updateVsCodeSfdxHardisConfiguration",
        data: {
          configKey: "autocloseCommands",
          removeElements: [coreCommand],
        },
      });
      // Update local cache
      this.autocloseCommands = this.autocloseCommands.filter(
        (cmd) => cmd !== coreCommand,
      );
    }
  }
}

// End of file
