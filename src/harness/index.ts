/* eslint-disable no-console */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DOMParser as XmldomParser } from '@xmldom/xmldom';
import { analyzeWithPi } from '../pipeline/analyzer';
import { deduplicateCrossSource } from '../pipeline/deduplicator';
import { fetchAll } from '../pipeline/fetcher';
import { applyKeywordFilter } from '../pipeline/keywordFilter';
import { renderEmptyNewsletter, renderNewsletter } from '../pipeline/render';
import { DEFAULT_SETTINGS, mergeSettings } from '../settings-data';
import { Paper, ScoredPaper, ScholarSettings, SeenEntry } from '../types';
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
	updateSeen: boolean;
}

interface HarnessReport {
	from: string;
	to: string;
	analyzer: string;
	outputDir: string;
	sourceCounts: Record<string, number>;
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
	console.log(`Scholar harness\n\nUsage:\n  npm run harness -- --from YYYY-MM-DD [options]\n\nOptions:\n  --from YYYY-MM-DD           Start date\n  --to YYYY-MM-DD             End date (default: same as --from)\n  --query TEXT                Override keyword query\n  --sources a,b,c             Limit sources to pubmed, biorxiv, europepmc\n  --settings FILE             Load partial settings JSON\n  --analyzer mock|pi|none     Choose analyzer mode (default: mock)\n  --output DIR                Output directory (default: .harness-output/<timestamp>)\n  --seen-file FILE            Optional local seen-log JSON file\n  --update-seen               Append newly seen papers to the seen file\n  --help                      Show this help\n`);
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

	const settings = mergeSettings(saved ?? DEFAULT_SETTINGS);
	if (args.query) {
		settings.keywordQuery = args.query;
	}
	if (args.sources) {
		const requested = new Set(args.sources);
		for (const source of VALID_SOURCES) {
			(settings.sources as Record<HarnessSource, boolean>)[source] = requested.has(source);
		}
	}

	return settings;
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

function scorePaper(paper: Paper): { score: number; reason: string } {
	const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
	const topicTerms = ['inner ear', 'cochlea', 'hair cell', 'spiral ganglion', 'otic', 'utricle', 'saccule'];
	const developmentTerms = ['development', 'differentiat', 'morphogen', 'progenitor', 'regeneration', 'specification'];
	const topicMatches = topicTerms.filter((term) => haystack.includes(term)).length;
	const developmentMatches = developmentTerms.filter((term) => haystack.includes(term)).length;
	const score = Math.min(100, topicMatches * 20 + developmentMatches * 12 + (paper.source === 'pubmed' ? 6 : 0));

	if (score >= 75) {
		return { score, reason: 'Multiple topic and development terms matched in the title or abstract.' };
	}
	if (score >= 50) {
		return { score, reason: 'Some relevant inner ear development terms matched.' };
	}
	return { score, reason: 'Only weak or partial matches were found in the title or abstract.' };
}

function mockAnalyze(papers: Paper[]): ScoredPaper[] {
	return papers.map((paper, index) => {
		const { score, reason } = scorePaper(paper);
		return {
			...paper,
			score,
			summary: summarizeText(paper.abstract),
			reason: `${reason} [mock ${getPaperIdentifier(paper, index)}]`,
		};
		}).sort((left, right) => right.score - left.score);
}

async function runAnalyzer(mode: HarnessArgs['analyzer'], papers: Paper[], settings: ScholarSettings): Promise<ScoredPaper[]> {
	if (mode === 'none') {
		return papers.map((paper, index) => ({
			...paper,
			score: 0,
			summary: summarizeText(paper.abstract),
			reason: `Analyzer skipped [${getPaperIdentifier(paper, index)}]`,
		}));
	}
	if (mode === 'pi') {
		const scored = await analyzeWithPi(papers, settings);
		return scored.sort((left, right) => right.score - left.score);
	}
	return mockAnalyze(papers);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const settings = await loadSettings(args);

	console.log(`Scholar harness: fetching ${args.from} to ${args.to}`);
	console.log(`Sources: ${VALID_SOURCES.filter((source) => settings.sources[source]).join(', ') || 'none'}`);
	console.log(`Analyzer: ${args.analyzer}`);
	console.log(`Output: ${args.outputDir}`);

	const rawPapers = await fetchAll(settings, args.from, args.to);
	const dedupedPapers = deduplicateCrossSource(rawPapers);
	const seenEntries = await loadSeenEntries(args.seenFile);
	const seenSet = buildSeenSet({ entries: seenEntries, lastUpdated: '' });
	const unseenPapers = dedupedPapers.filter((paper) => !getPaperKeys(paper).some((key) => seenSet.has(key)));
	const matchedPapers = applyKeywordFilter(unseenPapers, settings.keywordQuery);
	const scoredPapers = await runAnalyzer(args.analyzer, matchedPapers, settings);

	await mkdir(args.outputDir, { recursive: true });
	await writeJson(resolve(args.outputDir, 'raw-papers.json'), rawPapers);
	await writeJson(resolve(args.outputDir, 'deduped-papers.json'), dedupedPapers);
	await writeJson(resolve(args.outputDir, 'unseen-papers.json'), unseenPapers);
	await writeJson(resolve(args.outputDir, 'matched-papers.json'), matchedPapers);
	await writeJson(resolve(args.outputDir, 'scored-papers.json'), scoredPapers);

	const newsletter = matchedPapers.length > 0
		? renderNewsletter(args.to, scoredPapers, settings, {
			totalFetched: rawPapers.length,
			totalDeduped: dedupedPapers.length,
			totalNew: unseenPapers.length,
			totalMatched: scoredPapers.length,
		})
		: renderEmptyNewsletter(args.to, {
			totalFetched: rawPapers.length,
			totalDeduped: dedupedPapers.length,
			totalNew: unseenPapers.length,
			totalMatched: 0,
		}, unseenPapers.length === 0
			? 'No newly discovered papers were found for this date range.'
			: 'New papers were found, but none matched the current keyword filter.');
	await writeText(resolve(args.outputDir, 'newsletter.md'), newsletter);

	const report: HarnessReport = {
		from: args.from,
		to: args.to,
		analyzer: args.analyzer,
		outputDir: args.outputDir,
		sourceCounts: countBySource(rawPapers),
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
	console.log('Artifacts written:');
	console.log(`  ${resolve(args.outputDir, 'report.json')}`);
	console.log(`  ${resolve(args.outputDir, 'newsletter.md')}`);
}

void main().catch((error) => {
	console.error('Scholar harness failed.', error);
	process.exit(1);
});
