import { Paper } from '../../types';
import { fetchJson } from '../../utils/network';
import { cleanAbstractText, splitAuthorString } from '../../utils/strings';

interface BioRxivItem {
	doi?: string;
	title?: string;
	abstract?: string;
	authors?: string;
	date?: string;
	server?: 'biorxiv';
}

interface BioRxivResponse {
	collection?: BioRxivItem[];
}

const PAGE_SIZE = 100;

export async function fetchBioRxiv(from: string, to: string): Promise<Paper[]> {
	const papers: Paper[] = [];

	for (let cursor = 0; ; cursor += PAGE_SIZE) {
		const url = `https://api.biorxiv.org/details/biorxiv/${from}/${to}/${cursor}/json`;
		const response = await fetchJson<BioRxivResponse>(url);
		const batch = response.collection ?? [];

		for (const item of batch) {
			const title = cleanAbstractText(item.title ?? '');
			const abstract = cleanAbstractText(item.abstract ?? '');
			if (!title || !abstract) {
				continue;
			}

			const doi = item.doi?.trim();
			const publicationDate = item.date?.trim() ?? '';
			papers.push({
				doi,
				title,
				authors: splitAuthorString(item.authors ?? ''),
				abstract,
				publicationDate,
				sourcePublicationDate: publicationDate,
				sourceIndexedDate: publicationDate,
				sourceIndexStatus: 'biorxiv-date',
				source: item.server ?? 'biorxiv',
				url: doi ? `https://doi.org/${doi}` : '',
			});
		}

		if (batch.length < PAGE_SIZE) {
			break;
		}
	}

	return papers;
}
