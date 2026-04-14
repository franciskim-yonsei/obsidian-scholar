import { normalizePath, Vault } from 'obsidian';
import { Paper, SeenEntry, SeenLog } from '../types';
import { titleKey } from './strings';
import { ensureFolderExists } from './vault';

const SEEN_FOLDER = '.scholar';
const SEEN_LOG_PATH = normalizePath(`${SEEN_FOLDER}/seen.json`);

function normalizeIdentifier(value: string): string {
	return value.trim().toLowerCase();
}

function getSeenEntryKeys(entry: SeenEntry): string[] {
	const keys: string[] = [];

	if (entry.doi) {
		keys.push(`doi:${normalizeIdentifier(entry.doi)}`);
	}
	if (entry.pmid) {
		keys.push(`pmid:${entry.pmid.trim()}`);
	}
	if (entry.ssid) {
		keys.push(`ssid:${normalizeIdentifier(entry.ssid)}`);
	}

	const paperTitleKey = titleKey(entry.title);
	if (paperTitleKey) {
		keys.push(paperTitleKey);
	}

	return keys;
}

export function getPaperKeys(paper: Paper): string[] {
	const entry: SeenEntry = {
		doi: paper.doi,
		pmid: paper.pmid,
		ssid: paper.ssid,
		title: paper.title,
		dateSeen: paper.publicationDate,
	};

	return getSeenEntryKeys(entry);
}

export function buildSeenSet(log: SeenLog): Set<string> {
	const keys = new Set<string>();
	for (const entry of log.entries) {
		for (const key of getSeenEntryKeys(entry)) {
			keys.add(key);
		}
	}
	return keys;
}

export async function loadSeenLog(vault: Vault): Promise<SeenLog> {
	if (!(await vault.adapter.exists(SEEN_LOG_PATH))) {
		return {
			entries: [],
			lastUpdated: '',
		};
	}

	try {
		const raw = await vault.adapter.read(SEEN_LOG_PATH);
		const parsed = JSON.parse(raw) as Partial<SeenLog>;
		return {
			entries: Array.isArray(parsed.entries) ? parsed.entries : [],
			lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : '',
		};
	} catch (error) {
		console.error('Scholar: failed to read seen log, using an empty log instead.', error);
		return {
			entries: [],
			lastUpdated: '',
		};
	}
}

export async function saveSeenLog(vault: Vault, log: SeenLog): Promise<void> {
	await ensureFolderExists(vault, SEEN_FOLDER);
	await vault.adapter.write(SEEN_LOG_PATH, JSON.stringify(log, null, 2));
}
