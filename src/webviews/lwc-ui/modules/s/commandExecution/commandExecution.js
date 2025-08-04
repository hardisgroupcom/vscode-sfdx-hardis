import { LightningElement, track, api } from 'lwc';

export default class CommandExecution extends LightningElement {
    @track commandContext = null;
    @track logLines = [];
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
        this.isCompleted = false;
        this.hasError = false;
        this.startTime = new Date();
        this.endTime = null;
        this.currentSubCommands = [];
        
        // Add initial log line
        this.addLogLine({
            logType: 'action',
            message: `Command started: ${context.command || 'Unknown command'}`,
            timestamp: this.startTime
        });
    }

    @api
    addLogLine(logData) {
        const logLine = {
            id: this.generateId(),
            logType: logData.logType || 'log',
            message: this.cleanMessage(logData.message || ''),
            timestamp: logData.timestamp || new Date(),
            isSubCommand: false
        };

        this.logLines = [...this.logLines, logLine];
        
        // Update error state if this is an error log
        if (logLine.logType === 'error') {
            this.hasError = true;
        }

        // Auto-scroll to bottom after adding new log
        this.scrollToBottom();
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

        // Add log line for sub-command start
        this.addLogLine({
            logType: 'action',
            message: `Sub-command started: ${subCommand.command}`,
            timestamp: subCommand.startTime
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

        // Add log line for sub-command end
        const logType = subCommandData.success ? 'success' : 'error';
        const duration = this.calculateDuration(
            this.currentSubCommands.find(sc => sc.command === subCommandData.command)?.startTime,
            new Date()
        );

        this.addLogLine({
            logType: logType,
            message: `Sub-command ${subCommandData.success ? 'completed' : 'failed'}: ${subCommandData.command} (${duration})`,
            timestamp: new Date()
        });

        if (!subCommandData.success) {
            this.hasError = true;
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
        
        const diff = endTime.getTime() - startTime.getTime();
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
        
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    }

    handleToggleExpanded() {
        this.isExpanded = !this.isExpanded;
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
