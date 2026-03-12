# Roll Back Corpus

This runbook moves a dataset pointer back to a previously published immutable dataset. It does not re-upload corpus objects.

## Before You Roll Back

- Identify the target dataset version from channel history or from a known-good publish record.
- Confirm the target manifest exists:
  `bun scripts/validateDataset.ts remote --dataset-version <dataset-version>`

## Rollback Flow

1. Move the channel pointer:
   `bun run rollback-dataset -- --channel preview --dataset-version <dataset-version>`
   `bun run rollback-dataset -- --channel prod --dataset-version <dataset-version>`
2. Validate the channel pointer after rollback:
   `bun scripts/validateDataset.ts remote --channel preview`
   `bun scripts/validateDataset.ts remote --channel prod`
3. If preview was used for testing only, prune older preview datasets when appropriate:
   `bun run prune-datasets`

## Notes

- The rollback command writes an immutable history record under `channels/history/<channel>/`.
- In `M0-M1`, pointer movement prepares the manifest-driven control plane but does not yet change the live browse runtime. That switch happens in `M3`.
