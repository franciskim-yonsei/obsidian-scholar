import { App } from 'obsidian';
import { ScholarSettings, SeenEntry, SeenLog, Paper } from '../types';
import { loadSeenLog, saveSeenLog, buildSeenSet, getPaperKeys } from '../utils/seenLog';
import { analyzeWithPi } from './analyzer';
import { deduplicateCrossSource } from './deduplicator';
import { fetchAll } from './fetcher';
import { applyKeywordFilter } from './keywordFilter';
import { writeEmptyNewsletter, writeNewsletter } from './newsletter';

function buildSeenEntries(papers: Paper[], dateSeen: string): SeenEntry[] {
	return papers.map((paper) => ({
		doi: paper.doi,
		pmid: paper.pmid,
		ssid: paper.ssid,
		title: paper.title,
		dateSeen,
	}));
}

async function appendSeenEntries(log: SeenLog, papers: Paper[], app: App, dateSeen: string): Promise<void> {
	if (papers.length === 0) {
		return;
	}

	log.entries.push(...buildSeenEntries(papers, dateSeen));
	log.lastUpdated = new Date().toISOString();
	await saveSeenLog(app.vault, log);
}

export async function runPipelineForDateRange(
	app: App,
	settings: ScholarSettings,
	fromDate: string,
	toDate: string,
): Promise<void> {
	const rawPapers = await fetchAll(settings, fromDate, toDate);
	const deduplicatedPapers = deduplicateCrossSource(rawPapers);
	const seenLog = await loadSeenLog(app.vault);
	const seenSet = buildSeenSet(seenLog);
	const newPapers = deduplicatedPapers.filter((paper) => !getPaperKeys(paper).some((key) => seenSet.has(key)));

	if (newPapers.length === 0) {
		await writeEmptyNewsletter(
			app,
			settings,
			toDate,
			rawPapers.length,
			deduplicatedPapers.length,
			0,
			'No newly discovered papers were found for this date.',
		);
		return;
	}

	const filteredPapers = applyKeywordFilter(newPapers, settings.keywordQuery);
	if (filteredPapers.length === 0) {
		await writeEmptyNewsletter(
			app,
			settings,
			toDate,
			rawPapers.length,
			deduplicatedPapers.length,
			newPapers.length,
			'New papers were found, but none matched the current keyword filter.',
		);
		await appendSeenEntries(seenLog, newPapers, app, toDate);
		return;
	}

	const scoredPapers = await analyzeWithPi(filteredPapers, settings);
	scoredPapers.sort((left, right) => right.score - left.score);

	await writeNewsletter(
		app,
		settings,
		toDate,
		scoredPapers,
		rawPapers.length,
		deduplicatedPapers.length,
		newPapers.length,
	);
	await appendSeenEntries(seenLog, newPapers, app, toDate);
}
