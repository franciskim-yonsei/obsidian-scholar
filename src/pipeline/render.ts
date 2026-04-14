import { ScholarSettings, ScoredPaper } from '../types';

export interface NewsletterStats {
	totalFetched: number;
	totalDeduped: number;
	totalNew: number;
	totalMatched: number;
}

export function formatAuthors(authors: string[]): string {
	if (authors.length === 0) {
		return 'Unknown authors';
	}
	if (authors.length <= 2) {
		return authors.join(', ');
	}
	return `${authors[0]} et al.`;
}

function renderFrontmatter(date: string, stats: NewsletterStats, high: number, possible: number, weak: number): string[] {
	return [
		'---',
		`date: ${date}`,
		`papers_fetched: ${stats.totalFetched}`,
		`papers_deduped: ${stats.totalDeduped}`,
		`papers_new: ${stats.totalNew}`,
		`papers_matched: ${stats.totalMatched}`,
		`high: ${high}`,
		`possible: ${possible}`,
		`weak: ${weak}`,
		'---',
		'',
	];
}

function renderPaperHeading(title: string, url: string): string {
	return url ? `### [${title}](${url})` : `### ${title}`;
}

export function renderNewsletter(
	date: string,
	scored: ScoredPaper[],
	settings: ScholarSettings,
	stats: NewsletterStats,
): string {
	const high = scored.filter((paper) => paper.score >= settings.thresholds.high);
	const possible = scored.filter(
		(paper) => paper.score >= settings.thresholds.possible && paper.score < settings.thresholds.high,
	);
	const weak = scored.filter((paper) => paper.score < settings.thresholds.possible);
	const lines: string[] = [];

	lines.push(...renderFrontmatter(date, stats, high.length, possible.length, weak.length));
	lines.push(`# Scholar Daily: ${date}`);
	lines.push(
		`*${stats.totalMatched} matched paper${stats.totalMatched === 1 ? '' : 's'} from ${stats.totalNew} new candidate${stats.totalNew === 1 ? '' : 's'}*`,
	);
	lines.push('');

	if (scored.length === 0) {
		lines.push('No new papers matched the current keyword filter for this date.');
		return lines.join('\n');
	}

	if (high.length > 0) {
		lines.push('## High relevance');
		lines.push('');
		for (const paper of high) {
			lines.push(renderPaperHeading(paper.title, paper.url));
			lines.push(`${formatAuthors(paper.authors)} · ${paper.source} · ${paper.publicationDate}`);
			lines.push(`**Relevance (${paper.score}/100):** ${paper.reason}`);
			lines.push(`> ${paper.summary}`);
			lines.push('');
		}
	}

	if (possible.length > 0) {
		lines.push('## Possible match');
		lines.push('');
		for (const paper of possible) {
			const linkedTitle = paper.url ? `**[${paper.title}](${paper.url})**` : `**${paper.title}**`;
			lines.push(`- ${linkedTitle} (${paper.score}/100) — ${formatAuthors(paper.authors)} · ${paper.source} · ${paper.publicationDate}`);
			lines.push(`  *${paper.reason}*`);
		}
		lines.push('');
	}

	if (settings.thresholds.showWeak && weak.length > 0) {
		lines.push('## Weak match');
		lines.push('');
		for (const paper of weak) {
			const linkedTitle = paper.url ? `[${paper.title}](${paper.url})` : paper.title;
			lines.push(`- ${linkedTitle} (${paper.score}/100) · ${paper.source} · ${paper.publicationDate}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

export function renderEmptyNewsletter(date: string, stats: NewsletterStats, message: string): string {
	const lines: string[] = [];
	lines.push(...renderFrontmatter(date, stats, 0, 0, 0));
	lines.push(`# Scholar Daily: ${date}`);
	lines.push('');
	lines.push(message);
	return lines.join('\n');
}
