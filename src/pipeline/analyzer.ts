import { spawn } from 'child_process';
import { AnalyzerResult, Paper, ScoredPaper, ScholarSettings, TopicSubscription } from '../types';
import { getErrorMessage, getPaperIdentifier, normalizeWhitespace } from '../utils/strings';

const MAX_PAPERS_PER_BATCH = 50;
const ANALYZER_TIMEOUT_MS = 10 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function buildSystemPrompt(subscription: TopicSubscription): string {
	const focusLabel = subscription.focus.label.trim();
	const focusDescription = normalizeWhitespace(subscription.focus.description);

	return `You are an expert scientific literature analyst. You will be given a list of academic papers and must assess their relevance to the research topic: "${focusLabel}".${focusDescription ? `\n\nTopic guidance:\n- ${focusDescription}` : ''}

For each paper, return:
- score: integer 0-100 (100 = directly about the stated research focus; 0 = completely unrelated)
- summary: 2-3 sentence plain-language summary of what the paper reports
- reason: one sentence explaining the score

Respond ONLY with a valid JSON array. No markdown fences and no explanation outside the JSON.

Format:
[
  { "id": "<id from input>", "score": 85, "summary": "...", "reason": "..." }
]`;
}

function buildAdjacentSystemPrompt(subscriptions: TopicSubscription[]): string {
	const topicList = subscriptions
		.map((s) => {
			const label = s.focus.label.trim();
			const description = normalizeWhitespace(s.focus.description);
			return description ? `- "${label}": ${description}` : `- "${label}"`;
		})
		.join('\n');

	return `You are an expert scientific literature analyst. A researcher subscribes to the following topics:
${topicList}

You will be given a list of academic papers that did NOT match any of the above topic subscriptions. Assess whether each paper offers methodological or conceptual value to this researcher — not because it directly addresses their subscribed topics, but because it could:
- Introduce or demonstrate a technique applicable to their research (e.g., novel sequencing, imaging, genetic, or computational methods)
- Study an adjacent biological system with transferable insights
- Offer a conceptual framework or experimental approach that could inform their thinking

For each paper, return:
- score: integer 0-100 (100 = highly valuable for methodological or conceptual transfer; 0 = no value to this researcher)
- summary: 2-3 sentence plain-language summary of what the paper reports
- reason: one sentence explaining the transferable value (or lack thereof)

Respond ONLY with a valid JSON array. No markdown fences and no explanation outside the JSON.

Format:
[
  { "id": "<id from input>", "score": 85, "summary": "...", "reason": "..." }
]`;
}

function buildPrompt(papers: Paper[], systemPrompt: string, offset: number): string {
	const payload = papers.map((paper, index) => ({
		id: getPaperIdentifier(paper, offset + index),
		title: paper.title,
		authors: paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : ''),
		date: paper.publicationDate,
		abstract: paper.abstract.slice(0, 1500),
	}));

	return `${systemPrompt}\n\nPAPERS:\n${JSON.stringify(payload, null, 2)}`;
}

function clampScore(score: unknown): number {
	const numeric = Number(score);
	if (Number.isNaN(numeric)) {
		return 0;
	}
	return Math.max(0, Math.min(100, Math.round(numeric)));
}

function extractJsonArray(output: string): string {
	const trimmed = output.trim();
	if (!trimmed) {
		throw new Error('pi CLI returned an empty response.');
	}

	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return trimmed;
	}

	const start = trimmed.indexOf('[');
	const end = trimmed.lastIndexOf(']');
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(`Failed to locate a JSON array in the pi response: ${trimmed.slice(0, 300)}`);
	}

	return trimmed.slice(start, end + 1);
}

function parseAnalyzerResults(output: string): AnalyzerResult[] {
	const parsed = JSON.parse(extractJsonArray(output)) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('pi CLI did not return a JSON array.');
	}

	return parsed
		.map((item) => {
			if (!item || typeof item !== 'object') {
				return null;
			}

			const record = item as Partial<AnalyzerResult>;
			if (typeof record.id !== 'string') {
				return null;
			}

			return {
				id: record.id,
				score: clampScore(record.score),
				summary: normalizeWhitespace(String(record.summary ?? '')),
				reason: normalizeWhitespace(String(record.reason ?? '')),
			};
		})
		.filter((item): item is AnalyzerResult => item !== null);
}

function getPiCandidates(piPath: string): string[] {
	const trimmed = piPath.trim() || 'pi';
	const candidates = [trimmed];
	if (process.platform === 'win32' && !/[.]cmd$/i.test(trimmed)) {
		candidates.push(`${trimmed}.cmd`);
	}
	return [...new Set(candidates)];
}

