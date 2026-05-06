import { Paper, ScholarSettings, SeenEntry, SeenLog, TopicRunResult, TopicSubscription } from '../types';
import { buildSeenSet, getPaperKeys } from '../utils/seenLog';
import { analyzeWithPi } from './analyzer';
import { deduplicateCrossSource } from './deduplicator';
import { fetchAll } from './fetcher';
import { applyKeywordFilter, matchesPaper, parseQuery } from './keywordFilter';

function buildSeenEntries(papers: Paper[], dateSeen: string): SeenEntry[] {
	return papers.map((paper) => ({
		doi: paper.doi,
		pmid: paper.pmid,
		ssid: paper.ssid,
		title: paper.title,
		publicationDate: paper.publicationDate,
		sourcePublicationDate: paper.sourcePublicationDate,
		sourceIndexedDate: paper.sourceIndexedDate,
		sourceIndexStatus: paper.sourceIndexStatus,
		source: paper.source,
		dateSeen,
	}));
}

function describeFailures(failures: { name: string; message: string }[]): string {
	return failures.map((failure) => `${failure.name} (${failure.message})`).join('; ');
}

export function commitSeenEntries(
	seenLog: SeenLog,
	papers: Paper[],
	dateSeen: string,
): void {
	if (papers.length === 0) {
		return;
	}

	const seenKeys = buildSeenSet(seenLog);
	for (const entry of buildSeenEntries(papers, dateSeen)) {
		const candidateKeys = getPaperKeys({
			doi: entry.doi,
			pmid: entry.pmid,
			ssid: entry.ssid,
			title: entry.title,
			authors: [],
			abstract: '',
			publicationDate: entry.publicationDate ?? '',
			source: entry.source ?? 'pubmed',
			url: '',
		});
		if (candidateKeys.some((key) => seenKeys.has(key))) {
			continue;
		}
		seenLog.entries.push(entry);
		for (const key of candidateKeys) {
			seenKeys.add(key);
		}
	}
	seenLog.lastUpdated = new Date().toISOString();
}

export async function runPipelineForDateRange(
	settings: ScholarSettings,
	subscription: TopicSubscription,
	seenLog: SeenLog,
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
	const seenSet = buildSeenSet(seenLog);
	const newPapers = deduplicatedPapers.filter((paper) => !getPaperKeys(paper).some((key) => seenSet.has(key)));

	if (newPapers.length === 0) {
		return {
			subscription,
			scored: [],
			rejectedPapers: [],
			totalFetched: rawPapers.length,
			totalDeduped: deduplicatedPapers.length,
			totalNew: 0,
			totalMatched: 0,
			message: 'No newly discovered papers were found for this topic in the recheck window.',
			seenPapersToAppend: [],
		};
	}

	const filteredPapers = applyKeywordFilter(newPapers, subscription.keywordQuery);
	if (filteredPapers.length === 0) {
		return {
			subscription,
			scored: [],
			rejectedPapers: newPapers,
			totalFetched: rawPapers.length,
			totalDeduped: deduplicatedPapers.length,
			totalNew: newPapers.length,
			totalMatched: 0,
			message: 'New papers were found for this topic, but none matched the current keyword filter.',
			seenPapersToAppend: newPapers,
		};
	}

	const coreParsed = parseQuery(subscription.keywordQuery);
	const rejectedPapers = newPapers.filter((paper) => !matchesPaper(paper, coreParsed));

	const scoredPapers = await analyzeWithPi(filteredPapers, settings, subscription);
	scoredPapers.sort((left, right) => right.score - left.score);

	return {
		subscription,
		scored: scoredPapers,
		rejectedPapers,
		totalFetched: rawPapers.length,
		totalDeduped: deduplicatedPapers.length,
		totalNew: newPapers.length,
		totalMatched: scoredPapers.length,
		seenPapersToAppend: newPapers,
	};
}
