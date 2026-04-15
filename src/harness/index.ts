/* eslint-disable no-console */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { analyzeAdjacentWithPi, analyzeWithPi } from '../pipeline/analyzer';
import { deduplicateCrossSource } from '../pipeline/deduplicator';
import { fetchAll } from '../pipeline/fetcher';
import { applyKeywordFilter, collectPositiveTerms, countSatisfiedPositiveClauses, matchesPaper, parseQuery } from '../pipeline/keywordFilter';
import { renderCombinedNewsletter, renderEmptyNewsletter, renderNewsletter } from '../pipeline/render';
import { getEnabledSubscriptions, mergeSettings } from '../settings-data';
import { Paper, ScoredPaper, ScholarSettings, SeenEntry, TopicRunFailure, TopicRunResult, TopicSubscription } from '../types';
import { buildSeenSet, getPaperKeys } from '../utils/seenLog';
import { getPaperIdentifier, normalizeWhitespace } from '../utils/strings';

interface HarnessArgs {
	from: string;
	to: string;
	analyzer: 'mock' | 'pi' | 'none';
	outputDir: string;
	settingsPath?: string;
	query?: string;
	sources?: string[];
	seenFile?: string;
	subscription?: string;
	updateSeen: boolean;
	combined: boolean;
}

interface HarnessReport {
	from: string;
	to: string;
	analyzer: string;
	outputDir: string;
	subscriptionId: string;
	subscriptionLabel: string;
	sourceCounts: Record<string, number>;
	failedSources: string[];
	rawCount: number;
	dedupedCount: number;
	seenFilteredCount: number;
	keywordMatchedCount: number;
	scoredCount: number;
}

const VALID_SOURCES = ['pubmed', 'biorxiv', 'europepmc'] as const;

type HarnessSource = (typeof VALID_SOURCES)[number];

(globalThis as { DOMParser?: typeof XmldomParser }).DOMParser = XmldomParser;

function printUsage(): void {
	console.log(`Scholar harness

Usage:
  npm run harness -- --from YYYY-MM-DD [options]

Options:
  --from YYYY-MM-DD           Start date
  --to YYYY-MM-DD             End date (default: same as --from)
  --query TEXT                Override keyword query for the selected subscription
  --subscription ID|LABEL     Choose which subscription to run
  --sources a,b,c             Limit sources to pubmed, biorxiv, europepmc
  --settings FILE             Load partial settings JSON
  --analyzer mock|pi|none     Choose analyzer mode (default: mock)
  --output DIR                Output directory (default: .harness-output/<timestamp>)
  --seen-file FILE            Optional local seen-log JSON file
  --combined                  Run all enabled subscriptions and render combined newsletter
  --update-seen               Append newly seen papers to the seen file
  --help                      Show this help
`);
}

function getDefaultOutputDir(): string {
	const now = new Date();
	const stamp = now.toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
	return resolve(`.harness-output/${stamp}`);
}

function parseArgs(argv: string[]): HarnessArgs {
	const args: HarnessArgs = {
		from: '',
		to: '',
		analyzer: 'mock',
		outputDir: getDefaultOutputDir(),
		updateSeen: false,
		combined: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg) {
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		}
		if (!arg.startsWith('--')) {
			throw new Error(`Unexpected argument: ${arg}`);
		}

		const value = argv[index + 1];
		switch (arg) {
			case '--from':
				args.from = value ?? '';
				index += 1;
				break;
			case '--to':
				args.to = value ?? '';
				index += 1;
				break;
			case '--query':
				args.query = value ?? '';
				index += 1;
				break;
			case '--settings':
				args.settingsPath = value ? resolve(value) : undefined;
				index += 1;
				break;
			case '--subscription':
				args.subscription = value ?? '';
				index += 1;
				break;
			case '--sources':
				args.sources = (value ?? '')
					.split(',')
					.map((item) => item.trim())
					.filter(Boolean);
				index += 1;
				break;
			case '--analyzer':
				if (value !== 'mock' && value !== 'pi' && value !== 'none') {
					throw new Error(`Invalid analyzer: ${value ?? ''}`);
				}
				args.analyzer = value;
				index += 1;
				break;
			case '--output':
				args.outputDir = value ? resolve(value) : args.outputDir;
				index += 1;
				break;
			case '--seen-file':
				args.seenFile = value ? resolve(value) : undefined;
				index += 1;
				break;
			case '--combined':
				args.combined = true;
				break;
			case '--update-seen':
				args.updateSeen = true;
				break;
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from)) {
		throw new Error('You must provide --from YYYY-MM-DD.');
	}
	if (!args.to) {
		args.to = args.from;
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
		throw new Error('If provided, --to must be YYYY-MM-DD.');
	}

	return args;
}

