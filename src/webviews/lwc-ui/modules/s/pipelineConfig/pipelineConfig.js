import { LightningElement, api, track } from "lwc";

/**
 * LWC to display and edit .sfdx-hardis.yml configuration (global or branch-scoped)
 * Props:
 *   config: the loaded config object (merged if branch + global)
 *   branchConfig: the branch config object (if any)
 *   globalConfig: the global config object (if any)
 *   isBranch: true if branch config is loaded
 *   branchName: name of the branch (if any)
 *   mode: 'view' | 'edit'
 */
export default class PipelineConfig extends LightningElement {
	@api config = {};
	@api branchConfig = null;
	@api globalConfig = null;
	@api isBranch = false;
	@api branchName = '';
	@track mode = 'view';
	@track editedConfig = {};
	@track sections = [];

	get isEditMode() {
		return this.mode === 'edit';
	}

	@track configSchema = {};
		get configSections() {
			// Returns array of { label, description, entries: [...] } for each section, omitting empty ones
			if (!this.config || !this.sections) return [];
			const config = this.config;
			const branchConfig = this.branchConfig;
			const globalConfig = this.globalConfig;
			const isBranch = this.isBranch;
			// configSchema is an object: { [key]: schema }
			const configSchema = this.configSchema || {};
			return (this.sections || [])
				.map(section => {
					const entries = [];
					for (const key of section.keys) {
						const schema = configSchema[key];
						if (!schema) continue;
						let inherited = false;
						let branchValue = undefined;
						let globalValue = undefined;
						if (isBranch && branchConfig && globalConfig) {
							branchValue = branchConfig[key];
							globalValue = globalConfig[key];
							inherited = branchValue === undefined && globalValue !== undefined;
						}
						let isEnum = false, isArrayEnum = false, isArrayText = false, isText = false, isBoolean = false;
						let options = [];
						let label = schema.title || key;
						let description = schema.description || '';
						let optionsLwc = [];
						// Detect type
						if (schema.enum) {
							isEnum = true;
							options = schema.enum;
							optionsLwc = schema.enum.map(opt => ({ label: String(opt), value: String(opt) }));
						} else if (schema.type === 'array' && schema.items && schema.items.enum) {
							isArrayEnum = true;
							options = schema.items.enum;
							optionsLwc = schema.items.enum.map(opt => ({ label: String(opt), value: String(opt) }));
						} else if (schema.type === 'array' && schema.items && schema.items.type === 'string') {
							isArrayText = true;
						} else if (schema.type === 'string') {
							isText = true;
						} else if (schema.type === 'boolean') {
							isBoolean = true;
						}
						let valueEdit = this.editedConfig ? this.editedConfig[key] : undefined;
						const value = config[key];
						// Always initialize valueEdit for edit mode for enums, array enums, and array text
						if (this.isEditMode) {
							if (isEnum) {
								if (valueEdit === undefined) valueEdit = value !== undefined ? value : '';
							} else if (isArrayEnum) {
								if (!Array.isArray(valueEdit)) valueEdit = Array.isArray(value) ? value : [];
							} else if (isArrayText) {
								if (!Array.isArray(valueEdit)) valueEdit = Array.isArray(value) ? value : [];
							} else if (isText) {
								if (valueEdit === undefined) valueEdit = value !== undefined ? value : '';
							} else if (isBoolean) {
								if (valueEdit === undefined) valueEdit = value !== undefined ? value : false;
							}
						}
						let valueEditText = '';
						let valueDisplay = '';
						if (isArrayEnum || isArrayText) {
							if (Array.isArray(value)) {
								valueDisplay = value;
							} else if (typeof value === 'string') {
								// fallback: split comma string
								valueDisplay = value.split(',').map(v => v.trim()).filter(Boolean);
							} else {
								valueDisplay = [];
							}
						} else {
							valueDisplay = value;
						}
						if ((isArrayText || isArrayEnum) && Array.isArray(valueEdit)) {
							valueEditText = valueEdit.join('\n');
						} else if (isArrayText || isArrayEnum) {
							valueEditText = '';
						}
						entries.push({
							key,
							label,
							description,
							value,
							valueDisplay,
							valueEdit,
							valueEditText,
							inherited,
							branchValue,
							globalValue,
							isEnum,
							isArrayEnum,
							isArrayText,
							isText,
							isBoolean,
							options,
							optionsLwc,
							hasArrayEnumValues: isArrayEnum && Array.isArray(valueDisplay) && valueDisplay.length > 0,
							hasArrayTextValues: isArrayText && Array.isArray(valueDisplay) && valueDisplay.length > 0,
						});
					}
					return {
						label: section.label,
						description: section.description,
						entries
					};
				})
				.filter(section => section.entries.length > 0);
		}

	handleEdit() {
		this.mode = 'edit';
		this.editedConfig = JSON.parse(JSON.stringify(this.config));
	}

	handleCancel() {
		this.mode = 'view';
		this.editedConfig = {};
	}

	handleSave() {
		debugger;
		// Send updated config to VS Code
		if (typeof window !== 'undefined' && window.sendMessageToVSCode) {
			window.sendMessageToVSCode({
				type: 'saveSfdxHardisConfig',
				data: {
					config: this.editedConfig,
					isBranch: this.isBranch,
					branchName: this.branchName,
				},
			});
		}
		this.mode = 'view';
	}


	@api
	initialize(data) {
		// Support both { config: {...}, ... } and { configEditorInput: {...} }
		let input = data;
		if (data && data.config && data.configSchema) {
			// Direct structure
			this.config = data.config;
			this.configSchema = data.configSchema;
			this.branchConfig = data.branchConfig || null;
			this.globalConfig = data.globalConfig || null;
			this.isBranch = typeof data.isBranch === 'boolean' ? data.isBranch : false;
			this.branchName = data.branchName || '';
			this.sections = data.sections || [];
		} else if (data && data.config) {
			// Nested under 'config'
			input = data.config;
			this.config = input.config;
			this.configSchema = input.configSchema;
			this.branchConfig = input.branchConfig || null;
			this.globalConfig = input.globalConfig || null;
			this.isBranch = typeof input.isBranch === 'boolean' ? input.isBranch : false;
			this.branchName = input.branchName || '';
			this.sections = input.sections || [];
		}
	}

	handleInputChange(event) {
		const key = event.target.dataset.key;
		let value = event.target.value;
		// Find schema from configSchema object
		let schema = this.configSchema && this.configSchema[key] ? this.configSchema[key] : { type: 'string' };
		if (schema.type === 'array') {
			if (schema.items && schema.items.enum && event.detail && Array.isArray(event.detail.value)) {
				value = event.detail.value;
			} else {
				// Textarea, split by lines or comma
				value = value.split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);
			}
		} else if (schema.enum) {
			value = event.detail && event.detail.value !== undefined ? event.detail.value : value;
		}
		this.editedConfig[key] = value;
	}

	// For template: expose input type checks as properties for each entry
	getInputTypeEnum(entry) {
		const schema = this.configSchema[entry.key] || { type: 'text' };
		return schema.type === 'enum';
	}

	getInputTypeArrayEnum(entry) {
		const schema = this.configSchema[entry.key] || { type: 'text' };
		return schema.type === 'array' && schema.itemType === 'enum';
	}

	getInputTypeArrayText(entry) {
		const schema = this.configSchema[entry.key] || { type: 'text' };
		return schema.type === 'array' && schema.itemType === 'text';
	}

	getInputTypeText(entry) {
		const schema = this.configSchema[entry.key] || { type: 'text' };
		return schema.type === 'text';
	}
}
