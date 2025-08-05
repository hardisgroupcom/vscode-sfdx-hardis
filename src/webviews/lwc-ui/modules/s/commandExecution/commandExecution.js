import { LightningElement, track, api } from 'lwc';

export default class CommandExecution extends LightningElement {
    @track commandContext = null;
    @track commandDocUrl = null;
    @track logLines = [];
    @track logSections = [];
    @track currentSection = null;
    @track isCompleted = false;
    @track hasError = false;
    @track startTime = null;
    @track endTime = null;
    @track currentSubCommands = [];
    @track isWaitingForAnswer = false;
    
    connectedCallback() {
        // Make component available globally for VS Code message handling
        if (typeof window !== 'undefined') {
            window.commandExecutionComponent = this;
        }
    }

    disconnectedCallback() {
        // Clean up global reference
        if (typeof window !== 'undefined' && window.commandExecutionComponent === this) {
            window.commandExecutionComponent = null;
        }
    }

    @api
    initialize(initData) {
        if (initData && initData.context) {
            this.initializeCommand(initData.context);
        } else if (initData) {
            // Handle direct context data
            this.initializeCommand(initData);
        }
    }

    @api
    handleMessage(messageType, data) {
        switch (messageType) {
            case 'initializeCommand':
                this.initializeCommand(data);
                break;
            case 'addLogLine':
                this.addLogLine(data);
                break;
            case 'addSubCommandStart':
                this.addSubCommandStart(data);
                break;
            case 'addSubCommandEnd':
                this.addSubCommandEnd(data);
                break;
            case 'completeCommand':
                this.completeCommand(data);
                break;
            default:
                console.log('Unknown message type:', messageType, data);
        }
    }

    @api
    initializeCommand(context) {
        this.commandContext = context;
        this.commandDocUrl = context.commandDocUrl || null;
        this.logLines = [];
        this.logSections = [];
        this.currentSection = null;
        this.isCompleted = false;
        this.hasError = false;
        this.isWaitingForAnswer = false;
        this.startTime = new Date();
        this.endTime = null;
        this.currentSubCommands = [];
        
        // Add initial "Started" action log
        this.addLogLine({
            logType: 'action',
            message: `Started ${context.command || 'SFDX Hardis Command'}`,
            timestamp: this.startTime
        });
    }

    @api
    addLogLine(logData) {
        // Skip logs that contain "Please see detailed .* log in" pattern
        if (logData.message && /Please see detailed .* log in/i.test(logData.message)) {
            return;
        }
        
        const logLine = {
            id: this.generateId(),
            logType: logData.logType || 'log',
            message: this.cleanMessage(logData.message || ''),
            timestamp: logData.timestamp ? 
                (logData.timestamp instanceof Date ? logData.timestamp : new Date(logData.timestamp)) : 
                new Date(),
            isSubCommand: logData.isSubCommand || false,
            subCommandId: logData.subCommandId || null,
            isQuestion: logData.isQuestion || false,
            isAnswer: this.isWaitingForAnswer
        };

        // Handle question/answer logic
        if (logLine.isQuestion) {
            this.isWaitingForAnswer = true;
        } else if (this.isWaitingForAnswer && !logLine.isQuestion) {
            // This is an answer
            logLine.isAnswer = true;
            this.isWaitingForAnswer = false;
            
            // Try to parse and prettify JSON answers
            logLine.formattedMessage = this.formatAnswerMessage(logLine.message);
        }

        // If this is an action log, close current section and start a new one
        if (logLine.logType === 'action') {
            this.closeCurrentSection();
            this.startNewSection(logLine);
        } else {
            // Add log to current section
            this.addLogToCurrentSection(logLine);
        }

        this.logLines = [...this.logLines, logLine];
        
        // Update error state if this is an error log
        if (logLine.logType === 'error') {
            this.hasError = true;
        }

        // Auto-scroll to bottom after adding new log
        this.scrollToBottom();
    }

    closeCurrentSection() {
        if (this.currentSection) {
            this.currentSection.endTime = new Date();
            this.currentSection.isActive = false;
            
            // Keep empty sections but mark them as non-expandable
            if (this.currentSection.logs.length === 0) {
                this.currentSection.isExpanded = false;
                this.currentSection.isEmpty = true;
            }
        }
    }

