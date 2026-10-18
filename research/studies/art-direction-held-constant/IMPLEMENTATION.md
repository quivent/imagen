# Production study implementation

The active system is continuous dual-GPU FLUX1 production, with immutable per-scene A/B packages and optional human review. It is not a one-pair pilot that pauses for review.

## Prompt sources and authorship

`corpus.json` preserves all 150 historical catalog prompts and assistant rewrites. `baselines-40.json` contains 150 substantive assistant-written compact baselines, their source hashes and actual installed-tokenizer counts. Qwen drafts revisions of those exact baselines; it does not author the baseline. The resumable runner stores responses and exact text diffs, with independent approval separate from Qwen self-reported claims.

`prompt_revisions.ready_revision` checks source identity, baseline hash, revision's baseline hash, revision hash, named authors, measured CLIP/T5 counts, token-verified status and independent approval. Only matching approved rows override a future package. Original source text is preserved in package provenance. Unready rows retain the historical flow so production continues. Do not equate a completed baseline corpus with 150 completed Qwen revisions.

`compile_corpus_package` freezes the selected texts and explicit settings into its package identity. Loading a package reconstructs it from its frozen contents, without consulting today's mutable revision file. Requests, arm order, seed, settings and hashes are integrity checked. The scheduler loads an existing in-flight package rather than re-compiling it when revisions arrive.

## Runtime and display

- `parity_daemon.py` is the one scheduler implementation; launchd runs independent GPU0/GPU1 lane roots and shared reservations. Both native worker endpoints use FLUX1.
- `study_controller.py` handles each immutable pair. Reviews remain optional and never gate the scheduler.
- `server/prompt-study.mjs` exposes bounded study pages, shared settings, actual frozen current scenes, the prompt comparison data and compact HUD observations.
- `src/production-study-controls.js` shares the actual choice template with legacy Controls. Frame, resolution, steps and guidance persist for the next pair; reset affects only unsaved edits. Context is fixed 512 by the native worker.
- `src/prompt-comparison.js` shows both texts, real counts, independent lexical differences and review status.
- `src/production-hud.js` uses fresh worker observations, actual recent render durations and archive observations. No simulated progress percentage.
- `server/model-chat.mjs` and `src/model-chat.js` provide real local Qwen/Pixtral text/code chat, separate saved histories and cancellation. They do not execute generated code or automatically change prompts.

Actual settings, readiness and counts belong to the live endpoints and task ledger. Use the status matrix for the last explicit verification, not as a permanent status claim.

## Validation

Historical source identity is checked offline by `python3 -B tools/artwork/production_parity.py`. Targeted tests cover immutable prompt revisions, independent approval/hash gates, paired settings, in-flight preservation, the two-lane feed, HUD freshness and chat authorization/stream cancellation. Native hidden-WebKit checks cover navigation, side-by-side prompts, no-overflow tabs, the HUD and actual chat Send→model→reply. Agents must never view artwork or screenshots.
