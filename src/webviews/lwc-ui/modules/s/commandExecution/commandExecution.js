import { LightningElement, track, api } from 'lwc';

export default class CommandExecution extends LightningElement {
    @track commandContext = null;
    @track logLines = [];
    @track logSections = [];
    @track currentSection = null;
    @track isCompleted = false;
    @track hasError = false;
    @track startTime = null;
    @track endTime = null;
    @track currentSubCommands = [];
    @track isExpanded = true;

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
        console.log('CommandExecution handleMessage:', messageType, data);
        
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
                this.completeCommand(data.success);
                break;
            default:
                console.log('Unknown message type:', messageType, data);
        }
    }

    @api
    initializeCommand(context) {
        this.commandContext = context;
        this.logLines = [];
        this.logSections = [];
        this.currentSection = null;
        this.isCompleted = false;
        this.hasError = false;
        this.startTime = new Date();
        this.endTime = null;
        this.currentSubCommands = [];
        
        // Add initial "Initializing" action log
        this.addLogLine({
            logType: 'action',
            message: `Initializing ${context.command || 'SFDX Hardis Command'}`,
            timestamp: this.startTime
        });
    }

    @api
    addLogLine(logData) {
        const logLine = {
            id: this.generateId(),
            logType: logData.logType || 'log',
            message: this.cleanMessage(logData.message || ''),
            timestamp: logData.timestamp ? 
                (logData.timestamp instanceof Date ? logData.timestamp : new Date(logData.timestamp)) : 
                new Date(),
            isSubCommand: logData.isSubCommand || false,
            subCommandId: logData.subCommandId || null
        };

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
        if (this.currentSection && this.currentSection.logs.length > 0) {
            this.currentSection.endTime = new Date();
            this.currentSection.isActive = false;
        }
    }

    startNewSection(actionLog) {
        const newSection = {
            id: this.generateId(),
            actionLog: {
                ...actionLog,
                iconName: this.getLogTypeIcon(actionLog.logType),
                formattedTimestamp: this.formatTimestamp(actionLog.timestamp),
                cssClass: this.getLogTypeClass(actionLog.logType)
            },
            logs: [],
            startTime: actionLog.timestamp,
            endTime: null,
            isActive: true,
            isExpanded: true,
            hasError: false
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

        const formattedLog = {
            ...logLine,
            iconName: this.getLogTypeIcon(logLine.logType),
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
            message: `⏳ Running: ${subCommand.command}`,
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
        const statusIcon = subCommandData.success ? '✅' : '❌';
        
        // Replace the sub-command start log line with the completed one
        this.replaceSubCommandLog(subCommand.id, {
            logType: subCommandData.success ? 'success' : 'error',
            message: `${statusIcon} ${subCommandData.success ? 'Completed' : 'Failed'}: ${subCommandData.command} (${duration})`,
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
                const updatedLog = {
                    ...this.currentSection.logs[logIndex],
                    logType: newLogData.logType,
                    message: newLogData.message,
                    timestamp: newLogData.timestamp,
                    iconName: this.getLogTypeIcon(newLogData.logType),
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
    completeCommand(success = true) {
        this.isCompleted = true;
        this.endTime = new Date();
        
        const duration = this.calculateDuration(this.startTime, this.endTime);
        const logType = success ? 'success' : 'error';
        
        this.addLogLine({
            logType: logType,
            message: `Command ${success ? 'completed successfully' : 'failed'} (${duration})`,
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
            return 'utility:clock';
        }
        return this.hasError ? 'utility:error' : 'utility:success';
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
            .map(log => ({
                ...log,
                iconName: this.getLogTypeIcon(log.logType),
                formattedTimestamp: this.formatTimestamp(log.timestamp),
                cssClass: this.getLogTypeClass(log.logType)
            }));
    }

    get logSectionsForDisplay() {
        return this.logSections.map(section => ({
            ...section,
            duration: this.calculateSectionDuration(section),
            sectionStatusIcon: section.hasError ? 'utility:error' : 
                               section.isActive ? 'utility:clock' : 'utility:success',
            sectionStatusClass: section.hasError ? 'slds-text-color_error' : 
                               section.isActive ? 'slds-text-color_weak' : 'slds-text-color_success',
            toggleIcon: section.isExpanded ? 'utility:chevronup' : 'utility:chevrondown'
        }));
    }

    get subCommandsCount() {
        return this.currentSubCommands.length;
    }

    get completedSubCommandsCount() {
        return this.currentSubCommands.filter(sc => sc.endTime !== null).length;
    }

    get progressBarStyle() {
        if (this.subCommandsCount === 0) return 'width: 0%';
        const percentage = (this.completedSubCommandsCount / this.subCommandsCount) * 100;
        return `width: ${percentage}%`;
    }

    get toggleIcon() {
        return this.isExpanded ? 'utility:chevronup' : 'utility:chevrondown';
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

    getLogTypeIcon(logType) {
        switch (logType) {
            case 'error':
                return 'utility:error';
            case 'warning':
                return 'utility:warning';
            case 'success':
                return 'utility:success';
            case 'action':
                return 'utility:touch_action';
            case 'log':
            default:
                return 'utility:info';
        }
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

    handleToggleExpanded() {
        this.isExpanded = !this.isExpanded;
    }

    handleToggleSection(event) {
        const sectionId = event.target.dataset.sectionId;
        if (sectionId) {
            this.logSections = this.logSections.map(section => {
                if (section.id === sectionId) {
                    return { ...section, isExpanded: !section.isExpanded };
                }
                return section;
            });
        }
    }

    handleClearLogs() {
        if (this.isCompleted) {
            this.logLines = this.logLines.filter(log => 
                log.logType === 'action' && (
                    log.message.includes('Command started') || 
                    log.message.includes('Command completed') || 
                    log.message.includes('Command failed')
                )
            );
            
            // Also clear sections except for command start/end
            this.logSections = this.logSections.filter(section => 
                section.actionLog.message.includes('Command started') || 
                section.actionLog.message.includes('Command completed') || 
                section.actionLog.message.includes('Command failed')
            );
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
}
