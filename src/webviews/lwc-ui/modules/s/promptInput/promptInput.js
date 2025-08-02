import { LightningElement, api, track } from 'lwc';

export default class PromptInput extends LightningElement {
    @api promptData = null;
    @track currentPrompt = null;
    @track inputValue = '';
    @track selectedValues = [];
    @track selectedValue = ''; // Single value for select input
    @track selectedOptionDescription = ''; // Description for selected option
    @track isVisible = false;
    @track error = null;

    connectedCallback() {
        console.log("PromptInput connectedCallback");
        // Listen for prompt events from parent
        this.addEventListener('promptrequest', this.handlePromptRequest.bind(this));
        
        // Make component available globally for VS Code message handling
        if (typeof window !== 'undefined') {
            window.promptInputComponent = this;
        }
    }

    renderedCallback() {
        // Update the prompt message content manually to properly handle HTML entities
        const messageElement = this.template.querySelector('.prompt-message-content');
        if (messageElement && this.currentPrompt && this.currentPrompt.message) {
            messageElement.textContent = this.decodeHtmlEntities(this.currentPrompt.message);
        }
        
        // Focus the first input element when the prompt becomes visible
        if (this.isVisible && this.currentPrompt) {
            setTimeout(() => {
                const firstInput = this.template.querySelector('lightning-input, lightning-combobox');
                if (firstInput && typeof firstInput.focus === 'function') {
                    firstInput.focus();
                }
            }, 100);
        }
    }

    disconnectedCallback() {
        console.log("PromptInput disconnectedCallback");
        // Clean up global reference
        if (typeof window !== 'undefined' && window.promptInputComponent === this) {
            window.promptInputComponent = null;
        }
    }

    @api
    initialize(initData) {
        console.log("PromptInput initialize called with:", initData);
        // Handle initialization from VS Code
        if (initData && initData.prompt) {
            this.showPrompt({ prompts: [initData.prompt] });
        } else if (initData && initData.prompts) {
            this.showPrompt(initData);
        }
    }

    @api
    showPrompt(promptData) {
        console.log("PromptInput showPrompt called with:", promptData);
        this.promptData = promptData;
        this.currentPrompt = promptData.prompts && promptData.prompts[0] || null;
        this.isVisible = true;
        this.error = null;
        this.resetValues();
        
        console.log("Setting isVisible to true, currentPrompt:", this.currentPrompt);
        
        if (this.currentPrompt) {
            // Set initial values
            if (this.currentPrompt.type === 'text' || this.currentPrompt.type === 'number') {
                this.inputValue = this.currentPrompt.initial || '';
            } else if (this.currentPrompt.type === 'select') {
                // For single select, find the first selected choice
                const selectedChoice = this.currentPrompt.choices && this.currentPrompt.choices.find(choice => choice.selected);
                this.selectedValue = selectedChoice ? selectedChoice.value : '';
                this.selectedOptionDescription = selectedChoice ? this.decodeHtmlEntities(selectedChoice.description || '') : '';
            } else if (this.currentPrompt.type === 'multiselect') {
                this.selectedValues = this.currentPrompt.choices && this.currentPrompt.choices
                    .filter(choice => choice.selected)
                    .map(choice => choice.value) || [];
            }
        }
    }

    @api
    hidePrompt() {
        this.isVisible = false;
        this.currentPrompt = null;
        this.promptData = null;
        this.resetValues();
    }

    resetValues() {
        this.inputValue = '';
        this.selectedValues = [];
        this.selectedValue = '';
        this.selectedOptionDescription = '';
        this.error = null;
    }

    get isTextInput() {
        return this.currentPrompt && this.currentPrompt.type === 'text';
    }

    get isNumberInput() {
        return this.currentPrompt && this.currentPrompt.type === 'number';
    }

    get isSelectInput() {
        return this.currentPrompt && this.currentPrompt.type === 'select';
    }

    get isMultiselectInput() {
        return this.currentPrompt && this.currentPrompt.type === 'multiselect';
    }

    get promptMessage() {
        const message = this.currentPrompt && this.currentPrompt.message || '';
        return this.decodeHtmlEntities(message);
    }

    get promptPlaceholder() {
        const placeholder = this.currentPrompt && this.currentPrompt.placeholder || '';
        return this.decodeHtmlEntities(placeholder);
    }

