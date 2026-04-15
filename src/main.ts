import { Notice, Plugin } from 'obsidian';
import { commitSeenEntries, runPipelineForDateRange } from './pipeline';
import { writeCombinedNewsletter } from './pipeline/newsletter';
import { analyzeAdjacentWithPi } from './pipeline/analyzer';
import { applyKeywordFilter, matchesPaper, parseQuery } from './pipeline/keywordFilter';
import { getEnabledSubscriptions, mergeSettings, normalizeSubscriptions } from './settings-data';
import { ScholarSettingTab } from './settings';
import { Paper, PluginData, ScholarSettings, ScoredPaper, TopicRunFailure, TopicRunResult, TopicSubscription } from './types';
import { getClampedCatchupStart, getDaysBetween, getYesterdayDateString, isSameLocalDay, toDateString } from './utils/dates';
import { getErrorMessage } from './utils/strings';
import { getPaperKeys } from './utils/seenLog';

function deduplicatePapers(papers: Paper[]): Paper[] {
	const seen = new Set<string>();
	return papers.filter((paper) => {
		const keys = getPaperKeys(paper);
		if (keys.some((key) => seen.has(key))) {
			return false;
		}
		for (const key of keys) {
			seen.add(key);
		}
		return true;
	});
}

async function buildAdjacentResults(
	results: TopicRunResult[],
	activeSubscriptions: TopicSubscription[],
	settings: ScholarSettings,
): Promise<ScoredPaper[]> {
	const adjacentQuery = settings.adjacentQuery.trim();
	if (!adjacentQuery) {
		return [];
	}

	// Collect paper keys for all subscription-matched papers so we can exclude them.
	const matchedKeys = new Set<string>();
	for (const result of results) {
		for (const paper of result.scored) {
			for (const key of getPaperKeys(paper)) {
				matchedKeys.add(key);
			}
		}
	}

	// Build the candidate pool: papers rejected by every subscription, deduplicated.
	const allRejected = deduplicatePapers(results.flatMap((result) => result.rejectedPapers));

	// Remove any paper that was actually matched by a subscription (guards against
	// edge cases where the same paper appears in both scored and rejected lists).
	const unmatched = allRejected.filter((paper) => !getPaperKeys(paper).some((key) => matchedKeys.has(key)));

	// Hard filter by the user's adjacent-interest query.
	const candidates = applyKeywordFilter(unmatched, adjacentQuery);
	if (candidates.length === 0) {
		return [];
	}

	// Score for methodological/conceptual transfer value.
	const scored = await analyzeAdjacentWithPi(candidates, settings, activeSubscriptions);

	// Return only papers above the display threshold, sorted by score.
	const parsedCoreQueries = activeSubscriptions.map((s) => parseQuery(s.keywordQuery));
	return scored
		.filter((paper) => {
			// Final guard: skip anything that actually matches a subscription's core query.
			if (parsedCoreQueries.some((q) => matchesPaper(paper, q))) {
				return false;
			}
			return paper.score >= settings.thresholds.possible;
		})
		.sort((a, b) => b.score - a.score);
}

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

		const activeSubscriptions = getEnabledSubscriptions(this.settings);
		if (activeSubscriptions.length === 0) {
			if (force) {
				new Notice('Scholar has no enabled topic subscriptions.');
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
		let completedRuns = 0;
		let writtenNewsletters = 0;
		const allFailures: string[] = [];

		try {
			for (const date of datesToProcess) {
				const results: TopicRunResult[] = [];
				const failures: TopicRunFailure[] = [];

				for (const subscription of activeSubscriptions) {
					new Notice(`Scholar: processing ${date} (${subscription.focus.label})...`);
					try {
						const result = await runPipelineForDateRange(this.app, this.settings, subscription, date, date);
						results.push(result);
						completedRuns += 1;
					} catch (error) {
						const message = getErrorMessage(error);
						failures.push({ subscription, message });
						allFailures.push(`${date} — ${subscription.focus.label}: ${message}`);
						console.error(`Scholar: pipeline failed for ${subscription.focus.label} on ${date}.`, error);
					}
				}

				if (results.length === 0 && failures.length > 0) {
					continue;
				}

				let adjacent: ScoredPaper[] = [];
				try {
					adjacent = await buildAdjacentResults(results, activeSubscriptions, this.settings);
				} catch (error) {
					console.warn('Scholar: adjacent-science analysis failed, continuing without it.', error);
				}

				await writeCombinedNewsletter(this.app, this.settings, date, results, failures, adjacent);
				writtenNewsletters += 1;

				for (const result of results) {
					await commitSeenEntries(this.app, result.subscription, result.seenPapersToAppend, date);
				}
			}

			if (allFailures.length === 0) {
				this.lastRunTimestamp = now.toISOString();
				await this.savePluginData();
				new Notice(`Scholar: finished ${writtenNewsletters} newsletter${writtenNewsletters === 1 ? '' : 's'}.`);
				return;
			}

			new Notice(`Scholar: wrote ${writtenNewsletters} newsletter${writtenNewsletters === 1 ? '' : 's'} and completed ${completedRuns} topic run${completedRuns === 1 ? '' : 's'}, but ${allFailures.length} failed. Check the console.`);
		} finally {
			this.isRunning = false;
		}
	}

	async loadPluginData(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<PluginData> | null;
		this.lastRunTimestamp = loaded?.lastRunTimestamp ?? null;
		this.settings = mergeSettings(loaded?.settings);
		normalizeSubscriptions(this.settings);
	}

	async savePluginData(): Promise<void> {
		normalizeSubscriptions(this.settings);
		const data: PluginData = {
			lastRunTimestamp: this.lastRunTimestamp,
			settings: this.settings,
		};
		await this.saveData(data);
	}
}
