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

	get isEditMode() {
		return this.mode === 'edit';
	}

	@track configSchema = {};
		get configEntries() {
			// Return array of { key, value, inherited, branchValue, globalValue, isEnum, isArrayEnum, isArrayText, isText, options, optionsLwc }
			if (!this.config) return [];
			const entries = [];
			for (const key of Object.keys(this.config)) {
				let inherited = false;
				let branchValue = undefined;
				let globalValue = undefined;
				if (this.isBranch && this.branchConfig && this.globalConfig) {
					branchValue = this.branchConfig[key];
					globalValue = this.globalConfig[key];
					inherited = branchValue === undefined && globalValue !== undefined;
				}
				const schema = this.configSchema[key] || { type: 'text' };
				const options = schema.options || [];
				const optionsLwc = Array.isArray(options)
					? options.map(opt => ({ label: String(opt), value: String(opt) }))
					: [];
                let valueEdit = this.editedConfig ? this.editedConfig[key] : undefined;
                let valueEditText = '';
                if (schema.type === 'array' && schema.itemType === 'text' && Array.isArray(valueEdit)) {
                    valueEditText = valueEdit.join('\n');
                } else if (schema.type === 'array' && schema.itemType === 'text') {
                    valueEditText = '';
                }
                entries.push({
                    key,
                    value: this.config[key],
                    valueEdit,
                    valueEditText,
                    inherited,
                    branchValue,
                    globalValue,
                    isEnum: schema.type === 'enum',
                    isArrayEnum: schema.type === 'array' && schema.itemType === 'enum',
                    isArrayText: schema.type === 'array' && schema.itemType === 'text',
                    isText: schema.type === 'text',
                    options,
                    optionsLwc,
                });
			}
			return entries;
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
		if (data && data.configSchema) {
			this.configSchema = data.configSchema;
		}
		// Optionally set config, branchConfig, etc. from data
		if (data && data.config) this.config = data.config;
		if (data && data.branchConfig) this.branchConfig = data.branchConfig;
		if (data && data.globalConfig) this.globalConfig = data.globalConfig;
		if (data && typeof data.isBranch === 'boolean') this.isBranch = data.isBranch;
		if (data && data.branchName) this.branchName = data.branchName;
	}

	handleInputChange(event) {
		const key = event.target.dataset.key;
		let value = event.target.value;
		const schema = this.configSchema[key] || { type: 'text' };
		if (schema.type === 'array') {
			if (schema.itemType === 'enum' && event.detail && Array.isArray(event.detail.value)) {
				value = event.detail.value;
			} else {
				// Textarea, split by lines or comma
				value = value.split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);
			}
		} else if (schema.type === 'enum') {
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
