import { Notice, Plugin } from 'obsidian';
import { commitSeenEntries, runPipelineForDateRange } from './pipeline';
import { writeCombinedNewsletter } from './pipeline/newsletter';
import { analyzeAdjacentWithPi } from './pipeline/analyzer';
import { applyKeywordFilter, matchesPaper, parseQuery } from './pipeline/keywordFilter';
import { getEnabledSubscriptions, mergeSettings, normalizeSubscriptions } from './settings-data';
import { ScholarSettingTab } from './settings';
import { Paper, PluginData, ScholarSettings, ScoredPaper, SeenLog, TopicRunFailure, TopicRunResult, TopicSubscription } from './types';
import { addDays, toDateString } from './utils/dates';
import { getErrorMessage } from './utils/strings';
import { getEmptySeenLog, getPaperKeys, normalizeSeenLog } from './utils/seenLog';

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
	private seenLogs: Record<string, SeenLog> = {};
	private isRunning = false;

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.addSettingTab(new ScholarSettingTab(this.app, this));

		this.addRibbonIcon('newspaper', 'Scholar: fetch papers', () => {
			void this.runManual();
		});

		this.addCommand({
			id: 'scholar-run',
			name: 'Fetch papers and generate newsletter',
			callback: () => {
				void this.runManual();
			},
		});
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadPluginData();
	}

	private getSeenLog(subscriptionId: string): SeenLog {
		const existing = this.seenLogs[subscriptionId];
		if (existing) {
			return existing;
		}
		const created = getEmptySeenLog();
		this.seenLogs[subscriptionId] = created;
		return created;
	}

	private getRecheckRange(now: Date): { from: string; to: string } {
		const windowDays = Math.max(1, Math.round(this.settings.recheckWindowDays));
		const to = toDateString(now);
		const from = toDateString(addDays(now, -(windowDays - 1)));
		return { from, to };
	}

	async runManual(): Promise<void> {
		if (this.isRunning) {
			new Notice('Scholar is already running.');
			return;
		}

		await this.loadPluginData();
		const activeSubscriptions = getEnabledSubscriptions(this.settings);
		if (activeSubscriptions.length === 0) {
			new Notice('Scholar has no enabled topic subscriptions.');
			return;
		}

		const now = new Date();
		const runDate = toDateString(now);
		const { from, to } = this.getRecheckRange(now);
		this.isRunning = true;

		let completedRuns = 0;
		let wroteNewsletter = false;
		const results: TopicRunResult[] = [];
		const failures: TopicRunFailure[] = [];
		const allFailures: string[] = [];

		try {
			for (const subscription of activeSubscriptions) {
				new Notice(`Scholar: processing ${from} to ${to} (${subscription.focus.label})...`);
				try {
					const result = await runPipelineForDateRange(this.settings, subscription, this.getSeenLog(subscription.id), from, to);
					results.push(result);
					completedRuns += 1;
				} catch (error) {
					const message = getErrorMessage(error);
					failures.push({ subscription, message });
					allFailures.push(`${subscription.focus.label}: ${message}`);
					console.error(`Scholar: pipeline failed for ${subscription.focus.label}.`, error);
				}
			}

			let adjacent: ScoredPaper[] = [];
			try {
				adjacent = await buildAdjacentResults(results, activeSubscriptions, this.settings);
			} catch (error) {
				console.warn('Scholar: adjacent-science analysis failed, continuing without it.', error);
			}

			const totalNew = results.reduce((sum, result) => sum + result.totalNew, 0);
			const shouldWriteNewsletter = totalNew > 0 || failures.length > 0;
			if (shouldWriteNewsletter) {
				await writeCombinedNewsletter(this.app, this.settings, runDate, from, to, results, failures, adjacent);
				wroteNewsletter = true;
			}

			for (const result of results) {
				commitSeenEntries(this.getSeenLog(result.subscription.id), result.seenPapersToAppend, runDate);
			}

			await this.savePluginData();

			if (allFailures.length === 0) {
				if (wroteNewsletter) {
					new Notice('Scholar: finished; wrote newsletter update.');
					return;
				}
				new Notice('Scholar: finished; no newly discovered papers in the recheck window.');
				return;
			}

			new Notice(`Scholar: completed ${completedRuns} topic run${completedRuns === 1 ? '' : 's'}${wroteNewsletter ? ' and wrote a newsletter update' : ''}, but ${allFailures.length} failed. Check the console.`);
		} finally {
			this.isRunning = false;
		}
	}

	async loadPluginData(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = mergeSettings(loaded?.settings);
		normalizeSubscriptions(this.settings);
		const loadedSeenLogs = loaded?.seenLogs && typeof loaded.seenLogs === 'object' ? loaded.seenLogs : {};
		this.seenLogs = Object.fromEntries(
			Object.entries(loadedSeenLogs).map(([subscriptionId, log]) => [subscriptionId, normalizeSeenLog(log)]),
		);
	}

	async savePluginData(): Promise<void> {
		normalizeSubscriptions(this.settings);
		const data: PluginData = {
			settings: this.settings,
			seenLogs: this.seenLogs,
		};
		await this.saveData(data);
	}
}
