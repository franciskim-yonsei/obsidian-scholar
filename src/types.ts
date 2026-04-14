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

export interface ScholarSettings {
	inboxFolder: string;
	keywordQuery: string;
	runOnStartup: boolean;
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

export interface AnalyzerResult {
	id: string;
	score: number;
	summary: string;
	reason: string;
}
