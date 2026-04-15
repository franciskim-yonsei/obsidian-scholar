import { normalizePath, Vault } from 'obsidian';
import { Paper, SeenEntry, SeenLog } from '../types';
import { titleKey, toSafePathSegment } from './strings';
import { ensureFolderExists } from './vault';

const SCHOLAR_FOLDER = '.scholar';
const SEEN_FOLDER = normalizePath(`${SCHOLAR_FOLDER}/seen`);
const LEGACY_SEEN_LOG_PATH = normalizePath(`${SCHOLAR_FOLDER}/seen.json`);

function getSeenLogPath(subscriptionId: string): string {
	const fileName = toSafePathSegment(subscriptionId) || 'default';
	return normalizePath(`${SEEN_FOLDER}/${fileName}.json`);
}

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

function getEmptySeenLog(): SeenLog {
	return {
		entries: [],
		lastUpdated: '',
	};
}

async function readSeenLog(vault: Vault, path: string): Promise<SeenLog> {
	const raw = await vault.adapter.read(path);
	const parsed = JSON.parse(raw) as Partial<SeenLog>;
	return {
		entries: Array.isArray(parsed.entries) ? parsed.entries : [],
		lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : '',
	};
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

export async function loadSeenLog(vault: Vault, subscriptionId: string): Promise<SeenLog> {
	const path = getSeenLogPath(subscriptionId);
	try {
		if (await vault.adapter.exists(path)) {
			return await readSeenLog(vault, path);
		}
		if (subscriptionId === 'default' && await vault.adapter.exists(LEGACY_SEEN_LOG_PATH)) {
			return await readSeenLog(vault, LEGACY_SEEN_LOG_PATH);
		}
		return getEmptySeenLog();
	} catch (error) {
		console.error('Scholar: failed to read seen log, using an empty log instead.', error);
		return getEmptySeenLog();
	}
}

export async function saveSeenLog(vault: Vault, subscriptionId: string, log: SeenLog): Promise<void> {
	await ensureFolderExists(vault, SEEN_FOLDER);
	await vault.adapter.write(getSeenLogPath(subscriptionId), JSON.stringify(log, null, 2));
}
