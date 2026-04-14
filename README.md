# Scholar

Scholar is an Obsidian desktop plugin that builds a daily research newsletter inside your vault.

It can:
- fetch papers from PubMed, bioRxiv, and Europe PMC
- filter them with a configurable keyword query
- score and summarize them with the `pi` CLI
- write a dated markdown digest into your chosen folder
- keep a seen log so the same papers are not reprocessed every day

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
npm run harness -- --from 2024-01-01 --to 2024-01-07 --sources pubmed,europepmc --query cochlea --analyzer mock
```

What it does:
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

## Catch-up script

For a one-time historical backfill, use the batch catch-up script:

```bash
npm run catchup -- --from 2025-12-01 --to 2026-04-13 --batch-days 7 --delay-seconds 60
```

It runs the harness repeatedly, reuses a shared seen log, records progress in `.harness-output/catchup-progress.json`, and can resume after interruption.

Useful options:
- `--from <YYYY-MM-DD>`
- `--to <YYYY-MM-DD>`
- `--batch-days <N>`
- `--delay-seconds <N>`
- `--sources pubmed,biorxiv,europepmc`
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
- Automatic startup runs happen at most once per local calendar day.
- The first automatic run fetches yesterday's papers. Manual runs fetch today and can overwrite today's note.
