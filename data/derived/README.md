# Derived releases

`data/derived/` holds versioned projections of fact records: a user-facing
map snapshot, a static-site release package, or another target-specific view.
It is not a place to edit historical facts.

Each release must have a manifest that records its source fact-package IDs,
reference-data snapshots, generated files and SHA-256 digests. A release can
be rolled back by selecting a previous complete manifest; it is never repaired
by hand-editing `web/public/data/`.

The current `data/published/` and `web/public/data/` flow is a legacy public
contract. Keep it stable until a release adapter can generate all required
assets together, including work-place links and corpus metadata.