    startNewSection(actionLog) {
        const iconInfo = this.getLogTypeIcon(actionLog.logType, actionLog.isQuestion, actionLog.isAnswer);
        const newSection = {
            id: this.generateId(),
            actionLog: {
                ...actionLog,
                iconName: iconInfo.iconName,
                iconVariant: iconInfo.variant,
                useSpinner: this.shouldUseSpinner(actionLog),
                formattedTimestamp: this.formatTimestamp(actionLog.timestamp),
                cssClass: this.getLogTypeClass(actionLog.logType)
            },
            logs: [],
            startTime: actionLog.timestamp,
            endTime: null,
            isActive: true,
            isExpanded: true,
            hasError: false,
            isQuestion: actionLog.isQuestion || false
        };

        this.currentSection = newSection;
        this.logSections = [...this.logSections, newSection];
    }

    addLogToCurrentSection(logLine) {
        if (!this.currentSection) {
            // If no current section, create a default one
            this.startNewSection({
                id: this.generateId(),
                logType: 'action',
                message: 'Logs',
                timestamp: new Date()
            });
        }

        const iconInfo = this.getLogTypeIcon(logLine.logType, logLine.isQuestion, logLine.isAnswer);
        const formattedLog = {
            ...logLine,
            iconName: iconInfo.iconName,
            iconVariant: iconInfo.variant,
            useSpinner: this.shouldUseSpinner(logLine),
            formattedTimestamp: this.formatTimestamp(logLine.timestamp),
            cssClass: this.getLogTypeClass(logLine.logType)
        };

        this.currentSection.logs = [...this.currentSection.logs, formattedLog];
        
        // Update section error state
        if (logLine.logType === 'error') {
            this.currentSection.hasError = true;
        }

        // Update the sections array to trigger reactivity
        this.logSections = [...this.logSections];
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
            isExpanded: false
        };

        this.currentSubCommands = [...this.currentSubCommands, subCommand];

