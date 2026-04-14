import { Paper, ScholarSettings } from '../../types';
import { fetchJson } from '../../utils/network';
import { cleanAbstractText, normalizeWhitespace, splitAuthorString } from '../../utils/strings';

interface EuropePmcUrlEntry {
	url?: string;
}

interface EuropePmcResult {
	doi?: string;
	pmid?: string;
	title?: string;
	abstractText?: string;
	authorString?: string;
	firstPublicationDate?: string;
	fullTextUrlList?: {
		fullTextUrl?: EuropePmcUrlEntry[];
	};
}

interface EuropePmcResponse {
	nextCursorMark?: string;
	resultList?: {
		result?: EuropePmcResult[];
	};
}

const PAGE_SIZE = 1000;

function buildEuropePmcUrl(query: string, cursorMark: string): string {
	const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
	url.searchParams.set('query', query);
	url.searchParams.set('format', 'json');
	url.searchParams.set('resultType', 'core');
	url.searchParams.set('pageSize', String(PAGE_SIZE));
	url.searchParams.set('cursorMark', cursorMark);
	return url.toString();
}

export async function fetchEuropePmc(settings: ScholarSettings, from: string, to: string): Promise<Paper[]> {
	const papers: Paper[] = [];
	const query = `(${settings.keywordQuery}) AND (FIRST_PDATE:[${from} TO ${to}])`;
	let cursorMark = '*';

	for (;;) {
		const response = await fetchJson<EuropePmcResponse>(buildEuropePmcUrl(query, cursorMark));
		const batch = response.resultList?.result ?? [];

		for (const item of batch) {
			const title = cleanAbstractText(item.title ?? '');
			const abstract = cleanAbstractText(item.abstractText ?? '');
			if (!title || !abstract) {
				continue;
			}

			const doi = item.doi?.trim();
			const pmid = item.pmid?.trim();
			const fullTextUrl = normalizeWhitespace(item.fullTextUrlList?.fullTextUrl?.[0]?.url ?? '');
			papers.push({
				doi,
				pmid,
				title,
				authors: splitAuthorString(item.authorString ?? ''),
				abstract,
				publicationDate: item.firstPublicationDate?.trim() ?? '',
				source: 'europepmc',
				url: fullTextUrl || (doi ? `https://doi.org/${doi}` : pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : ''),
			});
		}

		const nextCursorMark = response.nextCursorMark;
		if (batch.length < PAGE_SIZE || !nextCursorMark || nextCursorMark === cursorMark) {
			break;
		}

		cursorMark = nextCursorMark;
	}

	return papers;
}