    // Helper method to decode HTML entities
    decodeHtmlEntities(text) {
        if (!text || typeof text !== 'string') return text;
        
        // Create a temporary element to decode HTML entities
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }

    get promptName() {
        return this.currentPrompt && this.currentPrompt.name || '';
    }

    get isVisibleDebug() {
        console.log("isVisible getter called, value:", this.isVisible);
        return this.isVisible;
    }

    get selectOptions() {
        if (!this.currentPrompt || !this.currentPrompt.choices) return [];
        
        return this.currentPrompt.choices.map(choice => ({
            label: this.decodeHtmlEntities(choice.title),
            value: choice.value,
            description: this.decodeHtmlEntities(choice.description || ''),
            selected: choice.selected || false
        }));
    }

    get multiselectOptions() {
        if (!this.currentPrompt || !this.currentPrompt.choices) return [];
        
        return this.currentPrompt.choices.map(choice => ({
            label: this.decodeHtmlEntities(choice.title),
            value: choice.value,
            description: this.decodeHtmlEntities(choice.description || ''),
            checked: this.selectedValues.includes(choice.value)
        }));
    }

    get inputType() {
        if (this.isNumberInput) {
            return this.currentPrompt.isFloat ? 'number' : 'number';
        }
        return 'text';
    }

    get numberStep() {
        return this.currentPrompt && this.currentPrompt.isFloat ? '0.01' : '1';
    }

    handleInputChange(event) {
        this.inputValue = event.target.value;
        this.error = null;
    }

    handleKeyDown(event) {
        // Submit on Enter key press
        if (event.key === 'Enter' || event.keyCode === 13) {
            event.preventDefault();
            this.handleSubmit();
        }
        // Cancel on Escape key press
        else if (event.key === 'Escape' || event.keyCode === 27) {
            event.preventDefault();
            this.handleCancel();
        }
    }

    handleSelectChange(event) {
        this.selectedValue = event.target.value;
        this.error = null;
        
        // Find and set the description for the selected option
        if (this.currentPrompt && this.currentPrompt.choices) {
            const selectedChoice = this.currentPrompt.choices.find(choice => choice.value === this.selectedValue);
            this.selectedOptionDescription = selectedChoice ? this.decodeHtmlEntities(selectedChoice.description || '') : '';
        }
    }

    handleMultiselectChange(event) {
        const value = event.target.value;
        const isChecked = event.target.checked;
        
        if (isChecked) {
            this.selectedValues = [...this.selectedValues, value];
        } else {
            this.selectedValues = this.selectedValues.filter(v => v !== value);
        }
        this.error = null;
    }

    handleSubmit() {
        try {
            const response = this.buildResponse();
            this.dispatchPromptResponse(response);
        } catch (error) {
            this.error = error.message;
        }
    }

    handleCancel() {
        const response = {};
        if (this.isMultiselectInput) {
            response[this.promptName] = [];
        } else {
            response[this.promptName] = 'exitNow';
        }
        this.dispatchPromptResponse(response);
    }

    buildResponse() {
        const response = {};
        const promptName = this.promptName;
        
        if (this.isTextInput) {
            response[promptName] = this.inputValue;
        } else if (this.isNumberInput) {
            const value = this.inputValue;
            if (value === '' || value === null) {
                response[promptName] = null;
            } else {
                const numValue = this.currentPrompt.isFloat ? parseFloat(value) : parseInt(value, 10);
                if (isNaN(numValue)) {
                    throw new Error('Please enter a valid number');
                }
                response[promptName] = numValue;
            }
        } else if (this.isSelectInput) {
            if (!this.selectedValue || this.selectedValue === '') {
                response[promptName] = 'exitNow';
            } else {
                response[promptName] = this.selectedValue;
            }
        } else if (this.isMultiselectInput) {
            response[promptName] = this.selectedValues;
        }
        
        return response;
    }

    dispatchPromptResponse(response) {
        // Send message to VS Code via the global API
        if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
            window.sendMessageToVSCode({
                type: 'submit',
                data: response
            });
        }
        
        // Also dispatch custom event to parent component for local handling
        const responseEvent = new CustomEvent('promptresponse', {
            detail: {
                event: 'promptsResponse',
                promptsResponse: [response]
            },
            bubbles: true,
            composed: true
        });
        
        this.dispatchEvent(responseEvent);
        this.hidePrompt();
    }

    handlePromptRequest(event) {
        const promptData = event.detail;
        this.showPrompt(promptData);
    }
}
