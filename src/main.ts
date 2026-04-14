import { Notice, Plugin } from 'obsidian';
import { runPipelineForDateRange } from './pipeline';
import { mergeSettings } from './settings-data';
import { ScholarSettingTab } from './settings';
import { PluginData, ScholarSettings } from './types';
import { getClampedCatchupStart, getDaysBetween, getYesterdayDateString, isSameLocalDay, toDateString } from './utils/dates';
import { getErrorMessage } from './utils/strings';

export default class ScholarPlugin extends Plugin {
	settings: ScholarSettings = mergeSettings();
	lastRunTimestamp: string | null = null;
	private isRunning = false;

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.addSettingTab(new ScholarSettingTab(this.app, this));

		this.addRibbonIcon('newspaper', 'Scholar: fetch papers', () => {
			void this.runScheduled(true);
		});

		this.addCommand({
			id: 'scholar-run',
			name: 'Fetch papers and generate newsletter',
			callback: () => {
				void this.runScheduled(true);
			},
		});

		if (this.settings.runOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				void this.runScheduled(false);
			});
		}
	}

	private getDatesToProcess(force: boolean, now: Date): string[] {
		if (!this.lastRunTimestamp) {
			return [force ? toDateString(now) : getYesterdayDateString(now)];
		}

		const lastRun = new Date(this.lastRunTimestamp);
		if (Number.isNaN(lastRun.getTime())) {
			return [force ? toDateString(now) : getYesterdayDateString(now)];
		}

		const catchupStart = getClampedCatchupStart(lastRun, now, this.settings.catchupLimitDays);
		const dates = getDaysBetween(catchupStart, now);
		if (dates.length === 0 && force) {
			return [toDateString(now)];
		}

		return dates;
	}

	async runScheduled(force: boolean): Promise<void> {
		if (this.isRunning) {
			if (force) {
				new Notice('Scholar is already running.');
			}
			return;
		}

		const now = new Date();
		if (!force && this.lastRunTimestamp) {
			const lastRun = new Date(this.lastRunTimestamp);
			if (!Number.isNaN(lastRun.getTime()) && isSameLocalDay(lastRun, now)) {
				return;
			}
		}

		const datesToProcess = this.getDatesToProcess(force, now);
		if (datesToProcess.length === 0) {
			return;
		}

		this.isRunning = true;
		try {
			for (const date of datesToProcess) {
				new Notice(`Scholar: processing ${date}...`);
				await runPipelineForDateRange(this.app, this.settings, date, date);
			}

			this.lastRunTimestamp = now.toISOString();
			await this.savePluginData();
			new Notice(`Scholar: finished ${datesToProcess.length} run${datesToProcess.length === 1 ? '' : 's'}.`);
		} catch (error) {
			console.error('Scholar: pipeline failed.', error);
			new Notice(`Scholar: ${getErrorMessage(error)}`);
		} finally {
			this.isRunning = false;
		}
	}

	async loadPluginData(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<PluginData> | null;
		this.lastRunTimestamp = loaded?.lastRunTimestamp ?? null;
		this.settings = mergeSettings(loaded?.settings);
	}

	async savePluginData(): Promise<void> {
		const data: PluginData = {
			lastRunTimestamp: this.lastRunTimestamp,
			settings: this.settings,
		};
		await this.saveData(data);
	}
}
