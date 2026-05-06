# Scholar

Scholar is an Obsidian desktop plugin that builds a manual research newsletter inside your vault.

It ships with an inner-ear-development profile by default, but you can keep multiple topic subscriptions, each with its own focus label, analyzer guidance, keyword query, PubMed supplement, and seen log, while still generating a single merged newsletter update per manual run.

It can:
- fetch papers from PubMed, bioRxiv, and Europe PMC
- filter them with configurable per-topic boolean keyword queries, including exclusions and tags like `[title]`
- score and summarize them with the `pi` CLI
- write a dated markdown digest into your chosen folder
- re-query a configurable recent window to catch late-indexed PubMed and Europe PMC records
- keep synced plugin-state seen logs in the plugin `data.json` so newly discovered papers are not reprocessed every day

## Requirements

- Obsidian desktop
- `pi` available on your PATH, or a full executable path configured in the plugin settings
- network access to the selected paper sources

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Harness

For pipeline testing without adding any developer commands to the Obsidian UI, use the standalone harness:

```bash
npm run harness -- --from 2024-01-01 --to 2024-01-07 --subscription default --sources pubmed,europepmc --query cochlea --analyzer mock
```

What it does:
- runs one selected subscription at a time
- runs the live fetchers
- deduplicates across sources
- applies the same keyword filter
- optionally runs either a mock analyzer, the real `pi` analyzer, or no analyzer
- writes stage artifacts to an output directory

Artifacts include:
- `raw-papers.json`
- `deduped-papers.json`
- `unseen-papers.json`
- `matched-papers.json`
- `scored-papers.json`
- `newsletter.md`
- `report.json`

Useful options:
- `--analyzer mock|pi|none`
- `--output <dir>`
- `--seen-file <file>`
- `--update-seen`
- `--settings <json-file>`
- `--subscription <id-or-label>`

If you have multiple subscriptions enabled, pass `--subscription` explicitly to choose which one to test.

## Catch-up script

For a one-time historical backfill, use the batch catch-up script:

```bash
npm run catchup -- --from 2025-12-01 --to 2026-04-13 --batch-days 7 --delay-seconds 60
```

It runs the harness repeatedly for one selected subscription at a time, reuses a shared seen log, records progress in `.harness-output/catchup-progress.json`, and can resume after interruption.

Catch-up and harness `--seen-file` support is only for standalone testing/backfill artifacts. The live plugin stores its canonical seen ledger exclusively in `<Vault>/.obsidian/plugins/obsidian-scholar/data.json`.

Useful options:
- `--from <YYYY-MM-DD>`
- `--to <YYYY-MM-DD>`
- `--batch-days <N>`
- `--delay-seconds <N>`
- `--subscription <id-or-label>`
- `--sources pubmed,biorxiv,europepmc`
- `--seen-file <path>`
- `--inbox <path>`
- `--dry-run`

## Manual install

Copy these files into:

```text
<Vault>/.obsidian/plugins/obsidian-scholar/
```

Files:
- `main.js`
- `manifest.json`
- `styles.css` (optional)

Then reload Obsidian and enable **Scholar** in **Settings → Community plugins**.

## Notes

- The plugin is desktop-only because it shells out to the `pi` CLI.
- There are no automatic startup runs; use **Scholar: Fetch papers and generate newsletter** manually.
- Each manual run re-queries the configured recent window and appends a newsletter update only when it finds new papers or failures.
- Enabled topic subscriptions are merged into a single daily note. The live plugin's canonical seen state is stored under the `seenLogs` key in `.obsidian/plugins/obsidian-scholar/data.json`, alongside settings, so Obsidian's plugin-settings sync path carries it.
