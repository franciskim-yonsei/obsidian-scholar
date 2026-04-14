import { App, TFile, normalizePath } from 'obsidian';
import { ScholarSettings, ScoredPaper } from '../types';
import { renderEmptyNewsletter, renderNewsletter } from './render';
import { ensureFolderExists } from '../utils/vault';

async function writeNote(app: App, settings: ScholarSettings, date: string, content: string): Promise<void> {
	const folder = settings.inboxFolder.trim();
	if (folder) {
		await ensureFolderExists(app.vault, folder);
	}

	const relativePath = folder ? `${folder}/Scholar ${date}.md` : `Scholar ${date}.md`;
	const path = normalizePath(relativePath);
	const existing = app.vault.getAbstractFileByPath(path);

	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return;
	}

	await app.vault.create(path, content);
}

export async function writeNewsletter(
	app: App,
	settings: ScholarSettings,
	date: string,
	scored: ScoredPaper[],
	totalFetched: number,
	totalDeduped: number,
	totalNew: number,
): Promise<void> {
	const content = renderNewsletter(date, scored, settings, {
		totalFetched,
		totalDeduped,
		totalNew,
		totalMatched: scored.length,
	});
	await writeNote(app, settings, date, content);
}

export async function writeEmptyNewsletter(
	app: App,
	settings: ScholarSettings,
	date: string,
	totalFetched: number,
	totalDeduped: number,
	totalNew: number,
	message: string,
): Promise<void> {
	const content = renderEmptyNewsletter(
		date,
		{
			totalFetched,
			totalDeduped,
			totalNew,
			totalMatched: 0,
		},
		message,
	);
	await writeNote(app, settings, date, content);
}
