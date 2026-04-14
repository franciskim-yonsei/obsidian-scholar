import { Paper } from '../types';
import { normalizeWhitespace } from '../utils/strings';

function splitTopLevel(value: string, operator: 'AND' | 'OR'): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let inQuote = false;
	let index = 0;

	while (index < value.length) {
		const character = value[index];

		if (character === '"') {
			inQuote = !inQuote;
			current += character;
			index += 1;
			continue;
		}

		if (!inQuote) {
			if (character === '(') {
				depth += 1;
			} else if (character === ')' && depth > 0) {
				depth -= 1;
			}

			const remainder = value.slice(index);
			const operatorMatch = remainder.match(new RegExp(`^\\s+${operator}\\s+`, 'i'));
			if (depth === 0 && operatorMatch) {
				parts.push(current.trim());
				current = '';
				index += operatorMatch[0].length;
				continue;
			}
		}

		current += character;
		index += 1;
	}

	if (current.trim().length > 0) {
		parts.push(current.trim());
	}

	return parts;
}

function trimOuterParens(value: string): string {
	let trimmed = value.trim();

	while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
		let depth = 0;
		let enclosesWholeString = true;
		for (let index = 0; index < trimmed.length; index += 1) {
			const character = trimmed[index];
			if (character === '(') {
				depth += 1;
			} else if (character === ')') {
				depth -= 1;
				if (depth === 0 && index < trimmed.length - 1) {
					enclosesWholeString = false;
					break;
				}
			}
		}

		if (!enclosesWholeString) {
			break;
		}

		trimmed = trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

function cleanTerm(term: string): string {
	return normalizeWhitespace(
		trimOuterParens(term)
			.replace(/^"|"$/g, '')
			.replace(/\[[^\]]+\]/g, '')
	);
}

export function parseQuery(query: string): string[][] {
	const normalized = normalizeWhitespace(query);
	if (!normalized) {
		return [];
	}

	return splitTopLevel(normalized, 'AND')
		.map((group) => splitTopLevel(trimOuterParens(group), 'OR').map(cleanTerm).filter(Boolean))
		.filter((group) => group.length > 0);
}

export function matchesPaper(paper: Paper, parsedQuery: string[][]): boolean {
	if (parsedQuery.length === 0) {
		return true;
	}

	const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
	return parsedQuery.every((orGroup) =>
		orGroup.some((term) => haystack.includes(term.toLowerCase())),
	);
}

export function applyKeywordFilter(papers: Paper[], query: string): Paper[] {
	const parsed = parseQuery(query);
	return papers.filter((paper) => matchesPaper(paper, parsed));
}
