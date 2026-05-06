import { Paper, PaperSource } from '../types';
import { getPaperKeys } from '../utils/seenLog';

const SOURCE_PRIORITY: Record<PaperSource, number> = {
	pubmed: 3,
	europepmc: 2,
	biorxiv: 1,
};

function preferString(primary?: string, secondary?: string): string | undefined {
	const a = primary?.trim() ?? '';
	const b = secondary?.trim() ?? '';

	if (!a) {
		return b || undefined;
	}
	if (!b) {
		return a;
	}

	return a.length >= b.length ? a : b;
}

function mergeAuthors(first: string[], second: string[]): string[] {
	const authors = [...first, ...second];
	const seen = new Set<string>();
	const merged: string[] = [];

	for (const author of authors) {
		const normalized = author.trim().toLowerCase();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		merged.push(author.trim());
	}

	return merged;
}

function preferSource(a: PaperSource, b: PaperSource): PaperSource {
	return SOURCE_PRIORITY[a] >= SOURCE_PRIORITY[b] ? a : b;
}

function preferUrl(a: Paper, b: Paper, chosenSource: PaperSource): string {
	if (chosenSource === a.source && a.url) {
		return a.url;
	}
	if (chosenSource === b.source && b.url) {
		return b.url;
	}
	return preferString(a.url, b.url) ?? '';
}

function preferSourceField(a: Paper, b: Paper, chosenSource: PaperSource, field: keyof Pick<Paper, 'sourcePublicationDate' | 'sourceIndexedDate' | 'sourceIndexStatus'>): string | undefined {
	if (chosenSource === a.source && a[field]) {
		return a[field];
	}
	if (chosenSource === b.source && b[field]) {
		return b[field];
	}
	return preferString(a[field], b[field]);
}

export function mergePapers(a: Paper, b: Paper): Paper {
	const source = preferSource(a.source, b.source);
	return {
		doi: preferString(a.doi, b.doi),
		pmid: preferString(a.pmid, b.pmid),
		ssid: preferString(a.ssid, b.ssid),
		title: preferString(a.title, b.title) ?? a.title ?? b.title,
		authors: mergeAuthors(a.authors, b.authors),
		abstract: preferString(a.abstract, b.abstract) ?? '',
		publicationDate: preferString(a.publicationDate, b.publicationDate) ?? '',
		sourcePublicationDate: preferSourceField(a, b, source, 'sourcePublicationDate'),
		sourceIndexedDate: preferSourceField(a, b, source, 'sourceIndexedDate'),
		sourceIndexStatus: preferSourceField(a, b, source, 'sourceIndexStatus'),
		source,
		url: preferUrl(a, b, source),
	};
}

export function deduplicateCrossSource(papers: Paper[]): Paper[] {
	const keyedPapers = new Map<string, Paper>();

	for (const paper of papers) {
		const paperKeys = getPaperKeys(paper);
		const matches = new Set<Paper>();

		for (const key of paperKeys) {
			const existing = keyedPapers.get(key);
			if (existing) {
				matches.add(existing);
			}
		}

		let merged = paper;
		for (const existing of matches) {
			merged = mergePapers(existing, merged);
		}

		const keysToWrite = new Set<string>(paperKeys);
		for (const existing of matches) {
			for (const key of getPaperKeys(existing)) {
				keysToWrite.add(key);
			}
		}
		for (const key of getPaperKeys(merged)) {
			keysToWrite.add(key);
		}

		for (const key of keysToWrite) {
			keyedPapers.set(key, merged);
		}
	}

	return [...new Set(keyedPapers.values())];
}
