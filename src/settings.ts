/* eslint-disable obsidianmd/ui/sentence-case */
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type ScholarPlugin from './main';
import {
	clampThresholds,
	createTopicSubscription,
	DEFAULT_FOCUS_DESCRIPTION,
	DEFAULT_FOCUS_LABEL,
	DEFAULT_KEYWORD_QUERY,
	DEFAULT_SETTINGS,
	getDefaultPiPath,
	normalizeSubscriptions,
} from './settings-data';
import { ThinkingLevel, TopicSubscription } from './types';

export class ScholarSettingTab extends PluginSettingTab {
	plugin: ScholarPlugin;

	constructor(app: App, plugin: ScholarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private async persist(redraw = false): Promise<void> {
		normalizeSubscriptions(this.plugin.settings);
		clampThresholds(this.plugin.settings);
		await this.plugin.savePluginData();
		if (redraw) {
			this.display();
		}
	}

	private renderSubscription(containerEl: HTMLElement, subscription: TopicSubscription, index: number): void {
		new Setting(containerEl).setName(subscription.focus.label || `Topic ${index + 1}`).setHeading();

		new Setting(containerEl)
			.setName('Enabled')
			.setDesc('Disable this topic without removing its saved query and seen log.')
			.addToggle((toggle) =>
				toggle.setValue(subscription.enabled).onChange(async (value) => {
					subscription.enabled = value;
					await this.persist();
				}),
			)
			.addButton((button) => {
				button.setButtonText('Remove topic').setWarning();
				if (this.plugin.settings.subscriptions.length === 1) {
					button.setDisabled(true);
				}
				button.onClick(async () => {
					if (this.plugin.settings.subscriptions.length === 1) {
						new Notice('Scholar needs at least one topic entry. Disable it instead of removing it.');
						return;
					}
					this.plugin.settings.subscriptions.splice(index, 1);
					await this.persist(true);
				});
			});

		new Setting(containerEl)
			.setName('Topic label')
			.setDesc('Short name for this subscription and the analyzer topic label.')
			.addText((text) =>
				text
					.setPlaceholder(index === 0 ? DEFAULT_FOCUS_LABEL : `Topic ${index + 1}`)
					.setValue(subscription.focus.label)
					.onChange(async (value) => {
						subscription.focus.label = value.trim() || (index === 0 ? DEFAULT_FOCUS_LABEL : `Topic ${index + 1}`);
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName('Keyword query')
			.setDesc('Primary query used for API search and local title plus abstract filtering. If left blank, source searches fall back to the topic label.')
			.addTextArea((text) => {
				text.setPlaceholder(index === 0 ? DEFAULT_KEYWORD_QUERY : subscription.focus.label || 'Topic query');
				text.setValue(subscription.keywordQuery);
				text.inputEl.rows = 6;
				text.inputEl.cols = 60;
				text.onChange(async (value) => {
					subscription.keywordQuery = value.trim();
					await this.persist();
				});
				return text;
			});

		new Setting(containerEl)
			.setName('Focus description')
			.setDesc('Optional extra guidance for the analyzer.')
			.addTextArea((text) => {
				text.setPlaceholder(index === 0 ? DEFAULT_FOCUS_DESCRIPTION : 'Optional analyzer guidance');
				text.setValue(subscription.focus.description);
				text.inputEl.rows = 4;
				text.inputEl.cols = 60;
				text.onChange(async (value) => {
					subscription.focus.description = value.trim();
					await this.persist();
				});
				return text;
			});

		new Setting(containerEl)
			.setName('PubMed query supplement')
			.setDesc('Optional PubMed-specific clause ORed into the search query. Leave blank for none.')
			.addTextArea((text) => {
				text.setPlaceholder(index === 0 ? DEFAULT_SETTINGS.subscriptions[0]?.focus.pubmedQuerySupplement ?? '' : '');
				text.setValue(subscription.focus.pubmedQuerySupplement);
				text.inputEl.rows = 3;
				text.inputEl.cols = 60;
				text.onChange(async (value) => {
					subscription.focus.pubmedQuerySupplement = value.trim();
					await this.persist();
				});
				return text;
			});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Run behavior').setHeading();

		new Setting(containerEl)
			.setName('Inbox folder')
			.setDesc('Write daily newsletter notes to this folder. Leave blank to write to the vault root.')
			.addText((text) =>
				text
					.setPlaceholder('Inbox')
					.setValue(this.plugin.settings.inboxFolder)
					.onChange(async (value) => {
						this.plugin.settings.inboxFolder = value.trim();
						await this.persist();
					}),
			);

		new Setting(containerEl)
			.setName('Run on startup')
			.setDesc('Automatically fetch papers when Obsidian finishes loading, at most once per local calendar day.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.runOnStartup).onChange(async (value) => {
					this.plugin.settings.runOnStartup = value;
					await this.persist();
				}),
			);

		new Setting(containerEl)
			.setName('Catch-up limit')
			.setDesc('Maximum number of missed days to backfill automatically.')
			.addSlider((slider) =>
				slider
					.setLimits(1, 90, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.catchupLimitDays)
					.onChange(async (value) => {
						this.plugin.settings.catchupLimitDays = value;
						await this.persist();
					}),
			);

		new Setting(containerEl).setName('Topic subscriptions').setHeading();
		new Setting(containerEl)
			.setName('Add topic')
			.setDesc('Create another subscription with its own query, analyzer guidance, and seen log section inside the shared daily newsletter.')
			.addButton((button) =>
				button.setButtonText('Add topic').onClick(async () => {
					this.plugin.settings.subscriptions.push(createTopicSubscription(`Topic ${this.plugin.settings.subscriptions.length + 1}`));
					await this.persist(true);
				}),
			);

		for (const [index, subscription] of this.plugin.settings.subscriptions.entries()) {
			this.renderSubscription(containerEl, subscription, index);
		}

		new Setting(containerEl).setName('Sources').setHeading();
		new Setting(containerEl)
			.setName('PubMed')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.sources.pubmed).onChange(async (value) => {
					this.plugin.settings.sources.pubmed = value;
					await this.persist();
				}),
			);
		new Setting(containerEl)
			.setName('BioRxiv')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.sources.biorxiv).onChange(async (value) => {
					this.plugin.settings.sources.biorxiv = value;
					await this.persist();
				}),
			);
		new Setting(containerEl)
			.setName('Europe PMC')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.sources.europepmc).onChange(async (value) => {
					this.plugin.settings.sources.europepmc = value;
					await this.persist();
				}),
			);

		new Setting(containerEl).setName('Relevance thresholds').setHeading();
		new Setting(containerEl)
			.setName('High relevance threshold')
			.setDesc('Papers at or above this score appear in the main detailed section.')
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.thresholds.high)
					.onChange(async (value) => {
						const clamped = Math.max(value, this.plugin.settings.thresholds.possible);
						this.plugin.settings.thresholds.high = clamped;
						slider.setValue(clamped);
						await this.persist();
					}),
			);
		new Setting(containerEl)
			.setName('Possible match threshold')
			.setDesc('Papers at or above this score appear in the possible match section.')
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.thresholds.possible)
					.onChange(async (value) => {
						const clamped = Math.min(value, this.plugin.settings.thresholds.high);
						this.plugin.settings.thresholds.possible = clamped;
						slider.setValue(clamped);
						await this.persist();
					}),
			);
		new Setting(containerEl)
			.setName('Show weak matches')
			.setDesc('Include low-scoring papers in a compact list.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.thresholds.showWeak).onChange(async (value) => {
					this.plugin.settings.thresholds.showWeak = value;
					await this.persist();
				}),
			);

		new Setting(containerEl).setName('Language model').setHeading();
		new Setting(containerEl)
			.setName('Pi executable')
			.setDesc('Path to the pi CLI executable. Leave as the default if pi is already in PATH.')
			.addText((text) =>
				text.setPlaceholder(getDefaultPiPath()).setValue(this.plugin.settings.llm.piPath).onChange(async (value) => {
					this.plugin.settings.llm.piPath = value.trim() || getDefaultPiPath();
					await this.persist();
				}),
			);
		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model identifier passed to pi.')
			.addText((text) =>
				text.setPlaceholder('openai-codex/gpt-5.4').setValue(this.plugin.settings.llm.model).onChange(async (value) => {
					this.plugin.settings.llm.model = value.trim() || DEFAULT_SETTINGS.llm.model;
					await this.persist();
				}),
			);
		new Setting(containerEl)
			.setName('Thinking level')
			.addDropdown((dropdown) => {
				const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
				for (const level of levels) {
					dropdown.addOption(level, level);
				}
				dropdown.setValue(this.plugin.settings.llm.thinkingLevel);
				dropdown.onChange(async (value) => {
					this.plugin.settings.llm.thinkingLevel = value as ThinkingLevel;
					await this.persist();
				});
				return dropdown;
			});

		new Setting(containerEl).setName('Optional API keys').setHeading();
		new Setting(containerEl)
			.setName('PubMed API key')
			.setDesc('Optional. Increases the PubMed rate limit.')
			.addText((text) =>
				text.setPlaceholder('NCBI API key').setValue(this.plugin.settings.pubmedApiKey).onChange(async (value) => {
					this.plugin.settings.pubmedApiKey = value.trim();
					await this.persist();
				}),
			);
	}
}