async function readJsonFile<T>(path: string): Promise<T> {
	const raw = await readFile(path, 'utf8');
	return JSON.parse(raw) as T;
}

async function loadSettings(args: HarnessArgs): Promise<ScholarSettings> {
	let saved: Partial<ScholarSettings> | undefined;
	if (args.settingsPath) {
		saved = await readJsonFile<Partial<ScholarSettings>>(args.settingsPath);
	}

	const settings = mergeSettings(saved);
	if (args.sources) {
		const requested = new Set(args.sources);
		for (const source of VALID_SOURCES) {
			(settings.sources as Record<HarnessSource, boolean>)[source] = requested.has(source);
		}
	}

	return settings;
}

function selectSubscription(settings: ScholarSettings, args: HarnessArgs): TopicSubscription {
	const requested = args.subscription?.trim().toLowerCase();
	if (requested) {
		const match = settings.subscriptions.find((subscription) =>
			subscription.id.toLowerCase() === requested || subscription.focus.label.trim().toLowerCase() === requested,
		);
		if (!match) {
			throw new Error(`No subscription matched "${args.subscription}".`);
		}
		return {
			...match,
			focus: { ...match.focus },
		};
	}

	const enabledSubscriptions = getEnabledSubscriptions(settings);
	if (enabledSubscriptions.length === 0) {
		throw new Error('No enabled subscriptions are configured.');
	}
	if (enabledSubscriptions.length > 1) {
		console.warn(`Scholar harness: multiple subscriptions are enabled; using the first one (${enabledSubscriptions[0]?.focus.label}). Pass --subscription to choose another.`);
	}
	const selected = enabledSubscriptions[0];
	if (!selected) {
		throw new Error('No enabled subscriptions are configured.');
	}
	return {
		...selected,
		focus: { ...selected.focus },
	};
}

function countBySource(papers: Paper[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const paper of papers) {
		counts[paper.source] = (counts[paper.source] ?? 0) + 1;
	}
	return counts;
}

async function ensureParent(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
}

async function writeJson(path: string, data: unknown): Promise<void> {
	await ensureParent(path);
	await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeText(path: string, data: string): Promise<void> {
	await ensureParent(path);
	await writeFile(path, data, 'utf8');
}

async function loadSeenEntries(path?: string): Promise<SeenEntry[]> {
	if (!path) {
		return [];
	}

	try {
		const parsed = await readJsonFile<{ entries?: SeenEntry[] } | SeenEntry[]>(path);
		if (Array.isArray(parsed)) {
			return parsed;
		}
		return Array.isArray(parsed.entries) ? parsed.entries : [];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('ENOENT')) {
			return [];
		}
		throw error;
	}
}

async function saveSeenEntries(path: string, entries: SeenEntry[]): Promise<void> {
	await writeJson(path, {
		entries,
		lastUpdated: new Date().toISOString(),
	});
}

function buildSeenEntries(papers: Paper[], dateSeen: string): SeenEntry[] {
	return papers.map((paper) => ({
		doi: paper.doi,
		pmid: paper.pmid,
		ssid: paper.ssid,
		title: paper.title,
		dateSeen,
	}));
}

function summarizeText(text: string): string {
	const summary = normalizeWhitespace(text).split(/(?<=[.!?])\s+/)[0] ?? '';
	return summary || 'No abstract available.';
}

function getMockScoringTerms(subscription: TopicSubscription): string[] {
	const queryTerms = collectPositiveTerms(parseQuery(subscription.keywordQuery))
		.map((term) => normalizeWhitespace(term).toLowerCase())
		.filter((term) => term.length > 1);
	if (queryTerms.length > 0) {
		return queryTerms;
	}

	const fallbackTerms = normalizeWhitespace(`${subscription.focus.label} ${subscription.focus.description}`)
		.toLowerCase()
		.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? [];
	return [...new Set(fallbackTerms)].slice(0, 20);
}

