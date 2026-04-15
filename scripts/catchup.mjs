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
 *   --subscription NAME   Subscription ID or topic label to run
 *   --sources a,b,c       Sources: pubmed,biorxiv,europepmc (default: all three)
 *   --dry-run             Print the plan without running anything
 *
 * Tip: point --seen-file at the subscription-specific seen-log path, for example
 * <Vault>/.scholar/seen/default.json, if you want catch-up runs to update the
 * plugin's live seen log directly and avoid any merge step.
 *
 * The script tracks completed batches in .harness-output/catchup-progress.json
 * and skips them on re-run, so it is safe to interrupt and resume.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function pad(value) {
	return String(value).padStart(2, '0');
}

function toLocalDateString(date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIsoDate(dateStr) {
	const [year, month, day] = dateStr.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(dateStr, n) {
	const date = parseIsoDate(dateStr);
	date.setUTCDate(date.getUTCDate() + n);
	return formatUtcDate(date);
}

function yesterday() {
	return addDays(toLocalDateString(new Date()), -1);
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

function printUsage() {
	console.log(`Catch-up script: generates newsletters for a historical date range using the harness.

Usage:
  node scripts/catchup.mjs [options]
  npm run catchup -- [options]

Options:
  --from YYYY-MM-DD     Start date (default: 2025-12-01)
  --to   YYYY-MM-DD     End date   (default: yesterday)
  --batch-days N        Days per newsletter batch (default: 7)
  --delay-seconds N     Wait between batches (default: 60)
  --inbox PATH          Vault inbox folder to copy newsletters into
  --seen-file PATH      Seen-log JSON to use across batches
  --subscription NAME   Subscription ID or topic label to run
  --sources a,b,c       Sources: pubmed,biorxiv,europepmc
  --dry-run             Print the plan without running anything`);
}

function parseArgs(argv) {
	const args = {
		from: '2025-12-01',
		to: yesterday(),
		batchDays: 7,
		delaySeconds: 60,
		inbox: null,
		seenFile: resolve('.harness-output/catchup-seen.json'),
		subscription: null,
		sources: 'pubmed,biorxiv,europepmc',
		dryRun: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const val = argv[i + 1];
		switch (flag) {
			case '--from':           args.from = val;                 i++; break;
			case '--to':             args.to = val;                   i++; break;
			case '--batch-days':     args.batchDays = Number(val);    i++; break;
			case '--delay-seconds':  args.delaySeconds = Number(val); i++; break;
			case '--inbox':          args.inbox = resolve(val);       i++; break;
			case '--seen-file':      args.seenFile = resolve(val);    i++; break;
			case '--subscription':   args.subscription = val;         i++; break;
			case '--sources':        args.sources = val;              i++; break;
			case '--dry-run':        args.dryRun = true;              break;
			case '--help':
			case '-h':
				printUsage();
				process.exit(0);
				break;
			default:
				if (flag.startsWith('--')) {
					console.error(`Unknown flag: ${flag}`);
					process.exit(1);
				}
		}
	}

	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from)) {
		console.error('--from must be YYYY-MM-DD');
		process.exit(1);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
		console.error('--to must be YYYY-MM-DD');
		process.exit(1);
	}
	if (args.from > args.to) {
		console.error('--from must be <= --to');
		process.exit(1);
	}
	if (!Number.isFinite(args.batchDays) || args.batchDays < 1) {
		console.error('--batch-days must be >= 1');
		process.exit(1);
	}
	if (!Number.isFinite(args.delaySeconds) || args.delaySeconds < 0) {
		console.error('--delay-seconds must be >= 0');
		process.exit(1);
	}

	return args;
}

const PROGRESS_FILE = resolve('.harness-output/catchup-progress.json');

function loadProgress() {
	try {
		return new Set(JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')));
	} catch {
		return new Set();
	}
}

function saveProgress(done) {
	mkdirSync('.harness-output', { recursive: true });
	writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 2), 'utf8');
}

function runHarness(from, to, outputDir, seenFile, subscription, sources) {
	return new Promise((resolvePromise, reject) => {
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
		if (subscription) {
			harnessArgs.push('--subscription', subscription);
		}

		const child = spawn(process.execPath, harnessArgs, { stdio: 'inherit' });

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(new Error(`Harness exited with code ${code}`));
		});
	});
}

function sleep(seconds) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, seconds * 1000));
}

const args = parseArgs(process.argv.slice(2));
const batches = buildBatches(args.from, args.to, args.batchDays);

// Rough estimate: ~15 matched papers/day, batched in groups of 50, each pi call ~2 min.
const piCallsPerBatch = Math.max(1, Math.ceil(args.batchDays * 15 / 50));
const estimatedMinutes = Math.round(batches.length * piCallsPerBatch * 2 + (batches.length - 1) * args.delaySeconds / 60);

console.log(`\nCatch-up plan: ${args.from} → ${args.to}`);
console.log(`  ${batches.length} batches × ${args.batchDays} days, ~${args.delaySeconds}s delay between batches`);
console.log(`  estimated runtime: ~${estimatedMinutes} min (rough)`);
console.log(`  sources:  ${args.sources}`);
if (args.subscription) console.log(`  topic:    ${args.subscription}`);
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
	const batchKey = `${args.subscription ?? 'default'}__${from}__${to}`;
	const batchLabel = from === to ? from : `${from} → ${to}`;
	const n = i + 1;

	if (done.has(batchKey)) {
		console.log(`[${n}/${batches.length}] skip  ${batchLabel} (already done)`);
		skipped += 1;
		continue;
	}

	const outputSuffix = args.subscription ? `-${args.subscription.replace(/[^a-z0-9_-]+/gi, '_')}` : '';
	const outputDir = resolve(`.harness-output/catchup-${from}--${to}${outputSuffix}`);
	console.log(`\n[${n}/${batches.length}] run   ${batchLabel}`);

	try {
		mkdirSync(outputDir, { recursive: true });
		await runHarness(from, to, outputDir, args.seenFile, args.subscription, args.sources);

		const newsletterSrc = join(outputDir, 'newsletter.md');
		if (args.inbox && existsSync(newsletterSrc)) {
			mkdirSync(args.inbox, { recursive: true });
			const label = from === to ? from : `${from} to ${to}`;
			const topicSuffix = args.subscription ? ` ${args.subscription.replace(/[\\/:*?"<>|]+/g, ' ').trim()}` : '';
			const dest = join(args.inbox, `Scholar${topicSuffix} ${label}.md`);
			copyFileSync(newsletterSrc, dest);
			console.log(`  → copied to ${dest}`);
		}

		done.add(batchKey);
		saveProgress(done);
		processed += 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`  ✗ batch failed: ${message}`);
		failed += 1;
	}

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
