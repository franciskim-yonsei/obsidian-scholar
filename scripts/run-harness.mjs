import esbuild from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const tempRoot = join(tmpdir(), 'obsidian-scholar-harness');
mkdirSync(tempRoot, { recursive: true });
const outfile = join(tempRoot, `harness-${Date.now()}.cjs`);

await esbuild.build({
	entryPoints: [resolve('src/harness/index.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	outfile,
	alias: {
		obsidian: resolve('src/harness/obsidian-shim.ts'),
	},
	logLevel: 'silent',
});

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
	stdio: 'inherit',
});

child.on('exit', (code, signal) => {
	try {
		rmSync(outfile, { force: true });
	} catch {
		// Ignore cleanup failures.
	}

	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 0);
});
