import { requestUrl } from 'obsidian';

export async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers,
	});

	if (response.status >= 400) {
		throw new Error(`Request failed (${response.status}): ${url}`);
	}

	return response.json as T;
}

export async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
	const response = await requestUrl({
		url,
		method: 'GET',
		headers,
	});

	if (response.status >= 400) {
		throw new Error(`Request failed (${response.status}): ${url}`);
	}

	return response.text;
}

export async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => {
		globalThis.setTimeout(resolve, milliseconds);
	});
}
