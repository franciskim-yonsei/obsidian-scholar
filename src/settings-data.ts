import { ResearchFocus, ScholarSettings, TopicSubscription } from './types';
import { toSafePathSegment } from './utils/strings';

interface LegacyScholarSettings extends Partial<ScholarSettings> {
	keywordQuery?: string;
	focus?: Partial<ResearchFocus>;
}

interface PartialSubscription {
	id?: string;
	enabled?: boolean;
	keywordQuery?: string;
	focus?: Partial<ResearchFocus>;
}

export const DEFAULT_KEYWORD_QUERY = `(cochlea OR "inner ear" OR "hair cell" OR "otic vesicle" OR "spiral ganglion" OR otocyst OR "sensory epithelium" OR "auditory epithelium" OR utricle OR saccule) AND (development OR differentiation OR morphogenesis OR specification OR regeneration OR progenitor)`;
export const DEFAULT_FOCUS_LABEL = 'inner ear development';
export const DEFAULT_FOCUS_DESCRIPTION = 'cochlea, vestibular system, hair cells, spiral ganglion, otic vesicle, auditory and vestibular progenitors, sensory epithelium development, differentiation, and regeneration';
export const DEFAULT_PUBMED_QUERY_SUPPLEMENT = '"Ear, Inner/growth and development"[MeSH] OR "Hair Cells, Auditory"[MeSH]';
export const DEFAULT_SUBSCRIPTION_ID = 'default';
export const DEFAULT_ADJACENT_QUERY = `(single-cell OR scRNA-seq OR multiomics OR "spatial transcriptomics" OR "single-cell ATAC" OR organoid OR "craniofacial development" OR "cell fate" OR "chromatin accessibility" OR "gene regulation" OR "developmental biology" OR "mouse embryo" OR transcriptomics OR epigenomics) AND (development OR differentiation OR sequencing OR morphogenesis OR specification)`;

export function getDefaultPiPath(): string {
	return process.platform === 'win32' ? 'pi.cmd' : 'pi';
}

export const DEFAULT_SUBSCRIPTION: TopicSubscription = {
	id: DEFAULT_SUBSCRIPTION_ID,
	enabled: true,
	keywordQuery: DEFAULT_KEYWORD_QUERY,
	focus: {
		label: DEFAULT_FOCUS_LABEL,
		description: DEFAULT_FOCUS_DESCRIPTION,
		pubmedQuerySupplement: DEFAULT_PUBMED_QUERY_SUPPLEMENT,
	},
};

export const DEFAULT_SETTINGS: ScholarSettings = {
	inboxFolder: 'Inbox',
	runOnStartup: true,
	subscriptions: [DEFAULT_SUBSCRIPTION],
	adjacentQuery: DEFAULT_ADJACENT_QUERY,
	newsletterTags: ['newsletter'],
	sources: {
		pubmed: true,
		biorxiv: false,
		europepmc: true,
	},
	thresholds: {
		high: 75,
		possible: 50,
		showWeak: true,
	},
	llm: {
		piPath: getDefaultPiPath(),
		model: 'openai-codex/gpt-5.4',
		thinkingLevel: 'high',
	},
	catchupLimitDays: 30,
	pubmedApiKey: '',
};

function cloneFocus(focus: ResearchFocus): ResearchFocus {
	return {
		label: focus.label,
		description: focus.description,
		pubmedQuerySupplement: focus.pubmedQuerySupplement,
	};
}

function cloneSubscription(subscription: TopicSubscription): TopicSubscription {
	return {
		id: subscription.id,
		enabled: subscription.enabled,
		keywordQuery: subscription.keywordQuery,
		focus: cloneFocus(subscription.focus),
	};
}

