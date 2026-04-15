import { Paper, ScholarSettings, TopicSubscription } from '../types';
import { getErrorMessage } from '../utils/strings';
import { fetchBioRxiv } from './sources/biorxiv';
import { fetchEuropePmc } from './sources/europepmc';
import { fetchPubMed } from './sources/pubmed';

interface FetchTask {
	name: string;
	run: () => Promise<Paper[]>;
}

export interface FetchFailure {
	name: string;
	message: string;
}

export interface FetchResult {
	papers: Paper[];
	failures: FetchFailure[];
}

export async function fetchAll(
	settings: ScholarSettings,
	subscription: TopicSubscription,
	from: string,
	to: string,
): Promise<FetchResult> {
	const tasks: FetchTask[] = [];

	if (settings.sources.pubmed) {
		tasks.push({ name: 'PubMed', run: () => fetchPubMed(settings, subscription, from, to) });
	}
	if (settings.sources.biorxiv) {
		tasks.push({ name: 'bioRxiv', run: () => fetchBioRxiv(from, to) });
	}
	if (settings.sources.europepmc) {
		tasks.push({ name: 'Europe PMC', run: () => fetchEuropePmc(settings, subscription, from, to) });
	}

	const settled = await Promise.allSettled(tasks.map((task) => task.run()));
	const papers: Paper[] = [];
	const failures: FetchFailure[] = [];

	for (const [index, result] of settled.entries()) {
		const task = tasks[index];
		if (!task) {
			continue;
		}

		if (result.status === 'fulfilled') {
			papers.push(...result.value);
			continue;
		}

		const message = getErrorMessage(result.reason);
		console.error(`Scholar: ${task.name} fetch failed: ${message}`, result.reason);
		failures.push({
			name: task.name,
			message,
		});
	}

	return {
		papers,
		failures,
	};
}
