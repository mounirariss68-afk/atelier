---
name: Riser reviewed manifest authority
description: Durable rule for capability-catalog review, runtime parity, and action/workflow version pins.
---

The checked-in capability manifest is the release and runtime authority. The live boot registry must match it exactly before the API serves requests; never treat a hash of an unreviewed live registry as the current version.

**Why:** A live-derived version silently blesses role, schema, effect, or presentation drift. Source-text executor hashes also change after bundling, so implementation fingerprints must be based on transpilation-stable authority contracts.

**How to apply:** Any capability policy/schema/effect/presentation change must regenerate and review the manifest. New durable actions and workflow steps resolve exact reviewed entries and pin the reviewed hash. Historical incompatible pins become invalidated/failed before confirmation or claim; never silently upgrade them. Agent-delegated workflow steps remain explicitly unsupported until a reviewed adapter exists.