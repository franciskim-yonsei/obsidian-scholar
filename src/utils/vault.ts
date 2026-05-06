import type { Vault } from 'obsidian';

function normalizeVaultPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function isAlreadyExistsError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /already exists|EEXIST/i.test(message);
}

export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
	const normalized = normalizeVaultPath(folderPath).replace(/^\/+|\/+$/g, '');
	if (!normalized || normalized === '.') {
		return;
	}

	const segments = normalized.split('/').filter(Boolean);
	let currentPath = '';

	for (const segment of segments) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		if (await vault.adapter.exists(currentPath)) {
			continue;
		}

		try {
			await vault.adapter.mkdir(currentPath);
		} catch (error) {
			if (isAlreadyExistsError(error) || await vault.adapter.exists(currentPath)) {
				continue;
			}
			throw error;
		}
	}
}
