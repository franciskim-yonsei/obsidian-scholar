import { App, TFile, normalizePath } from 'obsidian';
import { ScholarSettings, ScoredPaper, TopicRunFailure, TopicRunResult } from '../types';
import { ensureFolderExists } from '../utils/vault';
import { renderCombinedNewsletter } from './render';

function getNewsletterPath(settings: ScholarSettings, date: string): string {
	const folder = settings.inboxFolder.trim();
	const relativePath = folder ? `${folder}/Scholar ${date}.md` : `Scholar ${date}.md`;
	return normalizePath(relativePath);
}

function stripFrontmatter(content: string): string {
	const lines = content.split('\n');
	if (lines[0] !== '---') {
		return content;
	}
	const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---');
	if (closingIndex === -1) {
		return content;
	}
	return lines.slice(closingIndex + 1).join('\n').trimStart();
}

async function writeNote(app: App, settings: ScholarSettings, date: string, content: string): Promise<void> {
	const folder = settings.inboxFolder.trim();
	if (folder) {
		await ensureFolderExists(app.vault, folder);
	}

	const path = getNewsletterPath(settings, date);
	const existing = app.vault.getAbstractFileByPath(path);

	if (existing instanceof TFile) {
		const previous = await app.vault.read(existing);
		const appended = `${previous.trimEnd()}\n\n---\n\n${stripFrontmatter(content)}`;
		await app.vault.modify(existing, appended);
		return;
	}

	await app.vault.create(path, content);
}

export async function writeCombinedNewsletter(
	app: App,
	settings: ScholarSettings,
	date: string,
	searchFrom: string,
	searchTo: string,
	results: TopicRunResult[],
	failures: TopicRunFailure[],
	adjacent: ScoredPaper[] = [],
): Promise<void> {
	const content = renderCombinedNewsletter(date, results, failures, adjacent, settings, searchFrom, searchTo);
	await writeNote(app, settings, date, content);
}