function countMatchedTerms(haystack: string, terms: string[]): number {
	let count = 0;
	for (const term of terms) {
		if (haystack.includes(term)) {
			count += 1;
		}
	}
	return count;
}

function scorePaper(paper: Paper, subscription: TopicSubscription): { score: number; reason: string } {
	const parsedQuery = parseQuery(subscription.keywordQuery);
	const terms = getMockScoringTerms(subscription);
	const titleHaystack = paper.title.toLowerCase();
	const abstractHaystack = paper.abstract.toLowerCase();
	const matchedClauses = countSatisfiedPositiveClauses(paper, parsedQuery);
	const titleMatches = countMatchedTerms(titleHaystack, terms);
	const abstractMatches = countMatchedTerms(abstractHaystack, terms);
	const score = Math.min(100, matchedClauses * 28 + titleMatches * 10 + abstractMatches * 4 + (paper.source === 'pubmed' ? 4 : 0));

	if (score >= 75) {
		return { score, reason: 'Several configured focus terms matched strongly, including prominent matches in the title or abstract.' };
	}
	if (score >= 50) {
		return { score, reason: 'The paper matched the configured research focus in multiple places.' };
	}
	return { score, reason: 'Only weak or partial matches were found against the configured research focus.' };
}

function mockAnalyze(papers: Paper[], subscription: TopicSubscription): ScoredPaper[] {
	return papers.map((paper, index) => {
		const { score, reason } = scorePaper(paper, subscription);
		return {
			...paper,
			score,
			summary: summarizeText(paper.abstract),
			reason: `${reason} [mock ${getPaperIdentifier(paper, index)}]`,
		};
	}).sort((left, right) => right.score - left.score);
}

async function runAnalyzer(
	mode: HarnessArgs['analyzer'],
	papers: Paper[],
	settings: ScholarSettings,
	subscription: TopicSubscription,
): Promise<ScoredPaper[]> {
	if (mode === 'none') {
		return papers.map((paper, index) => ({
			...paper,
			score: 0,
			summary: summarizeText(paper.abstract),
			reason: `Analyzer skipped [${getPaperIdentifier(paper, index)}]`,
		}));
	}
	if (mode === 'pi') {
		const scored = await analyzeWithPi(papers, settings, subscription);
		return scored.sort((left, right) => right.score - left.score);
	}
	return mockAnalyze(papers, subscription);
}

function describeFailures(failures: { name: string; message: string }[]): string {
	return failures.map((failure) => `${failure.name} (${failure.message})`).join('; ');
}

function mockAnalyzeAdjacent(papers: Paper[], settings: ScholarSettings): ScoredPaper[] {
	const parsedQuery = parseQuery(settings.adjacentQuery);
	return papers
		.map((paper, index) => {
			const matchedClauses = countSatisfiedPositiveClauses(paper, parsedQuery);
			const score = Math.min(100, matchedClauses * 25 + 15);
			return {
				...paper,
				score,
				summary: summarizeText(paper.abstract),
				reason: `Matched ${matchedClauses} clause(s) of the adjacent-interest query. [mock ${getPaperIdentifier(paper, index)}]`,
			};
		})
		.sort((a, b) => b.score - a.score);
}

