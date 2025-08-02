import { LightningElement, api, track } from 'lwc';

export default class PromptInput extends LightningElement {
    @api promptData = null;
    @track currentPrompt = null;
    @track inputValue = '';
    @track selectedValues = [];
    @track isVisible = false;
    @track error = null;

    connectedCallback() {
        // Listen for prompt events from parent
        this.addEventListener('promptrequest', this.handlePromptRequest.bind(this));
    }

    @api
    showPrompt(promptData) {
        this.promptData = promptData;
        this.currentPrompt = promptData.prompts && promptData.prompts[0] || null;
        this.isVisible = true;
        this.error = null;
        this.resetValues();
        
        if (this.currentPrompt) {
            // Set initial values
            if (this.currentPrompt.type === 'text' || this.currentPrompt.type === 'number') {
                this.inputValue = this.currentPrompt.initial || '';
            } else if (this.currentPrompt.type === 'select' || this.currentPrompt.type === 'multiselect') {
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
        return this.currentPrompt && this.currentPrompt.message || '';
    }

    get promptPlaceholder() {
        return this.currentPrompt && this.currentPrompt.placeholder || '';
    }

    get promptName() {
        return this.currentPrompt && this.currentPrompt.name || '';
    }

    get selectOptions() {
        if (!this.currentPrompt || !this.currentPrompt.choices) return [];
        
        return this.currentPrompt.choices.map(choice => ({
            label: choice.title,
            value: choice.value,
            description: choice.description || '',
            selected: choice.selected || false
        }));
    }

    get multiselectOptions() {
        if (!this.currentPrompt || !this.currentPrompt.choices) return [];
        
        return this.currentPrompt.choices.map(choice => ({
            label: choice.title,
            value: choice.value,
            description: choice.description || '',
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

    handleSelectChange(event) {
        this.selectedValues = [event.target.value];
        this.error = null;
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
        response[this.promptName] = this.isMultiselectInput ? [] : 'exitNow';
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
            if (this.selectedValues.length === 0) {
                response[promptName] = 'exitNow';
            } else {
                response[promptName] = this.selectedValues[0];
            }
        } else if (this.isMultiselectInput) {
            response[promptName] = this.selectedValues;
        }
        
        return response;
    }

    dispatchPromptResponse(response) {
        // Dispatch custom event to parent component
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
