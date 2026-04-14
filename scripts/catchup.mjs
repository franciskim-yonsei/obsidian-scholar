/**
 * Catch-up script: generates newsletters for a historical date range using the
 * harness, one newsletter per batch window (default: weekly).
 *
 * Usage:
 *   node scripts/catchup.mjs [options]
 *   npm run catchup -- [options]
 *
 * Options:
 *   --from YYYY-MM-DD     Start date (default: 2025-12-01)
 *   --to   YYYY-MM-DD     End date   (default: yesterday)
 *   --batch-days N        Days per newsletter batch (default: 7)
 *   --delay-seconds N     Wait between batches to respect API rate limits (default: 60)
 *   --inbox PATH          Vault inbox folder to copy newsletters into
 *   --seen-file PATH      Seen-log JSON to use across batches (default: .harness-output/catchup-seen.json)
 *   --sources a,b,c       Sources: pubmed,biorxiv,europepmc (default: all three)
 *   --dry-run             Print the plan without running anything
 *
 * The script tracks completed batches in .harness-output/catchup-progress.json
 * and skips them on re-run, so it is safe to interrupt and resume.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function addDays(dateStr, n) {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

function yesterday() {
	return addDays(new Date().toISOString().slice(0, 10), -1);
}

/** Returns an array of [fromDate, toDate] pairs, each covering batchDays days. */
function buildBatches(from, to, batchDays) {
	const batches = [];
	let cursor = from;
	while (cursor <= to) {
		const batchEnd = addDays(cursor, batchDays - 1);
		batches.push([cursor, batchEnd > to ? to : batchEnd]);
		cursor = addDays(cursor, batchDays);
	}
	return batches;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = {
		from: '2025-12-01',
		to: yesterday(),
		batchDays: 7,
		delaySeconds: 60,
		inbox: null,
		seenFile: resolve('.harness-output/catchup-seen.json'),
		sources: 'pubmed,biorxiv,europepmc',
		dryRun: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const val = argv[i + 1];
		switch (flag) {
			case '--from':           args.from = val;                   i++; break;
			case '--to':             args.to = val;                     i++; break;
			case '--batch-days':     args.batchDays = Number(val);      i++; break;
			case '--delay-seconds':  args.delaySeconds = Number(val);   i++; break;
			case '--inbox':          args.inbox = resolve(val);         i++; break;
			case '--seen-file':      args.seenFile = resolve(val);      i++; break;
			case '--sources':        args.sources = val;                i++; break;
			case '--dry-run':        args.dryRun = true;                break;
			case '--help': case '-h':
				console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n'));
				process.exit(0);
				break;
			default:
				if (flag.startsWith('--')) { console.error(`Unknown flag: ${flag}`); process.exit(1); }
		}
	}

	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from)) { console.error('--from must be YYYY-MM-DD'); process.exit(1); }
	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.to))   { console.error('--to must be YYYY-MM-DD');   process.exit(1); }
	if (args.from > args.to) { console.error('--from must be <= --to'); process.exit(1); }
	if (!Number.isFinite(args.batchDays) || args.batchDays < 1) { console.error('--batch-days must be >= 1'); process.exit(1); }
	if (!Number.isFinite(args.delaySeconds) || args.delaySeconds < 0) { console.error('--delay-seconds must be >= 0'); process.exit(1); }

	return args;
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

const PROGRESS_FILE = resolve('.harness-output/catchup-progress.json');

function loadProgress() {
	try { return new Set(JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))); }
	catch { return new Set(); }
}

function saveProgress(done) {
	mkdirSync('.harness-output', { recursive: true });
	writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Harness invocation
// ---------------------------------------------------------------------------

function runHarness(from, to, outputDir, seenFile, sources) {
	return new Promise((resolve, reject) => {
		const harnessArgs = [
			'scripts/run-harness.mjs',
			'--from', from,
			'--to', to,
			'--sources', sources,
			'--analyzer', 'pi',
			'--output', outputDir,
			'--seen-file', seenFile,
			'--update-seen',
		];

		const child = spawn(process.execPath, harnessArgs, { stdio: 'inherit' });

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Harness exited with code ${code}`));
		});
	});
}

function sleep(seconds) {
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const batches = buildBatches(args.from, args.to, args.batchDays);

// Rough estimate: ~15 matched papers/day, batched in groups of 50, each pi call ~2 min.
const piCallsPerBatch = Math.max(1, Math.ceil(args.batchDays * 15 / 50));
const estimatedMinutes = Math.round(batches.length * piCallsPerBatch * 2 + (batches.length - 1) * args.delaySeconds / 60);

console.log(`\nCatch-up plan: ${args.from} → ${args.to}`);
console.log(`  ${batches.length} batches × ${args.batchDays} days, ~${args.delaySeconds}s delay between batches`);
console.log(`  estimated runtime: ~${estimatedMinutes} min (rough)`);
console.log(`  sources:  ${args.sources}`);
console.log(`  seen-log: ${args.seenFile}`);
if (args.inbox) console.log(`  inbox:    ${args.inbox}`);
else            console.log(`  inbox:    (not set — newsletters stay in .harness-output/)`);
console.log('');

if (args.dryRun) {
	batches.forEach(([from, to], i) => console.log(`  [${i + 1}/${batches.length}] ${from} → ${to}`));
	console.log('\n(dry run — nothing executed)');
	process.exit(0);
}

const done = loadProgress();
let skipped = 0;
let processed = 0;
let failed = 0;

for (const [i, [from, to]] of batches.entries()) {
	const batchKey = `${from}__${to}`;
	const batchLabel = from === to ? from : `${from} → ${to}`;
	const n = i + 1;

	if (done.has(batchKey)) {
		console.log(`[${n}/${batches.length}] skip  ${batchLabel} (already done)`);
		skipped++;
		continue;
	}

	const outputDir = resolve(`.harness-output/catchup-${from}--${to}`);
	console.log(`\n[${n}/${batches.length}] run   ${batchLabel}`);

	try {
		mkdirSync(outputDir, { recursive: true });
		await runHarness(from, to, outputDir, args.seenFile, args.sources);

		// Copy newsletter into vault inbox if requested.
		const newsletterSrc = join(outputDir, 'newsletter.md');
		if (args.inbox && existsSync(newsletterSrc)) {
			mkdirSync(args.inbox, { recursive: true });
			const label = from === to ? from : `${from} to ${to}`;
			const dest = join(args.inbox, `Scholar ${label}.md`);
			copyFileSync(newsletterSrc, dest);
			console.log(`  → copied to ${dest}`);
		}

		done.add(batchKey);
		saveProgress(done);
		processed++;
	} catch (err) {
		console.error(`  ✗ batch failed: ${err.message}`);
		failed++;
		// Continue to next batch rather than aborting the whole run.
	}

	// Pause between batches (not after the last one).
	// This delay applies whether the batch succeeded or failed — both consumed API quota.
	if (args.delaySeconds > 0 && i < batches.length - 1) {
		process.stdout.write(`  waiting ${args.delaySeconds}s before next batch...`);
		await sleep(args.delaySeconds);
		process.stdout.write(' done\n');
	}
}

console.log(`\nDone. ${processed} processed, ${skipped} skipped, ${failed} failed.`);
if (failed > 0) {
	console.log('Re-run the script to retry failed batches (completed batches are skipped automatically).');
	process.exit(1);
}
