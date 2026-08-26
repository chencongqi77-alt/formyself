# Poetry knowledge-map agent rules

This repository is a provenance-first knowledge-map project.  Treat a map as
a derived view of evidence-backed facts, not as the source of truth.

## Data boundaries

| Layer | Path | Purpose | Write rule |
| --- | --- | --- | --- |
| Original evidence | `source-materials/`, `cbdb/`, `chinese-poetry/` | Governed source material and reference snapshots | Never edit an admitted source in place. |
| User jobs | `var/quarantine/`, `var/jobs/` | Private uploads and per-job intermediate artifacts | One job owns one directory; never use shared staging paths. |
| Fact records | `data/records/` | Reviewed, provenance-rich assertions and entity packages | Only validated review/curation workflows may write here. |
| Derived releases | `data/derived/` | Versioned map/site projections and release manifests | Generated only from fact records and approved reference snapshots. |
| Legacy public contract | `data/published/` | Current five-file website contract | Change only through an explicit, validated exporter. |
| Frontend copy | `web/public/data/` | Deployable static assets | Never edit directly; use an atomic release adapter. |

`data/staging/` is retired.  Do not add new global candidate batches there and
do not use it for user uploads, per-user model prompts, or job-local caches.
All new intermediate artifacts belong to their owning `var/jobs/<job-id>/`
directory.  See `docs/UPLOAD_WORKFLOW_ARCHITECTURE.md` for the current layout.

## Non-negotiable rules

1. A model, web search result, OCR result, or title match is evidence or a
   candidate—never a published historical fact by itself.
2. Every durable claim must retain precise evidence references, source/dataset
   snapshot identifiers, its producing job, and a review state.
3. Keep raw uploads, private text, API keys, prompts containing private text,
   and model responses out of `data/records/`, `data/derived/`, tests, logs,
   and public web assets.
4. Do not infer a Gregorian date, a place coordinate, an authorship relation,
   or a composition location when the evidence does not support it. Preserve
   uncertainty and historical wording instead.
5. A user job may create a private draft map after its own validation.  It may
   not alter global data or `web/public/data/` without an explicit curation
   decision and release manifest.
6. Never run a write-mode publication command merely to inspect data. Run its
   validation and `--dry-run` mode first.

## Required workflow for new poet data

1. Put an upload in job quarantine, capture its SHA-256, MIME/type checks,
   user processing consent, and retention policy.
2. Create a job manifest with `scripts/poet_map_job.py init`. It snapshots the
   input identifier and the CBDB, corpus, and source-catalog references.
3. Produce immutable stage artifacts under that job: extract, resolve,
   claims, corpus, enrichment, events, review, map, and (after approval)
   release.
4. Validate the job and its fact package before a private map is rendered.
5. Promote only evidence-backed assertions accepted by an explicit review or
   release-policy decision to `data/records/`; create a versioned derived
   release from them.
6. Update the legacy public contract only through a future release adapter,
   then run its validator, static-data tests, and a web build.

## Current automatic baseline

`scripts/run_basic_poet_map.py` is the supported local-only vertical slice for
one upload: it quarantines `.txt`/text-layer `.pdf`, creates a job, extracts
private text, and builds an automatic **private** route draft.  The job's
`review` stage is an `auto-policy-report.json`, not an obligatory human queue.
Scanned/encrypted/unreadable PDFs return a blocked status rather than a guessed
map.  See `docs/BASELINE_UPLOAD_PIPELINE.md` for supported inputs and commands.

## Existing validation gates

```powershell
python scripts/validate_source_materials.py --require-materialized-approved
python scripts/validate_published_data.py --json
python scripts/sync_published_data.py --dry-run
python scripts/poet_map_job.py validate --job var/jobs/<job-id>/job.json
python scripts/validate_poet_fact_package.py --package <fact-package.json>
```

See `docs/UPLOAD_WORKFLOW_ARCHITECTURE.md`,
`docs/BASELINE_UPLOAD_PIPELINE.md`, and the JSON schemas in `data/contracts/`
for the current contract.
