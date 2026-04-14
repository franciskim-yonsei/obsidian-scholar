import { normalizePath, Vault } from 'obsidian';

export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
	const normalized = normalizePath(folderPath).replace(/^\/+|\/+$/g, '');
	if (!normalized || normalized === '.') {
		return;
	}

	const segments = normalized.split('/');
	let currentPath = '';

	for (const segment of segments) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		if (!vault.getAbstractFileByPath(currentPath)) {
			await vault.createFolder(currentPath);
		}
	}
}
