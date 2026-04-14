import { Paper, SeenEntry } from '../types';

export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
	return normalizeWhitespace(title)
		.toLowerCase()
		.replace(/[“”]/g, '"')
		.replace(/[’]/g, "'")
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function titleKey(title: string): string | null {
	const normalized = normalizeTitle(title);
	return normalized.length > 0 ? `title:${normalized}` : null;
}

export function getPaperIdentifier(paper: Paper, fallbackIndex?: number): string {
	return paper.doi ?? paper.pmid ?? paper.ssid ?? titleKey(paper.title) ?? `paper-${fallbackIndex ?? 0}`;
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return typeof error === 'string' ? error : 'Unknown error';
}

export function cleanAbstractText(value: string): string {
	return normalizeWhitespace(value)
		.replace(/\s+([,.;:!?])/g, '$1')
		.trim();
}

export function splitAuthorString(value: string): string[] {
	return value
		.split(/[,;]+/)
		.map((author) => normalizeWhitespace(author))
		.filter((author) => author.length > 0);
}

export function getSeenEntryTitleKey(entry: SeenEntry): string | null {
	return titleKey(entry.title);
}
