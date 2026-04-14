/* eslint-disable no-restricted-globals */
interface RequestUrlRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
}

interface RequestUrlResponse {
	status: number;
	text: string;
	json: unknown;
}

export async function requestUrl(request: RequestUrlRequest): Promise<RequestUrlResponse> {
	const response = await fetch(request.url, {
		method: request.method ?? 'GET',
		headers: request.headers,
	});
	const text = await response.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}

	return {
		status: response.status,
		text,
		json,
	};
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}