        // Add log line for sub-command start (this will be replaced when sub-command ends)
        this.addLogLine({
            logType: 'log',
            message: `Running: ${subCommand.command}`,
            timestamp: subCommand.startTime,
            isSubCommand: true,
            subCommandId: subCommand.id
        });
    }

    @api
    addSubCommandEnd(subCommandData) {
        const updatedSubCommands = this.currentSubCommands.map(subCmd => {
            if (subCmd.command === subCommandData.command) {
                return {
                    ...subCmd,
                    endTime: new Date(),
                    success: subCommandData.success,
                    result: subCommandData.result
                };
            }
            return subCmd;
        });

        this.currentSubCommands = updatedSubCommands;
        
        const subCommand = updatedSubCommands.find(sc => sc.command === subCommandData.command);
        if (!subCommand) return;

        const duration = this.calculateDuration(subCommand.startTime, subCommand.endTime);
        
        // Replace the sub-command start log line with the completed one
        this.replaceSubCommandLog(subCommand.id, {
            logType: subCommandData.success ? 'success' : 'error',
            message: `${subCommandData.command} (${duration})`,
            timestamp: subCommand.endTime,
            isSubCommand: true,
            subCommandId: subCommand.id
        });

        if (!subCommandData.success) {
            this.hasError = true;
        }
    }

    replaceSubCommandLog(subCommandId, newLogData) {
        // Find and replace the sub-command log in the current section
        if (this.currentSection && this.currentSection.logs) {
            const logIndex = this.currentSection.logs.findIndex(log => 
                log.isSubCommand && log.subCommandId === subCommandId
            );
            
            if (logIndex !== -1) {
                const iconInfo = this.getLogTypeIcon(newLogData.logType, newLogData.isQuestion, newLogData.isAnswer);
                const updatedLog = {
                    ...this.currentSection.logs[logIndex],
                    logType: newLogData.logType,
                    message: newLogData.message,
                    timestamp: newLogData.timestamp,
                    iconName: iconInfo.iconName,
                    iconVariant: iconInfo.variant,
                    useSpinner: this.shouldUseSpinner({...this.currentSection.logs[logIndex], ...newLogData}),
                    formattedTimestamp: this.formatTimestamp(newLogData.timestamp),
                    cssClass: this.getLogTypeClass(newLogData.logType)
                };
                
                this.currentSection.logs[logIndex] = updatedLog;
                
                // Update section error state if needed
                if (newLogData.logType === 'error') {
                    this.currentSection.hasError = true;
                }
                
                // Update the sections array to trigger reactivity
                this.logSections = [...this.logSections];
            }
        }
        
        // Also update the main logLines array
        const mainLogIndex = this.logLines.findIndex(log => 
            log.isSubCommand && log.subCommandId === subCommandId
        );
        
        if (mainLogIndex !== -1) {
            this.logLines[mainLogIndex] = {
                ...this.logLines[mainLogIndex],
                ...newLogData
            };
            this.logLines = [...this.logLines];
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
        
        const duration = this.calculateDuration(this.startTime, this.endTime);
        const logType = success ? 'success' : 'error';
        
        // Create completion message based on status
        let completionMessage = `Command ${success ? 'completed successfully' : 'failed'}`;
        if (status) {
            completionMessage = `Command ${status}`;
        }
        completionMessage += ` (${duration})`;
        
        this.addLogLine({
            logType: logType,
            message: completionMessage,
            timestamp: this.endTime
        });

        if (!success) {
            this.hasError = true;
        }
    }

    get commandTitle() {
        if (!this.commandContext) return 'Command Execution';
        
        const command = this.commandContext.command || 'Unknown command';
        const status = this.isCompleted 
            ? (this.hasError ? 'Failed' : 'Completed')
            : 'Running';
        
        return `${command} - ${status}`;
    }

    get commandDuration() {
        if (!this.startTime) return '';
        
        const endTime = this.endTime || new Date();
        return this.calculateDuration(this.startTime, endTime);
    }

    get statusIcon() {
        if (!this.isCompleted) {
            return null; // Will use spinner instead
        }
        return this.hasError ? 
            { iconName: 'utility:error', variant: 'error' } : 
            { iconName: 'utility:success', variant: 'success' };
    }

    get useSpinner() {
        return !this.isCompleted;
    }

    get statusClass() {
        if (!this.isCompleted) {
            return 'slds-text-color_weak';
        }
        return this.hasError ? 'slds-text-color_error' : 'slds-text-color_success';
    }

    get filteredLogLines() {
        return this.logLines
            .filter(log => log.message.trim() !== '')
            .map(log => {
                const iconInfo = this.getLogTypeIcon(log.logType, log.isQuestion, log.isAnswer);
                return {
                    ...log,
                    iconName: iconInfo.iconName,
                    iconVariant: iconInfo.variant,
                    useSpinner: this.shouldUseSpinner(log),
                    formattedTimestamp: this.formatTimestamp(log.timestamp),
                    cssClass: this.getLogTypeClass(log.logType)
                };
            });
    }

    get logSectionsForDisplay() {
        return this.logSections.map(section => ({
            ...section,
            duration: this.calculateSectionDuration(section),
            sectionStatusIcon: section.isQuestion && !this.isWaitingForAnswer ? 
                { iconName: 'utility:question', variant: 'warning' } :
                section.hasError ? 
                { iconName: 'utility:error', variant: 'error' } : 
                section.isActive ? null : 
                { iconName: 'utility:success', variant: 'success' }, // null for active = use spinner
            sectionUseSpinner: section.isActive || (section.isQuestion && this.isWaitingForAnswer),
            sectionStatusClass: section.hasError ? 'slds-text-color_error' : 
                               section.isActive ? 'slds-text-color_weak' : 'slds-text-color_success',
            hasLogs: section.logs && section.logs.length > 0,
            showToggle: section.logs && section.logs.length > 0,
            isEmpty: section.isEmpty || (section.logs && section.logs.length === 0)
        }));
    }

    calculateDuration(startTime, endTime) {
        if (!startTime || !endTime) return '';
        
        // Ensure we have Date objects
        const start = startTime instanceof Date ? startTime : new Date(startTime);
        const end = endTime instanceof Date ? endTime : new Date(endTime);
        
        // Check if dates are valid
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
        
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
        if (!section.startTime) return '';
        
        const startTime = section.startTime instanceof Date ? section.startTime : new Date(section.startTime);
        const endTime = section.endTime ? 
            (section.endTime instanceof Date ? section.endTime : new Date(section.endTime)) : 
            new Date();
            
        return this.calculateDuration(startTime, endTime);
    }

    cleanMessage(message) {
        if (!message || typeof message !== 'string') return '';
        
        // Remove ANSI escape codes
        return message
            .replace(/\x1b\[[0-9;]*m/g, '') // Standard ANSI codes
            .replace(/\[9[0-7]m/g, '')      // Color codes
            .replace(/\[3[0-9]m/g, '')      // Color codes
            .replace(/\[1m/g, '')           // Bold
            .replace(/\[0m/g, '')           // Reset
            .replace(/\[22m/g, '')          // Normal intensity
            .replace(/\[2[0-9]m/g, '')      // Various codes
            .replace(/\[4[0-9]m/g, '')      // Background colors
            .replace(/\[[0-9]+m/g, '')      // Any remaining numeric codes
            .replace(/\[[0-9;]+m/g, '')     // Multiple codes
            .trim();
    }

    formatAnswerMessage(message) {
        // Try to parse as JSON and make it human-readable
        try {
            const parsed = JSON.parse(message);
            return this.makeJsonHumanReadable(parsed);
        } catch (e) {
            // Not valid JSON, return original message
            return message;
        }
    }

    makeJsonHumanReadable(obj) {
        if (obj === null) return 'No value';
        if (obj === undefined) return 'Not defined';
        if (typeof obj === 'boolean') return obj ? 'Yes' : 'No';
        if (typeof obj === 'string') return obj;
        if (typeof obj === 'number') return obj.toString();
        
        if (Array.isArray(obj)) {
            if (obj.length === 0) return 'No items';
            if (obj.length === 1) return this.makeJsonHumanReadable(obj[0]);
            
            // For arrays, create a readable list
            const items = obj.map((item, index) => {
                const readable = this.makeJsonHumanReadable(item);
                return `${index + 1}. ${readable}`;
            }).join('\n');
            
            return `${obj.length} items:\n${items}`;
        }
        
        if (typeof obj === 'object') {
            const entries = Object.entries(obj);
            if (entries.length === 0) return 'No properties';
            
            // Convert object properties to human-readable format
            const readable = entries.map(([key, value]) => {
                const humanKey = this.humanizeKey(key);
                const humanValue = this.makeJsonHumanReadable(value);
                
                // Handle different value types with appropriate formatting
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    return `${humanKey}:\n  ${humanValue.split('\n').join('\n  ')}`;
                } else {
                    return `${humanKey}: ${humanValue}`;
                }
            }).join('\n');
            
            return readable;
        }
        
        return obj.toString();
    }

    humanizeKey(key) {
        // Convert camelCase, snake_case, or kebab-case to human-readable format
        return key
            .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
            .replace(/[_-]/g, ' ') // snake_case and kebab-case
            .toLowerCase()
            .replace(/^\w/, c => c.toUpperCase()) // Capitalize first letter
            .replace(/\bid\b/gi, 'ID') // Special case for ID
            .replace(/\burl\b/gi, 'URL') // Special case for URL
            .replace(/\bapi\b/gi, 'API') // Special case for API
            .replace(/\bsfdx\b/gi, 'SFDX') // Special case for SFDX
            .replace(/\bsf\b/gi, 'SF'); // Special case for SF
    }

    generateId() {
        return 'log_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    getLogTypeClass(logType) {
        switch (logType) {
            case 'error':
                return 'log-error';
            case 'warning':
                return 'log-warning';
            case 'success':
                return 'log-success';
            case 'action':
                return 'log-action';
            case 'log':
            default:
                return 'log-default';
        }
    }

    getLogTypeIcon(logType, isQuestion = false, isAnswer = false) {
        if (isQuestion) {
            return { iconName: 'utility:question', variant: 'warning' };
        }
        if (isAnswer) {
            return { iconName: 'utility:reply', variant: 'brand' };
        }
        
        switch (logType) {
            case 'error':
                return { iconName: 'utility:error', variant: 'error' };
            case 'warning':
                return { iconName: 'utility:warning', variant: 'warning' };
            case 'success':
                return { iconName: 'utility:success', variant: 'success' };
            case 'action':
                return { iconName: 'utility:touch_action', variant: 'brand' };
            case 'log':
            default:
                return { iconName: 'utility:info', variant: 'inverse' };
        }
    }

    shouldUseSpinner(log) {
        // Use spinner for running sub-commands (those that contain "Running:")
        if (log.isSubCommand && log.message && log.message.includes('Running:')) {
            return true;
        }
        // Use spinner for questions that are waiting for an answer
        if (log.isQuestion && this.isWaitingForAnswer) {
            return true;
        }
        return false;
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return '';
        
        try {
            const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleTimeString();
        } catch (error) {
            console.error('Error formatting timestamp:', error, timestamp);
            return '';
        }
    }

    handleToggleSection(event) {
        const sectionId = event.target.dataset.sectionId;
        if (sectionId) {
            this.logSections = this.logSections.map(section => {
                if (section.id === sectionId && section.logs && section.logs.length > 0) {
                    return { ...section, isExpanded: !section.isExpanded };
                }
                return section;
            });
        }
    }

    scrollToBottom() {
        // Use setTimeout to ensure DOM has updated
        setTimeout(() => {
            const logContainer = this.template.querySelector('.log-container');
            if (logContainer) {
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        }, 50);
    }

    get hasDocumentation() {
        return this.commandDocUrl && this.commandDocUrl.trim() !== '';
    }

    handleOpenDocumentation() {
        if (this.commandDocUrl) {
            // Send message to VS Code to open the documentation URL
            if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
                window.sendMessageToVSCode({
                    type: 'openUrl',
                    data: { url: this.commandDocUrl }
                });
            }
        }
    }

}
