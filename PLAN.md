# obsidian-scholar — reviewed implementation plan

## What changed after review

The original plan was solid, but I tightened a few details before building:

1. **Deep-merge saved settings**
   - Nested settings objects (`focus`, `sources`, `thresholds`, `llm`) now merge safely with defaults.
   - This avoids partially saved configs wiping sibling defaults.

2. **Fix the date-range edge case**
   - The original first-run example and `getDaysBetween()` behavior did not line up.
   - Implemented behavior:
     - first automatic run: process **yesterday**
     - later automatic runs: process missed calendar days up to today
     - manual run: always process **today**, and also catch up if needed

3. **Improve dedup and seen-log keys**
   - DOI and PMID are used first.
   - A normalized title fallback is also used so papers without IDs still deduplicate and stay out of future runs.
   - The seen log now stores **new deduped papers before LLM filtering**, not only scored papers.

4. **Use Obsidian HTTP utilities**
   - Implemented source fetching with `requestUrl()` rather than raw browser `fetch()`.
   - This is more reliable in the plugin environment.

5. **Make the research focus configurable without losing the default profile**
   - The plugin now keeps the current inner-ear defaults as a reusable profile.
   - Focus label, analyzer guidance, and PubMed query supplementation can all be changed in settings.

6. **Invoke `pi` through stdin on Windows-safe process paths**
   - The analyzer now pipes prompts through stdin and closes stdin explicitly.
   - On Windows it quotes configured executable paths safely before handing them to `cmd.exe`.

7. **Write explicit empty newsletters**
   - If no new papers are found, or if papers are found but none match the keyword filter, the plugin still writes a dated note explaining that outcome.

8. **Fail loudly when fetches are broken**
   - If every enabled source fails, the run now errors out instead of silently writing a misleading empty newsletter.


## Built structure

```text
src/
  main.ts
  settings.ts
  types.ts
  pipeline/
    analyzer.ts
    deduplicator.ts
    fetcher.ts
    index.ts
    keywordFilter.ts
    newsletter.ts
    sources/
      biorxiv.ts
      europepmc.ts
      pubmed.ts
  utils/
    dates.ts
    network.ts
    seenLog.ts
    strings.ts
    vault.ts
```

## Implemented behavior

- Desktop-only Obsidian plugin
- Startup-triggered automatic run with a same-day guard
- Manual command and ribbon action
- Source fetching from:
  - PubMed
  - bioRxiv
  - Europe PMC
- Cross-source deduplication
- Multiple topic subscriptions with per-topic query, analyzer guidance, PubMed supplement, and seen log, merged into one daily newsletter
- Seen-log persistence in `.scholar/seen/<subscription-id>.json` with legacy fallback from `.scholar/seen.json`
- Local boolean keyword filtering (`AND`, `OR`, quoted phrases, simple grouping)
- `pi`-based scoring and summarization in batches
- Single daily newsletter note generation in the configured inbox folder with per-topic sections

## Key settings

- Inbox folder
- Startup auto-run toggle
- Multiple topic subscriptions, each with its own focus label, analyzer guidance, PubMed query supplement, and keyword query
- Source toggles
- Thresholds for high / possible / weak matches
- `pi` executable path
- `pi` model
- `pi` thinking level
- Optional PubMed API key
- Catch-up limit in days

## Release artifacts

Build output remains the standard Obsidian plugin trio:
- `main.js`
- `manifest.json`
- `styles.css`