function createGeneratedSubscriptionId(label: string, indexHint: number): string {
	const base = toSafePathSegment(label) || `topic-${indexHint}`;
	return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeFocus(saved?: Partial<ResearchFocus>, fallback: ResearchFocus = DEFAULT_SUBSCRIPTION.focus): ResearchFocus {
	return {
		label: saved?.label?.trim() || fallback.label,
		description: saved?.description?.trim() ?? fallback.description,
		pubmedQuerySupplement: saved?.pubmedQuerySupplement?.trim() ?? fallback.pubmedQuerySupplement,
	};
}

function mergeSubscription(saved?: PartialSubscription, fallback: TopicSubscription = DEFAULT_SUBSCRIPTION, index = 0): TopicSubscription {
	const focus = mergeFocus(saved?.focus, fallback.focus);
	return {
		id: saved?.id?.trim() || fallback.id || createGeneratedSubscriptionId(focus.label, index + 1),
		enabled: saved?.enabled ?? fallback.enabled,
		keywordQuery: saved?.keywordQuery?.trim() ?? fallback.keywordQuery,
		focus,
	};
}

function buildLegacySubscription(saved?: LegacyScholarSettings): TopicSubscription {
	return mergeSubscription(
		{
			id: DEFAULT_SUBSCRIPTION_ID,
			enabled: true,
			keywordQuery: saved?.keywordQuery,
			focus: saved?.focus,
		},
		DEFAULT_SUBSCRIPTION,
		0,
	);
}

function deduplicateSubscriptionIds(subscriptions: TopicSubscription[]): TopicSubscription[] {
	const seen = new Set<string>();
	return subscriptions.map((subscription, index) => {
		let id = toSafePathSegment(subscription.id) || `topic-${index + 1}`;
		if (!seen.has(id)) {
			seen.add(id);
			return {
				...subscription,
				id,
			};
		}

		let suffix = 2;
		while (seen.has(`${id}-${suffix}`)) {
			suffix += 1;
		}
		id = `${id}-${suffix}`;
		seen.add(id);
		return {
			...subscription,
			id,
		};
	});
}

function getMergedSubscriptions(saved?: LegacyScholarSettings): TopicSubscription[] {
	if (Array.isArray(saved?.subscriptions) && saved.subscriptions.length > 0) {
		return deduplicateSubscriptionIds(
			saved.subscriptions.map((subscription, index) =>
				mergeSubscription(subscription, index === 0 ? DEFAULT_SUBSCRIPTION : createTopicSubscription(`Topic ${index + 1}`), index),
			),
		);
	}

	return [buildLegacySubscription(saved)];
}

export function createTopicSubscription(label = 'New topic'): TopicSubscription {
	const trimmedLabel = label.trim() || 'New topic';
	return {
		id: createGeneratedSubscriptionId(trimmedLabel, 1),
		enabled: true,
		keywordQuery: '',
		focus: {
			label: trimmedLabel,
			description: '',
			pubmedQuerySupplement: '',
		},
	};
}

export function getEnabledSubscriptions(settings: ScholarSettings): TopicSubscription[] {
	return settings.subscriptions.filter((subscription) => subscription.enabled);
}

export function mergeSettings(saved?: LegacyScholarSettings): ScholarSettings {
	return {
		inboxFolder: saved?.inboxFolder ?? DEFAULT_SETTINGS.inboxFolder,
		runOnStartup: saved?.runOnStartup ?? DEFAULT_SETTINGS.runOnStartup,
		subscriptions: getMergedSubscriptions(saved),
		adjacentQuery: saved?.adjacentQuery ?? DEFAULT_SETTINGS.adjacentQuery,
		newsletterTags: Array.isArray(saved?.newsletterTags) && saved.newsletterTags.length > 0
			? saved.newsletterTags
			: DEFAULT_SETTINGS.newsletterTags,
		sources: {
			pubmed: saved?.sources?.pubmed ?? DEFAULT_SETTINGS.sources.pubmed,
			biorxiv: saved?.sources?.biorxiv ?? DEFAULT_SETTINGS.sources.biorxiv,
			europepmc: saved?.sources?.europepmc ?? DEFAULT_SETTINGS.sources.europepmc,
		},
		thresholds: {
			high: saved?.thresholds?.high ?? DEFAULT_SETTINGS.thresholds.high,
			possible: saved?.thresholds?.possible ?? DEFAULT_SETTINGS.thresholds.possible,
			showWeak: saved?.thresholds?.showWeak ?? DEFAULT_SETTINGS.thresholds.showWeak,
		},
		llm: {
			piPath: saved?.llm?.piPath ?? DEFAULT_SETTINGS.llm.piPath,
			model: saved?.llm?.model ?? DEFAULT_SETTINGS.llm.model,
			thinkingLevel: saved?.llm?.thinkingLevel ?? DEFAULT_SETTINGS.llm.thinkingLevel,
		},
		catchupLimitDays: saved?.catchupLimitDays ?? DEFAULT_SETTINGS.catchupLimitDays,
		pubmedApiKey: saved?.pubmedApiKey ?? DEFAULT_SETTINGS.pubmedApiKey,
	};
}

export function normalizeSubscriptions(settings: ScholarSettings): void {
	if (settings.subscriptions.length === 0) {
		settings.subscriptions = [cloneSubscription(DEFAULT_SUBSCRIPTION)];
	}

	settings.subscriptions = deduplicateSubscriptionIds(
		settings.subscriptions.map((subscription, index) =>
			mergeSubscription(
				subscription,
				index === 0 ? DEFAULT_SUBSCRIPTION : createTopicSubscription(`Topic ${index + 1}`),
				index,
			),
		),
	);
}

export function clampThresholds(settings: ScholarSettings): void {
	settings.thresholds.possible = Math.max(0, Math.min(100, settings.thresholds.possible));
	settings.thresholds.high = Math.max(settings.thresholds.possible, Math.min(100, settings.thresholds.high));
}
