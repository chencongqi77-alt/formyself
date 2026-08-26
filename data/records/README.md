# Fact records

`data/records/` is the durable internal fact layer for future poet-map
automation. It contains reviewable entity and assertion packages, not raw
uploads, model conversations, or browser-ready JSON.

The canonical unit is an evidence-backed assertion: a person has a relation to
a place, work, time, or role. A map event is a derived projection of one or
more assertions. Each record package must conform to
`../contracts/poet-fact-package.schema.json` and preserve its source/dataset
snapshot and producing job identifier.

Packages should be versioned by poet and revision, for example:

```text
data/records/poets/li-bai/revisions/pfp-20260803-01/package.json
```

Only reviewed or policy-approved packages may be used to produce a release.
