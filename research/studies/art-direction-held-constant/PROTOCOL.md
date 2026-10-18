# Art Direction, Held Constant

ADHC-001 · Revision 3 · Continuous two-GPU production

## Research question

Does explicit art direction change and improve an image compared with a substantive baseline describing the same scene? Text differences alone do not establish a visible difference or an improvement. Jay judges the generated artwork; agents do not view images or screenshots.

The scene pool contains 150 geographic scenes. Preserve their identities and original source prompts in `corpus.json`. Thousands of archived images came from repeated scenes and seeds, not thousands of independently authored prompts. Original catalog authorship is unknown.

## Current prompt revision

`baselines-40.json` records revision `ADHC-001-baseline40-qwen77-v1`:

- **A — assistant baseline:** a substantive assistant-written prompt, targeting roughly 40 CLIP tokens, preserving the scene and painterly style. A scene title or five-word label is insufficient. Small overruns are accepted; do not damage content to satisfy a cosmetic count.
- **B — Qwen revision:** Qwen revises that exact assistant baseline with explicit composition, spatial relationships, lighting, material or anatomy instructions. Ground additional art direction in the preserved source scene. Do not introduce unrelated subjects, lose defining counts/exclusions, or substitute punctuation/synonyms for a meaningful intervention. Target at most 77 CLIP tokens.

Record actual text, authorship, baseline/revision hashes, actual CLIP and T5 token counts, and exact lexical changes. Record Qwen's explanation separately: it can misdescribe its own changes. Independent text review must approve a revision before production can select it. Rejected or unreviewed text is visible as such and is not applied. A text audit does not establish image quality.

FLUX1 uses both CLIP (77 tokens including special tokens) and T5 (up to 512 tokens). T5 can use text beyond CLIP's window. These are different tokenizers and counts; neither limit refers to image dimensions. The native worker keeps T5 conditioning at 512. Do not truncate strings silently or add a hidden suffix after measuring them.

Historical packages remain immutable. Earlier pairs used the preserved full catalog prompt and an assistant rewrite; their sources are retained. New baseline/Qwen packages have explicit `promptRevision` and author metadata and preserve the historical source text. Do not aggregate their results as one unchanged intervention. Until an individual scene has an approved revision, its historical prompt flow may continue; this transition is incremental, not a claim that all 150 Qwen revisions are ready.

## Execution and parity

Two existing FLUX1 workers operate on the persistent volume. GPU0 uses HTTP 18761; GPU1 uses HTTP 18763. Both use the same original native FLUX1 source and model. One authoritative scheduler implementation, `tools/artwork/parity_daemon.py`, runs in two persistent launchd lanes with shared scene/seed reservations. No separate refiller or competing scheduler.

For each pair, freeze A/B, checkpoint, runtime precision, dimensions, seed, steps, guidance and conditioning. Generate A then B serially on the same GPU. Different scenes can run concurrently on different GPUs. Later passes use new paired seeds. Reviews, ratings, app closure and navigation MUST NOT stop continuous generation; honor an explicit user pause.

Controls changes apply to the next complete pair on each GPU. An in-flight pair finishes its saved package even if settings or prompt revisions change meanwhile. No automatic replay of uncertain submissions: reconcile the recorded job ID.

Keep actual output dimensions equal within a pair. Current settings are observed at runtime, not inferred from prose or an old plan. The UI supports square, landscape and portrait; landscape 1024 short edge yields 1536 × 1024. Historical dimension wording remains historical provenance, not an instruction to alter only one arm.

## Feedback, review and storage

Pixtral observes and provides feedback. It does not independently rewrite prompts, alter settings or direct generation. Qwen may revise assistant prompts under this explicit protocol. No automatic feedback-to-prompt crosstalk is enabled. A later feedback-driven study needs its own recorded intervention and revision.

Compare retains paired results and human choices, including ties/neither. Prompts shows assistant baseline and Qwen revision side by side, actual counts, exact changes and independent review state. The compact Production HUD distinguishes observed rendering, between-image work, stale observations and upload state; a loaded model is not proof of generation.

Keep models and originals on the verified persistent volume. Use the existing single R2 uploader/index writer for both job roots. The naming daemon reads metadata and preserves image IDs/hashes. Never expose secrets or create local model/backup copies in Git. Never deploy Vercel merely by changing the local app.

## Sources and verification

- `tools/artwork/prompt_revisions.py`: hash/authorship/token/independent-approval gate.
- `tools/artwork/prompt_clarity.py`: immutable paired packages and provenance.
- `tools/artwork/study_controller.py`: existing per-package execution and reconciliation.
- `tools/artwork/revise_assistant_baselines.py`: resumable Qwen drafting with exact-baseline hashes.
- `docs/PRODUCTION-DAEMON.md`: two-lane operation and safe recovery.
- `docs/LIVE-STATUS-MATRIX.md`: timestamped observations; not permanent guarantees.

OpenAI image generation and the older FLUX2 workflow remain separate candidates. They are not scheduled by this protocol or by opening a tab. The old FPC-001 pilot and archived three-brief proposal are not the active workload.
