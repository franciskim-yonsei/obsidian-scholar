import { ScholarSettings, ScoredPaper, TopicRunFailure, TopicRunResult, TopicSubscription } from '../types';

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


function getScoreBuckets(scored: ScoredPaper[], settings: ScholarSettings): {
	high: ScoredPaper[];
	possible: ScoredPaper[];
	weak: ScoredPaper[];
} {
	return {
		high: scored.filter((paper) => paper.score >= settings.thresholds.high),
		possible: scored.filter((paper) => paper.score >= settings.thresholds.possible && paper.score < settings.thresholds.high),
		weak: scored.filter((paper) => paper.score < settings.thresholds.possible),
	};
}

function renderPaperHeading(title: string, url: string, level = '###'): string {
	return url ? `${level} [${title}](${url})` : `${level} ${title}`;
}

function renderTopicBody(lines: string[], scored: ScoredPaper[], settings: ScholarSettings, headingLevel: '###' | '####'): void {
	const { high, possible, weak } = getScoreBuckets(scored, settings);

	if (high.length > 0) {
		lines.push(`${headingLevel} High relevance`);
		lines.push('');
		for (const paper of high) {
			lines.push(renderPaperHeading(paper.title, paper.url, headingLevel === '###' ? '####' : '#####'));
			lines.push(`${formatAuthors(paper.authors)} · ${paper.source} · ${paper.publicationDate}`);
			lines.push(`**Relevance (${paper.score}/100):** ${paper.reason}`);
			lines.push(`> ${paper.summary}`);
			lines.push('');
		}
	}

	if (possible.length > 0) {
		lines.push(`${headingLevel} Possible match`);
		lines.push('');
		for (const paper of possible) {
			const linkedTitle = paper.url ? `**[${paper.title}](${paper.url})**` : `**${paper.title}**`;
			lines.push(`- ${linkedTitle} (${paper.score}/100) — ${formatAuthors(paper.authors)} · ${paper.source} · ${paper.publicationDate}`);
			lines.push(`  *${paper.reason}*`);
		}
		lines.push('');
	}

	if (settings.thresholds.showWeak && weak.length > 0) {
		lines.push(`${headingLevel} Weak match`);
		lines.push('');
		for (const paper of weak) {
			const linkedTitle = paper.url ? `[${paper.title}](${paper.url})` : paper.title;
			lines.push(`- ${linkedTitle} (${paper.score}/100) · ${paper.source} · ${paper.publicationDate}`);
		}
		lines.push('');
	}
}

function renderFrontmatter(date: string, tags: string[]): string[] {
	return [
		'---',
		`date: ${date}`,
		'tags:',
		...tags.map((tag) => `  - ${tag}`),
		'---',
		'',
	];
}

export function renderNewsletter(
	subscription: TopicSubscription,
	date: string,
	scored: ScoredPaper[],
	settings: ScholarSettings,
	stats: NewsletterStats,
): string {
	const lines: string[] = [];

	lines.push(...renderFrontmatter(date, settings.newsletterTags));
	lines.push(`# Scholar Daily: ${subscription.focus.label} — ${date}`);
	lines.push(`*${stats.totalMatched} matched paper${stats.totalMatched === 1 ? '' : 's'} from ${stats.totalNew} new candidate${stats.totalNew === 1 ? '' : 's'}*`);
	lines.push('');

	if (scored.length === 0) {
		lines.push('No new papers matched the current keyword filter for this topic on this date.');
		return lines.join('\n');
	}

	renderTopicBody(lines, scored, settings, '###');
	return lines.join('\n');
}

export function renderEmptyNewsletter(
	subscription: TopicSubscription,
	date: string,
	_stats: NewsletterStats,
	message: string,
	settings: ScholarSettings,
): string {
	const lines: string[] = [];
	lines.push(...renderFrontmatter(date, settings.newsletterTags));
	lines.push(`# Scholar Daily: ${subscription.focus.label} — ${date}`);
	lines.push('');
	lines.push(message);
	return lines.join('\n');
}


function renderAdjacentSection(lines: string[], adjacent: ScoredPaper[]): void {
	lines.push('## Adjacent science');
	lines.push('');
	if (adjacent.length === 0) {
		lines.push('*No adjacent papers met the relevance threshold today.*');
		lines.push('');
		return;
	}
	lines.push('*Papers outside your subscribed topics — scored for methodological or conceptual relevance*');
	lines.push('');
	for (const paper of adjacent) {
		const linkedTitle = paper.url ? `**[${paper.title}](${paper.url})**` : `**${paper.title}**`;
		lines.push(`- ${linkedTitle} (${paper.score}/100) — ${formatAuthors(paper.authors)} · ${paper.source} · ${paper.publicationDate}`);
		lines.push(`  *${paper.reason}*`);
	}
	lines.push('');
}

export function renderCombinedNewsletter(
	date: string,
	results: TopicRunResult[],
	failures: TopicRunFailure[],
	adjacent: ScoredPaper[],
	settings: ScholarSettings,
): string {
	const lines: string[] = [];
	const totalMatched = results.reduce((sum, result) => sum + result.totalMatched, 0);
	const totalNew = results.reduce((sum, result) => sum + result.totalNew, 0);

	lines.push(...renderFrontmatter(date, settings.newsletterTags));
	lines.push(`# Scholar Daily: ${date}`);
	lines.push(`*${totalMatched} matched paper${totalMatched === 1 ? '' : 's'} across ${results.length} successful topic${results.length === 1 ? '' : 's'} from ${totalNew} new candidate${totalNew === 1 ? '' : 's'}*`);
	lines.push('');

	if (failures.length > 0) {
		lines.push('## Failed topics');
		lines.push('');
		for (const failure of failures) {
			lines.push(`- **${failure.subscription.focus.label}** (${failure.subscription.id}) — ${failure.message}`);
		}
		lines.push('');
	}

	if (results.length === 0) {
		lines.push('No topic results were available for this date.');
		return lines.join('\n');
	}

	for (const result of results) {
		lines.push(`## ${result.subscription.focus.label}`);
		lines.push('');
		if (result.scored.length === 0) {
			lines.push(result.message ?? 'No new papers matched this topic on this date.');
			lines.push('');
			continue;
		}

		renderTopicBody(lines, result.scored, settings, '###');
	}

	if (adjacent.length > 0 || settings.adjacentQuery.trim()) {
		renderAdjacentSection(lines, adjacent);
	}

	return lines.join('\n');
}
