import { Paper } from '../types';
import { normalizeWhitespace } from '../utils/strings';

interface QueryToken {
	type: 'term' | 'and' | 'or' | 'not' | 'lparen' | 'rparen';
	value?: string;
}

export type QueryNode =
	| { type: 'term'; value: string }
	| { type: 'and'; children: QueryNode[] }
	| { type: 'or'; children: QueryNode[] }
	| { type: 'not'; child: QueryNode };

function trimOuterQuotes(value: string): string {
	return value.replace(/^"|"$/g, '');
}

function cleanTerm(term: string): string {
	return normalizeWhitespace(trimOuterQuotes(term).replace(/\[[^\]]+\]/g, ''));
}

function scanSimpleParenthesizedTerm(query: string, start: number): { value: string; end: number } | null {
	if (query[start] !== '(') {
		return null;
	}

	let content = '';
	let index = start + 1;
	let inQuote = false;

	while (index < query.length) {
		const character = query[index];
		if (character === '"') {
			inQuote = !inQuote;
			content += character;
			index += 1;
			continue;
		}

		if (!inQuote && character === '(') {
			return null;
		}

		if (!inQuote && character === ')') {
			const normalized = normalizeWhitespace(content);
			if (!normalized || /\b(?:AND|OR|NOT)\b/i.test(normalized)) {
				return null;
			}

			const cleaned = cleanTerm(content);
			if (!cleaned) {
				return null;
			}

			return {
				value: cleaned,
				end: index + 1,
			};
		}

		content += character;
		index += 1;
	}

	return null;
}

function scanQuotedTerm(query: string, start: number): { raw: string; end: number } {
	let index = start + 1;
	while (index < query.length && query[index] !== '"') {
		index += 1;
	}
	if (index < query.length && query[index] === '"') {
		index += 1;
	}

	while (index < query.length && query[index] === '[') {
		index += 1;
		while (index < query.length && query[index] !== ']') {
			index += 1;
		}
		if (index < query.length && query[index] === ']') {
			index += 1;
		}
	}

	return {
		raw: query.slice(start, index),
		end: index,
	};
}

function tokenize(query: string): QueryToken[] {
	const tokens: QueryToken[] = [];
	let index = 0;

	while (index < query.length) {
		const character = query[index] ?? '';
		if (/\s/.test(character)) {
			index += 1;
			continue;
		}

		if (character === '(') {
			const simple = scanSimpleParenthesizedTerm(query, index);
			if (simple) {
				tokens.push({ type: 'term', value: simple.value });
				index = simple.end;
				continue;
			}
			tokens.push({ type: 'lparen' });
			index += 1;
			continue;
		}

		if (character === ')') {
			tokens.push({ type: 'rparen' });
			index += 1;
			continue;
		}

		if (character === '"') {
			const quoted = scanQuotedTerm(query, index);
			const cleaned = cleanTerm(quoted.raw);
			if (cleaned) {
				tokens.push({ type: 'term', value: cleaned });
			}
			index = quoted.end;
			continue;
		}

		let end = index;
		while (end < query.length && !/[\s()]/.test(query[end] ?? '')) {
			end += 1;
		}

		const raw = query.slice(index, end);
		if (/^AND$/i.test(raw)) {
			tokens.push({ type: 'and' });
		} else if (/^OR$/i.test(raw)) {
			tokens.push({ type: 'or' });
		} else if (/^NOT$/i.test(raw)) {
			tokens.push({ type: 'not' });
		} else {
			const cleaned = cleanTerm(raw);
			if (cleaned) {
				tokens.push({ type: 'term', value: cleaned });
			}
		}

		index = end;
	}

	return tokens;
}

function collapseNode(type: 'and' | 'or', children: QueryNode[]): QueryNode {
	return children.length === 1 ? children[0]! : { type, children };
}

function isUnaryStart(token?: QueryToken): boolean {
	return token?.type === 'term' || token?.type === 'lparen' || token?.type === 'not';
}

