import { App } from 'obsidian';
import { Paper, ScholarSettings, SeenEntry, SeenLog, TopicRunResult, TopicSubscription } from '../types';
import { buildSeenSet, getPaperKeys, loadSeenLog, saveSeenLog } from '../utils/seenLog';
import { analyzeWithPi } from './analyzer';
import { deduplicateCrossSource } from './deduplicator';
import { fetchAll } from './fetcher';
import { applyKeywordFilter } from './keywordFilter';

function buildSeenEntries(papers: Paper[], dateSeen: string): SeenEntry[] {
	return papers.map((paper) => ({
		doi: paper.doi,
		pmid: paper.pmid,
		ssid: paper.ssid,
		title: paper.title,
		dateSeen,
	}));
}

function describeFailures(failures: { name: string; message: string }[]): string {
	return failures.map((failure) => `${failure.name} (${failure.message})`).join('; ');
}

export async function commitSeenEntries(
	app: App,
	subscription: TopicSubscription,
	papers: Paper[],
	dateSeen: string,
): Promise<void> {
	if (papers.length === 0) {
		return;
	}

	const seenLog: SeenLog = await loadSeenLog(app.vault, subscription.id);
	seenLog.entries.push(...buildSeenEntries(papers, dateSeen));
	seenLog.lastUpdated = new Date().toISOString();
	await saveSeenLog(app.vault, subscription.id, seenLog);
}

export async function runPipelineForDateRange(
	app: App,
	settings: ScholarSettings,
	subscription: TopicSubscription,
	fromDate: string,
	toDate: string,
): Promise<TopicRunResult> {
	const fetchResult = await fetchAll(settings, subscription, fromDate, toDate);
	const rawPapers = fetchResult.papers;
	if (rawPapers.length === 0 && fetchResult.failures.length > 0) {
		throw new Error(`No papers were fetched because these sources failed: ${describeFailures(fetchResult.failures)}`);
	}
	if (fetchResult.failures.length > 0) {
		console.warn(`Scholar: continuing with partial fetch results. Failed sources: ${describeFailures(fetchResult.failures)}`);
	}

	const deduplicatedPapers = deduplicateCrossSource(rawPapers);
	const seenLog = await loadSeenLog(app.vault, subscription.id);
	const seenSet = buildSeenSet(seenLog);
	const newPapers = deduplicatedPapers.filter((paper) => !getPaperKeys(paper).some((key) => seenSet.has(key)));

	if (newPapers.length === 0) {
		return {
			subscription,
			scored: [],
			totalFetched: rawPapers.length,
			totalDeduped: deduplicatedPapers.length,
			totalNew: 0,
			totalMatched: 0,
			message: 'No newly discovered papers were found for this topic on this date.',
			seenPapersToAppend: [],
		};
	}

	const filteredPapers = applyKeywordFilter(newPapers, subscription.keywordQuery);
	if (filteredPapers.length === 0) {
		return {
			subscription,
			scored: [],
			totalFetched: rawPapers.length,
			totalDeduped: deduplicatedPapers.length,
			totalNew: newPapers.length,
			totalMatched: 0,
			message: 'New papers were found for this topic, but none matched the current keyword filter.',
			seenPapersToAppend: newPapers,
		};
	}

	const scoredPapers = await analyzeWithPi(filteredPapers, settings, subscription);
	scoredPapers.sort((left, right) => right.score - left.score);

	return {
		subscription,
		scored: scoredPapers,
		totalFetched: rawPapers.length,
		totalDeduped: deduplicatedPapers.length,
		totalNew: newPapers.length,
		totalMatched: scoredPapers.length,
		seenPapersToAppend: newPapers,
	};
}
