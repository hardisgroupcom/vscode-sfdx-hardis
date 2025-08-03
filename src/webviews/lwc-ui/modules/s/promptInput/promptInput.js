import { LightningElement, api, track } from 'lwc';

export default class PromptInput extends LightningElement {
    @api promptData = null;
    @track currentPrompt = null;
    @track inputValue = '';
    @track selectedValues = [];
    @track selectedValue = ''; // Single value for select input (string identifier)
    @track selectedOptionDescription = ''; // Description for selected option
    @track isVisible = false;
    @track error = null;
    @track choiceValueMapping = {}; // Map string identifiers to original choice values
    _hasInitialFocus = false; // Track if initial focus has been set

    connectedCallback() {
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
        
        // Only perform initial focus when the prompt first becomes visible
        if (this.isVisible && this.currentPrompt && !this._hasInitialFocus) {
            this._hasInitialFocus = true;
            
            setTimeout(() => {
                let firstInput;
                
                // For button select, focus the first button
                if (this.isSelectWithButtons) {
                    firstInput = this.template.querySelector('.select-option-button');
                } else {
                    // For other inputs, focus the input/combobox but don't interfere with dropdown navigation
                    firstInput = this.template.querySelector('lightning-input, lightning-combobox');
                }
                
                if (firstInput && typeof firstInput.focus === 'function') {
                    firstInput.focus();
                }
            }, 150);
        }
    }

    disconnectedCallback() {
        // Clean up global reference
        if (typeof window !== 'undefined' && window.promptInputComponent === this) {
            window.promptInputComponent = null;
        }
    }