export function parseQuery(query: string): QueryNode | null {
	const normalized = normalizeWhitespace(query);
	if (!normalized) {
		return null;
	}

	const tokens = tokenize(normalized);
	if (tokens.length === 0) {
		return null;
	}

	let index = 0;

	function peek(): QueryToken | undefined {
		return tokens[index];
	}

	function parsePrimary(): QueryNode | null {
		const token = peek();
		if (!token) {
			return null;
		}

		if (token.type === 'term') {
			index += 1;
			return {
				type: 'term',
				value: token.value ?? '',
			};
		}

		if (token.type === 'lparen') {
			index += 1;
			const expression = parseOr();
			if (peek()?.type === 'rparen') {
				index += 1;
			}
			return expression;
		}

		return null;
	}

	function parseUnary(): QueryNode | null {
		const token = peek();
		if (token?.type === 'not') {
			index += 1;
			const child = parseUnary();
			return child ? { type: 'not', child } : null;
		}

		return parsePrimary();
	}

	function parseAnd(): QueryNode | null {
		const first = parseUnary();
		if (!first) {
			return null;
		}

		const children: QueryNode[] = [first];
		while (true) {
			const token = peek();
			if (token?.type === 'and') {
				index += 1;
				const next = parseUnary();
				if (next) {
					children.push(next);
				}
				continue;
			}

			if (isUnaryStart(token)) {
				const next = parseUnary();
				if (next) {
					children.push(next);
					continue;
				}
			}

			break;
		}

		return collapseNode('and', children);
	}

	function parseOr(): QueryNode | null {
		const first = parseAnd();
		if (!first) {
			return null;
		}

		const children: QueryNode[] = [first];
		while (peek()?.type === 'or') {
			index += 1;
			const next = parseAnd();
			if (next) {
				children.push(next);
			}
		}

		return collapseNode('or', children);
	}

	return parseOr();
}

function evaluateQuery(node: QueryNode, haystack: string): boolean {
	switch (node.type) {
		case 'term':
			return haystack.includes(node.value.toLowerCase());
		case 'and':
			return node.children.every((child) => evaluateQuery(child, haystack));
		case 'or':
			return node.children.some((child) => evaluateQuery(child, haystack));
		case 'not':
			return !evaluateQuery(node.child, haystack);
	}
}

function collectTerms(node: QueryNode, includeNegated: boolean): string[] {
	switch (node.type) {
		case 'term':
			return [node.value];
		case 'and':
		case 'or': {
			const terms: string[] = [];
			for (const child of node.children) {
				terms.push(...collectTerms(child, includeNegated));
			}
			return terms;
		}
		case 'not':
			return includeNegated ? collectTerms(node.child, includeNegated) : [];
	}
}

function getPositiveClauses(node: QueryNode | null): QueryNode[] {
	if (!node) {
		return [];
	}

	if (node.type === 'and') {
		return node.children.filter((child) => child.type !== 'not');
	}
	if (node.type === 'not') {
		return [];
	}
	return [node];
}

export function collectPositiveTerms(parsedQuery: QueryNode | null): string[] {
	if (!parsedQuery) {
		return [];
	}

	return [...new Set(collectTerms(parsedQuery, false).map((term) => term.toLowerCase()))];
}

export function countSatisfiedPositiveClauses(paper: Paper, parsedQuery: QueryNode | null): number {
	if (!parsedQuery) {
		return 0;
	}

	const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
	return getPositiveClauses(parsedQuery).filter((clause) => evaluateQuery(clause, haystack)).length;
}

export function matchesPaper(paper: Paper, parsedQuery: QueryNode | null): boolean {
	if (!parsedQuery) {
		return true;
	}

	const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
	return evaluateQuery(parsedQuery, haystack);
}

export function applyKeywordFilter(papers: Paper[], query: string): Paper[] {
	const parsed = parseQuery(query);
	return papers.filter((paper) => matchesPaper(paper, parsed));
}
