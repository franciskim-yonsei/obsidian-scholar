import { ScholarSettings, Paper, TopicSubscription } from '../../types';
import { toPubMedDate } from '../../utils/dates';
import { delay, fetchJson, fetchText } from '../../utils/network';
import { cleanAbstractText, normalizeWhitespace } from '../../utils/strings';

interface PubMedSearchResponse {
	esearchresult?: {
		idlist?: string[];
	};
}

const MONTHS: Record<string, string> = {
	jan: '01',
	feb: '02',
	mar: '03',
	apr: '04',
	may: '05',
	jun: '06',
	jul: '07',
	aug: '08',
	sep: '09',
	oct: '10',
	nov: '11',
	dec: '12',
};

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function getChildText(parent: Element, tagName: string): string {
	return normalizeWhitespace(parent.getElementsByTagName(tagName)[0]?.textContent ?? '');
}

function getArticleId(article: Element, idType: string): string | undefined {
	const articleIds = Array.from(article.getElementsByTagName('ArticleId'));
	const match = articleIds.find((item) => item.getAttribute('IdType')?.toLowerCase() === idType);
	const value = normalizeWhitespace(match?.textContent ?? '');
	return value || undefined;
}

function parseAuthors(article: Element): string[] {
	const authors = Array.from(article.getElementsByTagName('Author'));
	return authors
		.map((author) => {
			const collectiveName = getChildText(author, 'CollectiveName');
			if (collectiveName) {
				return collectiveName;
			}

			const lastName = getChildText(author, 'LastName');
			const initials = getChildText(author, 'Initials') || getChildText(author, 'ForeName');
			return normalizeWhitespace(`${lastName} ${initials}`);
		})
		.filter((author) => author.length > 0);
}

function parsePubDate(article: Element): string {
	const articleDate = article.getElementsByTagName('ArticleDate')[0];
	const dateNode = articleDate ?? article.getElementsByTagName('PubDate')[0];
	if (!dateNode) {
		return '';
	}

	const year = getChildText(dateNode, 'Year') || (getChildText(dateNode, 'MedlineDate').match(/\d{4}/)?.[0] ?? '');
	if (!year) {
		return '';
	}

	const rawMonth = getChildText(dateNode, 'Month');
	const rawDay = getChildText(dateNode, 'Day');

	const month = /^\d{1,2}$/.test(rawMonth)
		? rawMonth.padStart(2, '0')
		: MONTHS[rawMonth.toLowerCase().slice(0, 3)] ?? '01';
	const day = /^\d{1,2}$/.test(rawDay) ? rawDay.padStart(2, '0') : '01';

	return `${year}-${month}-${day}`;
}

function parseArticles(xml: string): Paper[] {
	const document = new DOMParser().parseFromString(xml, 'text/xml');
	const articles = Array.from(document.getElementsByTagName('PubmedArticle'));

	return articles
		.map((article): Paper | null => {
			const title = cleanAbstractText(article.getElementsByTagName('ArticleTitle')[0]?.textContent ?? '');
			const abstractNodes = Array.from(article.getElementsByTagName('AbstractText'));
			const abstract = cleanAbstractText(abstractNodes.map((node) => node.textContent ?? '').join(' '));
			const doi = getArticleId(article, 'doi');
			const pmid = getArticleId(article, 'pubmed') ?? (getChildText(article, 'PMID') || undefined);
			const publicationDate = parsePubDate(article);

			if (!title || !abstract) {
				return null;
			}

			return {
				doi,
				pmid,
				title,
				authors: parseAuthors(article),
				abstract,
				publicationDate,
				source: 'pubmed',
				url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : doi ? `https://doi.org/${doi}` : '',
			};
		})
		.filter((paper): paper is Paper => paper !== null);
}

function buildPubMedQuery(subscription: TopicSubscription): string {
	const baseQuery = subscription.keywordQuery.trim();
	const supplement = subscription.focus.pubmedQuerySupplement.trim();
	if (baseQuery && supplement) {
		return `(${baseQuery}) OR (${supplement})`;
	}
	return baseQuery || supplement || subscription.focus.label.trim();
}

export async function fetchPubMed(
	settings: ScholarSettings,
	subscription: TopicSubscription,
	from: string,
	to: string,
): Promise<Paper[]> {
	const fromDate = from ? toPubMedDate(new Date(`${from}T00:00:00`)) : from;
	const toDate = to ? toPubMedDate(new Date(`${to}T00:00:00`)) : to;
	const apiKey = settings.pubmedApiKey.trim();
	const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
	searchUrl.searchParams.set('db', 'pubmed');
	searchUrl.searchParams.set('term', buildPubMedQuery(subscription));
	searchUrl.searchParams.set('retmax', '1000');
	searchUrl.searchParams.set('datetype', 'pdat');
	searchUrl.searchParams.set('mindate', fromDate);
	searchUrl.searchParams.set('maxdate', toDate);
	searchUrl.searchParams.set('retmode', 'json');
	if (apiKey) {
		searchUrl.searchParams.set('api_key', apiKey);
	}

	const searchResponse = await fetchJson<PubMedSearchResponse>(searchUrl.toString());
	const ids = searchResponse.esearchresult?.idlist ?? [];
	if (ids.length === 0) {
		return [];
	}

	const papers: Paper[] = [];
	const batches = chunk(ids, 200);

	for (const [index, batch] of batches.entries()) {
		const fetchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
		fetchUrl.searchParams.set('db', 'pubmed');
		fetchUrl.searchParams.set('id', batch.join(','));
		fetchUrl.searchParams.set('rettype', 'abstract');
		fetchUrl.searchParams.set('retmode', 'xml');
		if (apiKey) {
			fetchUrl.searchParams.set('api_key', apiKey);
		}

		const xml = await fetchText(fetchUrl.toString());
		papers.push(...parseArticles(xml));

		if (index < batches.length - 1) {
			await delay(350);
		}
	}

	return papers;
}
