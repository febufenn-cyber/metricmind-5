# Phase 3: Evidence-bounded investigation engine

## Objective

Phase 3 investigates an observed change in an active, verified metric. It does not claim that an associated segment, release, campaign, or data-quality warning caused the change.

The investigation contract is:

```text
why-question
  → normalized complete-period comparison
  → pinned semantic metric version
  → data-freshness and semantic-health gate
  → verified baseline query
  → approved dimension decompositions
  → deterministic movement ranking
  → observations, bounded hypotheses, contradictions, confidence, and next checks
```

## Trust boundaries

- Only active semantic metric versions may be investigated.
- Invalid metric dependencies block execution.
- Warehouse access remains aggregate-only and read-only.
- All metric predicates, exclusions, periods, and values remain parameterized.
- At most six verified dimensions may be queried; the default is four.
- Distinct-entity segment totals are explicitly treated as potentially non-additive.
- Evidence strength is not causal confidence.
- Every hypothesis reports `causalStatus: not_established`.

## Initial supported investigation

- complete-period metric comparison;
- count and distinct-count metric baselines;
- ratio baseline comparison without segment decomposition;
- current-versus-previous decomposition by approved dimensions;
- concentration and broad-movement hypotheses;
- freshness and semantic-health warnings;
- exact SQL, parameters, execution metadata, and semantic lineage for every evidence block.

## Deliberate exclusions

Phase 3 does not yet perform causal inference, forecasting, raw-user inspection, unrestricted joins, event-sequence funnels, automatic release correlation, experiment analysis, or autonomous actions.

## Exit criteria

- A `why` question produces a reproducible baseline and bounded investigation plan.
- Invalid semantic health blocks the investigation.
- Stale ingestion lowers confidence and is presented as a possible distortion, not a proven cause.
- Segment evidence identifies movement without assuming additivity for distinct entities.
- No generated output states or implies that association proves causation.
