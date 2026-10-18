# Production parity implementation

The current preparation source is `plan.json` revision 2 plus `corpus.json`. This supersedes the three-brief workload while retaining its archived drafts.

## Recorded

- Exact 150-scene production corpus, source-file SHA-256 and per-prompt SHA-256.
- Explicit production/precision condition definitions and unknown original-author provenance.
- First precision draft saved with assistant authorship; remaining 149 explicitly undrafted.
- One active workflow, FLUX1; one GPU; serial condition pairs.
- One pair as the starting checkpoint. The full pool and other workflows are not automatically authorized workloads.

## Connected execution

`prompt_clarity.py` supports immutable schema-2 corpus packages via `compile_corpus_package` and `prepare_corpus`. The shared controller, isolated factory and native adapter generated the first production/precision pair and imported it into study Stream and Compare. The local API selects the latest ADHC package automatically. Older FPC-001 packages remain unchanged.

The first pair uses explicit live-profile settings: 512 × 512, 28 steps, guidance 3.5, conditioning limit 512 and seed 42. Its one-pair budget stops for review. The persistent volume was verified before execution.

Remaining work is to draft and schedule further scenes as directed, rather than silently expanding the first-pair authorization.

The pair scheduler must complete production and precision for the same scene and seed before moving to another scene. App navigation must not start inference. Keep background bookkeeping minimal and invisible during normal use, and reuse the single R2 uploader.

## Verification

The source validator checks all 150 exact prompt strings and hashes, stable scene order and IDs, accurate precision draft status and authorship, and serial execution policy. It makes no network calls and queues no jobs:

```sh
python3 -B tools/artwork/production_parity.py
```