    @api
    initialize(initData) {
        // Handle initialization from VS Code
        if (initData && initData.prompt) {
            this.showPrompt({ prompts: [initData.prompt] });
        } else if (initData && initData.prompts) {
            this.showPrompt(initData);
        }
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
            } else if (this.currentPrompt.type === 'select') {
                // Build the options first to populate the mapping
                const options = this.selectOptions;
                
                // For single select, find the first selected choice
                const selectedChoice = this.currentPrompt.choices && this.currentPrompt.choices.find(choice => choice.selected);
                if (selectedChoice) {
                    // Find the string identifier for this choice
                    const stringIdentifier = Object.keys(this.choiceValueMapping).find(key => 
                        this.choiceValueMapping[key] === selectedChoice.value
                    );
                    
                    this.selectedValue = stringIdentifier || '';
                    this.selectedOptionDescription = this.decodeHtmlEntities(selectedChoice.description || '');
                } else {
                    // If no choice is pre-selected, default to empty
                    this.selectedValue = '';
                    this.selectedOptionDescription = '';
                }
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
        this.choiceValueMapping = {};
        this._hasInitialFocus = false; // Reset focus flag
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

    get isSelectWithButtons() {
        return this.isSelectInput && this.currentPrompt.choices && this.currentPrompt.choices.length <= 5;
    }

    get isSelectWithCombobox() {
        return this.isSelectInput && this.currentPrompt.choices && this.currentPrompt.choices.length > 5;
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

    // Helper method to decode HTML entities and strip ANSI codes
    decodeHtmlEntities(text) {
        if (!text || typeof text !== 'string') return text;
        
        // Strip ANSI color codes and escape sequences
        let cleanText = this.stripAnsiCodes(text);
        
        // Create a temporary element to decode HTML entities
        const textarea = document.createElement('textarea');
        textarea.innerHTML = cleanText;
        return textarea.value;
    }

    // Helper method to strip ANSI color codes
    stripAnsiCodes(text) {
        if (!text || typeof text !== 'string') return text;
        
        // Remove ANSI escape sequences
        return text
            .replace(/\x1b\[[0-9;]*m/g, '') // Standard ANSI codes like \x1b[96m
            .replace(/\[9[0-7]m/g, '')      // Color codes like [96m
            .replace(/\[3[0-9]m/g, '')      // Color codes like [39m
            .replace(/\[1m/g, '')           // Bold
            .replace(/\[0m/g, '')           // Reset
            .replace(/\[22m/g, '')          // Normal intensity
            .replace(/\[2[0-9]m/g, '')      // Various codes
            .replace(/\[4[0-9]m/g, '')      // Background colors
            .replace(/\[[0-9]+m/g, '')      // Any remaining numeric codes
            .replace(/\[[0-9;]+m/g, '');    // Multiple codes
    }

    get promptName() {
        return this.currentPrompt && this.currentPrompt.name || '';
    }

    get selectOptions() {
        if (!this.currentPrompt || !this.currentPrompt.choices) return [];
        
        // Reset the mapping for this prompt
        this.choiceValueMapping = {};
        
        const options = this.currentPrompt.choices.map((choice, index) => {
            const choiceTitle = choice.title || choice.label || choice.name || 'Option ' + (index + 1);
            const choiceDescription = choice.description || '';
            
            // Create a string identifier for this choice
            let stringIdentifier;
            
            if (typeof choice.value === 'string') {
                // If it's already a string, use it directly
                stringIdentifier = choice.value;
            } else {
                // If it's an object or other type, create a string identifier
                stringIdentifier = `choice${index + 1}`;
            }
            
            // Ensure unique identifier by checking if it already exists
            let uniqueIdentifier = stringIdentifier;
            let counter = 1;
            while (this.choiceValueMapping.hasOwnProperty(uniqueIdentifier)) {
                uniqueIdentifier = `${stringIdentifier}_${counter}`;
                counter++;
            }
            
            // Store the mapping from string identifier to original value
            this.choiceValueMapping[uniqueIdentifier] = choice.value;
            
            const option = {
                label: this.decodeHtmlEntities(choiceTitle),
                value: uniqueIdentifier,
                description: this.decodeHtmlEntities(choiceDescription)
            };
            
            return option;
        });
        
        return options;
    }

    // Helper method to get choice description by value (using string identifier)
    getChoiceDescription(stringIdentifier) {
        if (!this.currentPrompt || !this.currentPrompt.choices || !stringIdentifier) return '';
        
        // Find the original choice using the mapping
        const originalValue = this.choiceValueMapping[stringIdentifier];
        if (originalValue === undefined) {
            return '';
        }
        
        const choice = this.currentPrompt.choices.find(choice => {
            // Handle both object and string comparisons
            if (typeof originalValue === 'object' && typeof choice.value === 'object') {
                return JSON.stringify(choice.value) === JSON.stringify(originalValue);
            }
            return choice.value === originalValue;
        });
        
        const description = choice ? this.decodeHtmlEntities(choice.description || '') : '';
        return description;
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
        // Try to get the value from both event.target.value and event.detail.value
        const newValue = event.detail?.value ?? event.target?.value ?? '';
        this.inputValue = newValue;
        this.error = null;
    }

    handleKeyDown(event) {
        // Submit on Enter key press
        if (event.key === 'Enter' || event.keyCode === 13) {
            event.preventDefault();
            
            // For text/number inputs, ensure we capture the current value before submitting
            if (this.isTextInput || this.isNumberInput) {
                // Get the current value from the lightning-input element
                const lightningInput = event.currentTarget;
                if (lightningInput && lightningInput.value !== undefined) {
                    this.inputValue = lightningInput.value;
                }
            }
            
            // For button select, if no button is selected yet, do nothing
            if (this.isSelectWithButtons && !this.selectedValue) {
                return;
            }
            
            this.handleSubmit();
        }
        // Cancel on Escape key press
        else if (event.key === 'Escape' || event.keyCode === 27) {
            event.preventDefault();
            this.handleCancel();
        }
        // For button select, handle arrow key navigation
        else if (this.isSelectWithButtons && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            this.handleButtonNavigation(event);
        }
    }

    handleButtonNavigation(event) {
        event.preventDefault();
        const buttons = this.template.querySelectorAll('.select-option-button');
        const currentButton = event.currentTarget.closest('.select-option-button');
        const currentIndex = Array.from(buttons).indexOf(currentButton);
        
        let nextIndex = currentIndex;
        
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % buttons.length;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
        }
        
        if (buttons[nextIndex]) {
            buttons[nextIndex].focus();
        }
    }

    handleSelectChange(event) {
        // Try to get the value from both event.target.value and event.detail.value
        let newValue = event.detail?.value ?? event.target?.value ?? '';
        
        // Ensure the value is always a string
        newValue = typeof newValue === 'string' ? newValue : String(newValue || '');
        
        this.selectedValue = newValue;
        this.error = null;
        
        // Set the description for the selected option using the helper method
        this.selectedOptionDescription = this.getChoiceDescription(this.selectedValue);
    }

    handleComboboxClick(event) {
        // Handle combobox click events if needed
    }

    handleButtonSelect(event) {
        // Use currentTarget to get the button element, not the clicked child element
        const button = event.currentTarget;
        const stringIdentifier = button.dataset.value;
        
        this.selectedValue = stringIdentifier;
        this.error = null;
        
        // Set the description for the selected option using the helper method
        this.selectedOptionDescription = this.getChoiceDescription(stringIdentifier);
        
        // Auto-submit when button is clicked
        setTimeout(() => {
            this.handleSubmit();
        }, 100);
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
            // Ensure we have the latest input value before submitting
            this.updateInputValueFromDOM();
            
            const response = this.buildResponse();
            this.dispatchPromptResponse(response);
        } catch (error) {
            this.error = error.message;
        }
    }

    // Helper method to get the current value from the DOM input elements
    updateInputValueFromDOM() {
        if (this.isTextInput || this.isNumberInput) {
            const lightningInput = this.template.querySelector('lightning-input');
            if (lightningInput && lightningInput.value !== undefined) {
                this.inputValue = lightningInput.value;
            }
        }
        // For combobox, we rely on handleSelectChange to set the value correctly
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
                // Get the original value using the string identifier
                const originalValue = this.choiceValueMapping[this.selectedValue];
                
                if (originalValue !== undefined) {
                    // Create a safe, serializable copy of the original value
                    let safeValue;
                    if (typeof originalValue === 'object' && originalValue !== null) {
                        try {
                            // Create a clean serializable copy
                            safeValue = JSON.parse(JSON.stringify(originalValue));
                        } catch (error) {
                            // Fall back to string identifier if serialization fails
                            safeValue = this.selectedValue;
                        }
                    } else {
                        safeValue = originalValue;
                    }
                    response[promptName] = safeValue;
                } else {
                    response[promptName] = this.selectedValue;
                }
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
