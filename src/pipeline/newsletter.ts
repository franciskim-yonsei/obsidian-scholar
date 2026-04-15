import { App, TFile, normalizePath } from 'obsidian';
import { ScholarSettings, ScoredPaper, TopicRunFailure, TopicRunResult } from '../types';
import { ensureFolderExists } from '../utils/vault';
import { renderCombinedNewsletter } from './render';

function getNewsletterPath(settings: ScholarSettings, date: string): string {
	const folder = settings.inboxFolder.trim();
	const relativePath = folder ? `${folder}/Scholar ${date}.md` : `Scholar ${date}.md`;
	return normalizePath(relativePath);
}

async function writeNote(app: App, settings: ScholarSettings, date: string, content: string): Promise<void> {
	const folder = settings.inboxFolder.trim();
	if (folder) {
		await ensureFolderExists(app.vault, folder);
	}

	const path = getNewsletterPath(settings, date);
	const existing = app.vault.getAbstractFileByPath(path);

	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return;
	}

	await app.vault.create(path, content);
}

export async function writeCombinedNewsletter(
	app: App,
	settings: ScholarSettings,
	date: string,
	results: TopicRunResult[],
	failures: TopicRunFailure[],
	adjacent: ScoredPaper[] = [],
): Promise<void> {
	const content = renderCombinedNewsletter(date, results, failures, adjacent, settings);
	await writeNote(app, settings, date, content);
}