async function runCombinedMode(args: HarnessArgs, settings: ScholarSettings): Promise<void> {
	const enabledSubscriptions = getEnabledSubscriptions(settings);
	if (enabledSubscriptions.length === 0) {
		throw new Error('No enabled subscriptions are configured.');
	}

	const seenEntries = await loadSeenEntries(args.seenFile);
	const seenSet = buildSeenSet({ entries: seenEntries, lastUpdated: '' });
	const allNewPapers: Paper[] = [];

	const results: TopicRunResult[] = [];
	const failures: TopicRunFailure[] = [];

	for (const subscription of enabledSubscriptions) {
		console.log(`\nSubscription: ${subscription.focus.label} (${subscription.id})`);
		const fetchResult = await fetchAll(settings, subscription, args.from, args.to);
		const rawPapers = fetchResult.papers;

		if (rawPapers.length === 0 && fetchResult.failures.length > 0) {
			const message = describeFailures(fetchResult.failures);
			console.warn(`  All sources failed: ${message}`);
			failures.push({ subscription, message });
			continue;
		}
		if (fetchResult.failures.length > 0) {
			console.warn(`  Partial fetch failures: ${describeFailures(fetchResult.failures)}`);
		}

		const dedupedPapers = deduplicateCrossSource(rawPapers);
		const newPapers = dedupedPapers.filter((paper) => !getPaperKeys(paper).some((key) => seenSet.has(key)));
		allNewPapers.push(...newPapers);

		const coreParsed = parseQuery(subscription.keywordQuery);
		const matchedPapers = newPapers.filter((paper) => matchesPaper(paper, coreParsed));
		const rejectedPapers = newPapers.filter((paper) => !matchesPaper(paper, coreParsed));

		console.log(`  fetched: ${rawPapers.length}  deduped: ${dedupedPapers.length}  new: ${newPapers.length}  matched: ${matchedPapers.length}  rejected: ${rejectedPapers.length}`);

		const scored = args.analyzer === 'pi'
			? await analyzeWithPi(matchedPapers, settings, subscription)
			: await runAnalyzer(args.analyzer, matchedPapers, settings, subscription);
		scored.sort((a, b) => b.score - a.score);

		results.push({
			subscription,
			scored,
			rejectedPapers,
			totalFetched: rawPapers.length,
			totalDeduped: dedupedPapers.length,
			totalNew: newPapers.length,
			totalMatched: scored.length,
			seenPapersToAppend: newPapers,
		});
	}

	// Build adjacent candidate pool.
	const matchedKeys = new Set<string>();
	for (const result of results) {
		for (const paper of result.scored) {
			for (const key of getPaperKeys(paper)) {
				matchedKeys.add(key);
			}
		}
	}

	const seenRejectedKeys = new Set<string>();
	const deduplicatedRejected = results
		.flatMap((result) => result.rejectedPapers)
		.filter((paper) => {
			const keys = getPaperKeys(paper);
			if (keys.some((key) => seenRejectedKeys.has(key) || matchedKeys.has(key))) {
				return false;
			}
			for (const key of keys) {
				seenRejectedKeys.add(key);
			}
			return true;
		});

	const adjacentQuery = settings.adjacentQuery.trim();
	const adjacentCandidates = adjacentQuery ? applyKeywordFilter(deduplicatedRejected, adjacentQuery) : [];
	console.log(`\nAdjacent candidates: ${adjacentCandidates.length} (from ${deduplicatedRejected.length} total rejected)`);

	let adjacent: ScoredPaper[] = [];
	if (adjacentCandidates.length > 0) {
		const parsedCoreQueries = enabledSubscriptions.map((s) => parseQuery(s.keywordQuery));
		const rawAdjacent = args.analyzer === 'pi'
			? await analyzeAdjacentWithPi(adjacentCandidates, settings, enabledSubscriptions)
			: mockAnalyzeAdjacent(adjacentCandidates, settings);
		adjacent = rawAdjacent
			.filter((paper) => !parsedCoreQueries.some((q) => matchesPaper(paper, q)) && paper.score >= settings.thresholds.possible)
			.sort((a, b) => b.score - a.score);
	}
	console.log(`Adjacent shown (score >= ${settings.thresholds.possible}): ${adjacent.length}`);

	const newsletter = renderCombinedNewsletter(args.to, results, failures, adjacent, settings);

	await mkdir(args.outputDir, { recursive: true });
	await writeText(resolve(args.outputDir, 'newsletter.md'), newsletter);
	await writeJson(resolve(args.outputDir, 'adjacent-candidates.json'), adjacentCandidates);
	await writeJson(resolve(args.outputDir, 'adjacent-scored.json'), adjacent);

	console.log(`\nNewsletter written to: ${resolve(args.outputDir, 'newsletter.md')}`);

	if (args.seenFile && args.updateSeen) {
		await saveSeenEntries(args.seenFile, [...seenEntries, ...buildSeenEntries(allNewPapers, args.to)]);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const settings = await loadSettings(args);

	console.log(`Scholar harness: fetching ${args.from} to ${args.to}`);
	console.log(`Sources: ${VALID_SOURCES.filter((source) => settings.sources[source]).join(', ') || 'none'}`);
	console.log(`Analyzer: ${args.analyzer}`);
	console.log(`Output: ${args.outputDir}`);

	if (args.combined) {
		console.log('Mode: combined (all subscriptions + adjacent science)');
		await runCombinedMode(args, settings);
		return;
	}

	const subscription = selectSubscription(settings, args);
	if (args.query) {
		subscription.keywordQuery = args.query;
	}

	console.log(`Subscription: ${subscription.focus.label} (${subscription.id})`);

	const fetchResult = await fetchAll(settings, subscription, args.from, args.to);
	const rawPapers = fetchResult.papers;
	if (rawPapers.length === 0 && fetchResult.failures.length > 0) {
		throw new Error(`No papers were fetched because these sources failed: ${describeFailures(fetchResult.failures)}`);
	}
	if (fetchResult.failures.length > 0) {
		console.warn(`Scholar harness: continuing with partial fetch results. Failed sources: ${describeFailures(fetchResult.failures)}`);
	}

	const dedupedPapers = deduplicateCrossSource(rawPapers);
	const seenEntries = await loadSeenEntries(args.seenFile);
	const seenSet = buildSeenSet({ entries: seenEntries, lastUpdated: '' });
	const unseenPapers = dedupedPapers.filter((paper) => !getPaperKeys(paper).some((key) => seenSet.has(key)));
	const matchedPapers = applyKeywordFilter(unseenPapers, subscription.keywordQuery);
	const scoredPapers = await runAnalyzer(args.analyzer, matchedPapers, settings, subscription);

	await mkdir(args.outputDir, { recursive: true });
	await writeJson(resolve(args.outputDir, 'raw-papers.json'), rawPapers);
	await writeJson(resolve(args.outputDir, 'deduped-papers.json'), dedupedPapers);
	await writeJson(resolve(args.outputDir, 'unseen-papers.json'), unseenPapers);
	await writeJson(resolve(args.outputDir, 'matched-papers.json'), matchedPapers);
	await writeJson(resolve(args.outputDir, 'scored-papers.json'), scoredPapers);

	const newsletter = matchedPapers.length > 0
		? renderNewsletter(subscription, args.to, scoredPapers, settings, {
			totalFetched: rawPapers.length,
			totalDeduped: dedupedPapers.length,
			totalNew: unseenPapers.length,
			totalMatched: scoredPapers.length,
		})
		: renderEmptyNewsletter(subscription, args.to, {
			totalFetched: rawPapers.length,
			totalDeduped: dedupedPapers.length,
			totalNew: unseenPapers.length,
			totalMatched: 0,
		}, unseenPapers.length === 0
			? 'No newly discovered papers were found for this topic in this date range.'
			: 'New papers were found for this topic, but none matched the current keyword filter.');
	await writeText(resolve(args.outputDir, 'newsletter.md'), newsletter);

	const report: HarnessReport = {
		from: args.from,
		to: args.to,
		analyzer: args.analyzer,
		outputDir: args.outputDir,
		subscriptionId: subscription.id,
		subscriptionLabel: subscription.focus.label,
		sourceCounts: countBySource(rawPapers),
		failedSources: fetchResult.failures.map((failure) => failure.name),
		rawCount: rawPapers.length,
		dedupedCount: dedupedPapers.length,
		seenFilteredCount: unseenPapers.length,
		keywordMatchedCount: matchedPapers.length,
		scoredCount: scoredPapers.length,
	};
	await writeJson(resolve(args.outputDir, 'report.json'), report);

	if (args.seenFile && args.updateSeen) {
		await saveSeenEntries(args.seenFile, [...seenEntries, ...buildSeenEntries(unseenPapers, args.to)]);
	}

	console.log('Stage summary:');
	console.log(`  raw fetched:       ${report.rawCount}`);
	console.log(`  deduped:           ${report.dedupedCount}`);
	console.log(`  after seen filter: ${report.seenFilteredCount}`);
	console.log(`  keyword matched:   ${report.keywordMatchedCount}`);
	console.log(`  scored:            ${report.scoredCount}`);
	console.log('  by source:', report.sourceCounts);
	if (report.failedSources.length > 0) {
		console.log('  failed sources:', report.failedSources.join(', '));
	}
	console.log('Artifacts written:');
	console.log(`  ${resolve(args.outputDir, 'report.json')}`);
	console.log(`  ${resolve(args.outputDir, 'newsletter.md')}`);
}

void main().catch((error) => {
	console.error('Scholar harness failed.', error);
	process.exit(1);
});