function quoteWindowsCmdArg(value: string): string {
	if (value.length === 0) {
		return '""';
	}

	const escaped = value.replace(/(["^&|<>()%!])/g, '^$1');
	return /[\s"^&|<>()%!]/.test(value) ? `"${escaped}"` : escaped;
}

function buildSpawnSpec(command: string, args: string): { spawnCmd: string; spawnArgs: string[] };
function buildSpawnSpec(command: string, args: string[]): { spawnCmd: string; spawnArgs: string[] };
function buildSpawnSpec(command: string, args: string | string[]): { spawnCmd: string; spawnArgs: string[] } {
	if (process.platform !== 'win32') {
		return {
			spawnCmd: command,
			spawnArgs: Array.isArray(args) ? args : [args],
		};
	}

	const commandArgs = Array.isArray(args) ? args : [args];
	if (command.toLowerCase().endsWith('.exe')) {
		return {
			spawnCmd: command,
			spawnArgs: commandArgs,
		};
	}

	const commandLine = [command, ...commandArgs].map(quoteWindowsCmdArg).join(' ');
	return {
		spawnCmd: 'cmd.exe',
		spawnArgs: ['/d', '/s', '/c', commandLine],
	};
}

function runPiCommand(command: string, prompt: string, settings: ScholarSettings): Promise<string> {
	return new Promise((resolve, reject) => {
		const piArgs = ['--model', settings.llm.model, '--thinking', settings.llm.thinkingLevel, '--no-tools', '--no-session', '--print'];
		const { spawnCmd, spawnArgs } = buildSpawnSpec(command, piArgs);
		const child = spawn(spawnCmd, spawnArgs, {
			shell: false,
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let settled = false;

		const timeout = globalThis.setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill();
			reject(new Error(`pi CLI timed out after ${ANALYZER_TIMEOUT_MS / 1000}s.\nstderr: ${stderr.trim()}`));
		}, ANALYZER_TIMEOUT_MS);

		child.stdout.on('data', (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on('error', (error) => {
			if (settled) {
				return;
			}
			settled = true;
			globalThis.clearTimeout(timeout);
			reject(error);
		});
		child.on('close', (code) => {
			if (settled) {
				return;
			}
			settled = true;
			globalThis.clearTimeout(timeout);
			if (code !== 0) {
				reject(new Error(`pi CLI exited with code ${code}.\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`));
				return;
			}
			resolve(stdout);
		});

		try {
			child.stdin.write(prompt, 'utf8');
			child.stdin.end();
		} catch (error) {
			if (settled) {
				return;
			}
			settled = true;
			globalThis.clearTimeout(timeout);
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

async function runPi(prompt: string, settings: ScholarSettings): Promise<string> {
	let lastError: unknown;
	for (const candidate of getPiCandidates(settings.llm.piPath)) {
		try {
			return await runPiCommand(candidate, prompt, settings);
		} catch (error) {
			lastError = error;
		}
	}

	throw new Error(`Unable to run pi CLI. ${getErrorMessage(lastError)}`);
}

function withFallbackAnalyses(papers: Paper[], analyses: AnalyzerResult[], offset: number): ScoredPaper[] {
	const paperMap = new Map<string, Paper>();
	for (const [index, paper] of papers.entries()) {
		paperMap.set(getPaperIdentifier(paper, offset + index), paper);
	}

	const scoredPapers: ScoredPaper[] = [];
	const seen = new Set<string>();

	for (const analysis of analyses) {
		const paper = paperMap.get(analysis.id);
		if (!paper) {
			continue;
		}

		seen.add(analysis.id);
		scoredPapers.push({
			...paper,
			score: analysis.score,
			summary: analysis.summary || 'No summary returned by pi.',
			reason: analysis.reason || 'The pi CLI did not provide a relevance justification.',
		});
	}

	for (const [index, paper] of papers.entries()) {
		const id = getPaperIdentifier(paper, offset + index);
		if (seen.has(id)) {
			continue;
		}

		scoredPapers.push({
			...paper,
			score: 0,
			summary: 'No summary returned by pi.',
			reason: 'The pi CLI did not return an analysis for this paper.',
		});
	}

	return scoredPapers;
}

async function runAnalysisBatches(
	papers: Paper[],
	settings: ScholarSettings,
	systemPrompt: string,
): Promise<ScoredPaper[]> {
	if (papers.length === 0) {
		return [];
	}

	const results: ScoredPaper[] = [];
	const batches = chunk(papers, MAX_PAPERS_PER_BATCH);
	let offset = 0;

	for (const batch of batches) {
		const prompt = buildPrompt(batch, systemPrompt, offset);
		const output = await runPi(prompt, settings);
		const analyses = parseAnalyzerResults(output);
		results.push(...withFallbackAnalyses(batch, analyses, offset));
		offset += batch.length;
	}

	return results;
}

export async function analyzeWithPi(
	papers: Paper[],
	settings: ScholarSettings,
	subscription: TopicSubscription,
): Promise<ScoredPaper[]> {
	return runAnalysisBatches(papers, settings, buildSystemPrompt(subscription));
}

export async function analyzeAdjacentWithPi(
	papers: Paper[],
	settings: ScholarSettings,
	subscriptions: TopicSubscription[],
): Promise<ScoredPaper[]> {
	return runAnalysisBatches(papers, settings, buildAdjacentSystemPrompt(subscriptions));
}
