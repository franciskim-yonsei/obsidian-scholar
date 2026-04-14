import { spawn } from 'child_process';
import { AnalyzerResult, Paper, ScoredPaper, ScholarSettings } from '../types';
import { getErrorMessage, getPaperIdentifier, normalizeWhitespace } from '../utils/strings';

const SYSTEM_PROMPT = `You are an expert in inner ear biology. You will be given a list of academic papers and must assess their relevance to the research topic: "inner ear development" (cochlea, vestibular system, hair cells, spiral ganglion, otic vesicle, auditory and vestibular progenitors, sensory epithelium development, differentiation, and regeneration).

For each paper, return:
- score: integer 0-100 (100 = directly about inner ear development; 0 = completely unrelated)
- summary: 2-3 sentence plain-language summary of what the paper reports
- reason: one sentence explaining the score

Respond ONLY with a valid JSON array. No markdown fences and no explanation outside the JSON.

Format:
[
  { "id": "<id from input>", "score": 85, "summary": "...", "reason": "..." }
]`;

const MAX_PAPERS_PER_BATCH = 50;
const ANALYZER_TIMEOUT_MS = 10 * 60 * 1000;

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function buildPrompt(papers: Paper[], offset: number): string {
	const payload = papers.map((paper, index) => ({
		id: getPaperIdentifier(paper, offset + index),
		title: paper.title,
		authors: paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : ''),
		date: paper.publicationDate,
		abstract: paper.abstract.slice(0, 1500),
	}));

	return `${SYSTEM_PROMPT}\n\nPAPERS:\n${JSON.stringify(payload, null, 2)}`;
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
	if (process.platform === 'win32' && !trimmed.toLowerCase().endsWith('.cmd')) {
		candidates.push(`${trimmed}.cmd`);
	}
	return [...new Set(candidates)];
}

function runPiCommand(command: string, prompt: string, settings: ScholarSettings): Promise<string> {
	return new Promise((resolve, reject) => {
		// Pipe the prompt via stdin rather than writing to a temp file.
		// This avoids Windows path mangling that occurred when @C:\... paths were
		// passed through cmd.exe with shell:true, and avoids the stdin-open hang
		// that caused prior timeouts.
		//
		// On Windows, .cmd files require cmd.exe to execute. We invoke cmd.exe
		// directly with shell:false to avoid the Node.js DEP0190 deprecation that
		// fires when args are passed alongside shell:true.
		const piArgs = ['--model', settings.llm.model, '--thinking', settings.llm.thinkingLevel, '--no-tools', '--no-session', '--print'];
		const [spawnCmd, spawnArgs] = process.platform === 'win32'
			? ['cmd.exe', ['/d', '/s', '/c', [command, ...piArgs].join(' ')]]
			: [command, piArgs];

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

		// Send the prompt and close stdin so pi knows input is complete.
		child.stdin.write(prompt, 'utf8');
		child.stdin.end();

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

export async function analyzeWithPi(papers: Paper[], settings: ScholarSettings): Promise<ScoredPaper[]> {
	if (papers.length === 0) {
		return [];
	}

	const results: ScoredPaper[] = [];
	const batches = chunk(papers, MAX_PAPERS_PER_BATCH);
	let offset = 0;

	for (const batch of batches) {
		const prompt = buildPrompt(batch, offset);
		const output = await runPi(prompt, settings);
		const analyses = parseAnalyzerResults(output);
		results.push(...withFallbackAnalyses(batch, analyses, offset));
		offset += batch.length;
	}

	return results;
}
