export type PaperSource = 'pubmed' | 'biorxiv' | 'europepmc';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface Paper {
	doi?: string;
	pmid?: string;
	ssid?: string;
	title: string;
	authors: string[];
	abstract: string;
	publicationDate: string;
	source: PaperSource;
	url: string;
}

export interface ScoredPaper extends Paper {
	score: number;
	summary: string;
	reason: string;
}

export interface SeenEntry {
	doi?: string;
	pmid?: string;
	ssid?: string;
	title: string;
	dateSeen: string;
}

export interface SeenLog {
	entries: SeenEntry[];
	lastUpdated: string;
}

export interface ResearchFocus {
	label: string;
	description: string;
	pubmedQuerySupplement: string;
}

export interface TopicSubscription {
	id: string;
	enabled: boolean;
	keywordQuery: string;
	focus: ResearchFocus;
}

export interface ScholarSettings {
	inboxFolder: string;
	runOnStartup: boolean;
	subscriptions: TopicSubscription[];
	adjacentQuery: string;
	sources: {
		pubmed: boolean;
		biorxiv: boolean;
		europepmc: boolean;
	};
	thresholds: {
		high: number;
		possible: number;
		showWeak: boolean;
	};
	llm: {
		piPath: string;
		model: string;
		thinkingLevel: ThinkingLevel;
	};
	catchupLimitDays: number;
	pubmedApiKey: string;
}

export interface PluginData {
	lastRunTimestamp: string | null;
	settings: ScholarSettings;
}

export interface TopicRunResult {
	subscription: TopicSubscription;
	scored: ScoredPaper[];
	rejectedPapers: Paper[];
	totalFetched: number;
	totalDeduped: number;
	totalNew: number;
	totalMatched: number;
	message?: string;
	seenPapersToAppend: Paper[];
}

export interface TopicRunFailure {
	subscription: TopicSubscription;
	message: string;
}

export interface AnalyzerResult {
	id: string;
	score: number;
	summary: string;
	reason: string;
}
