import { ScholarSettings } from './types';

export const DEFAULT_KEYWORD_QUERY = `(cochlea OR "inner ear" OR "hair cell" OR "otic vesicle" OR "spiral ganglion" OR otocyst OR "sensory epithelium" OR "auditory epithelium" OR utricle OR saccule) AND (development OR differentiation OR morphogenesis OR specification OR regeneration OR progenitor)`;

export function getDefaultPiPath(): string {
	return process.platform === 'win32' ? 'pi.cmd' : 'pi';
}

export const DEFAULT_SETTINGS: ScholarSettings = {
	inboxFolder: 'Inbox',
	keywordQuery: DEFAULT_KEYWORD_QUERY,
	runOnStartup: true,
	sources: {
		pubmed: true,
		biorxiv: true,
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

export function mergeSettings(saved?: Partial<ScholarSettings>): ScholarSettings {
	return {
		inboxFolder: saved?.inboxFolder ?? DEFAULT_SETTINGS.inboxFolder,
		keywordQuery: saved?.keywordQuery ?? DEFAULT_SETTINGS.keywordQuery,
		runOnStartup: saved?.runOnStartup ?? DEFAULT_SETTINGS.runOnStartup,
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

export function clampThresholds(settings: ScholarSettings): void {
	settings.thresholds.possible = Math.max(0, Math.min(100, settings.thresholds.possible));
	settings.thresholds.high = Math.max(settings.thresholds.possible, Math.min(100, settings.thresholds.high));
}
