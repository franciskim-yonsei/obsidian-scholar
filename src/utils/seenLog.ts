import { Paper, SeenEntry, SeenLog } from '../types';
import { titleKey } from './strings';

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

export function getEmptySeenLog(): SeenLog {
	return {
		entries: [],
		lastUpdated: '',
	};
}

export function normalizeSeenLog(log: Partial<SeenLog> | undefined): SeenLog {
	return {
		entries: Array.isArray(log?.entries) ? log.entries : [],
		lastUpdated: typeof log?.lastUpdated === 'string' ? log.lastUpdated : '',
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
