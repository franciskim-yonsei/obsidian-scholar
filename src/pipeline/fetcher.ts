import { Paper, ScholarSettings } from '../types';
import { getErrorMessage } from '../utils/strings';
import { fetchBioRxiv } from './sources/biorxiv';
import { fetchEuropePmc } from './sources/europepmc';
import { fetchPubMed } from './sources/pubmed';

interface FetchTask {
	name: string;
	run: () => Promise<Paper[]>;
}

export async function fetchAll(settings: ScholarSettings, from: string, to: string): Promise<Paper[]> {
	const tasks: FetchTask[] = [];

	if (settings.sources.pubmed) {
		tasks.push({ name: 'PubMed', run: () => fetchPubMed(settings, from, to) });
	}
	if (settings.sources.biorxiv) {
		tasks.push({ name: 'bioRxiv', run: () => fetchBioRxiv(from, to) });
	}
	if (settings.sources.europepmc) {
		tasks.push({ name: 'Europe PMC', run: () => fetchEuropePmc(settings, from, to) });
	}

	const settled = await Promise.allSettled(tasks.map((task) => task.run()));
	const papers: Paper[] = [];

	for (const [index, result] of settled.entries()) {
		const task = tasks[index];
		if (!task) {
			continue;
		}

		if (result.status === 'fulfilled') {
			papers.push(...result.value);
			continue;
		}

		console.error(`Scholar: ${task.name} fetch failed: ${getErrorMessage(result.reason)}`, result.reason);
	}

	return papers;
}
