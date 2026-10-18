# Art Direction, Held Constant

ADHC-001 · Revision 2 · Production parity · First pair ready for review

## Question

Does precision in prompt drafting improve the artwork when the scene and image-generation setup are held constant? Begin with our existing production formula, even though that formula is not Jay's preferred long-term approach.

This revision replaces the earlier three-brief, 36-image proposal. That proposal's sample texts remain in `plan.json` as `archivedPilotBriefs`; they are not the current workload. The separate FPC-001 single-scene, three-seed draft is also not this study.

## Where the thousands came from

The preserved production refiller reads 150 prompts from `deployment/controller/docs/artwork/geographic-scenes.json`. It cycles through them for FLUX1 and FLUX2, then repeats with a new seed on each pass. Thousands of generated images therefore do not establish thousands of independently drafted prompts. The catalog does not identify the original drafting model or author; that provenance remains unknown.

`corpus.json` freezes all 150 source scenes, their exact production prompts, the catalog file hash and individual prompt hashes. The first precision rewrite is saved as an assistant-authored draft; the remaining 149 are explicitly undrafted. Never substitute the three example briefs for this source pool.

## Conditions

- **Production:** the exact saved production prompt, including the original style formula, exclusions and dimension prose.
- **Precision:** an assistant-drafted rewrite of that same scene. Clarify composition, spatial relationships, materials, light and instructions already present. Preserve the scene's content, intended style, exclusions and framing. Do not add subjects or silently improve the artistic concept.

Freeze the precision draft beside its source before generating either condition. Prompt drafting is the intervention. Save its author and final text; do not silently change it in response to output.

Both prompts must receive the same noncreative runner suffix, if any. Preserve existing dimension wording consistently in both conditions and use identical actual output dimensions. Correcting an aspect-ratio conflict in only the precision condition would confound that comparison.

## One GPU, alternating conditions

Start with FLUX.1 dev on one available GPU:

1. Select one production scene and freeze its precision counterpart.
2. Freeze the shared model/runtime settings and paired seed.
3. Generate its production condition, then its precision condition, serially.
4. Present that pair in Imagen for Jay to compare. Pause after this first pair.
5. When continuing, move to the next scene and repeat the pair sequence. Do not generate all production conditions first or batch all precision conditions together.

The 150 scenes are the source pool, not an instruction to enqueue everything now. One pass through FLUX1 would produce 300 images. The built-in OpenAI and FLUX2 workflows remain comparison candidates; running all three would produce 900 images at one repetition. Neither additional workflow nor the full pool is automatically scheduled.

## Parity

Within every FLUX pair, hold checkpoint, transformer and encoder precision, output dimensions, seed, steps, guidance and conditioning limits constant. Freeze the settings actually selected for the available GPU before execution; do not silently reuse the unrelated FPC-001 pilot's 512-square settings.

Check effective conditioning and complete outgoing prompts. If either caption is truncated, expose that difference rather than assuming both reached the model intact. Seeds match within FLUX pairs; they do not imply matched noise across unrelated generators.

Cross-workflow comparisons must use the same frozen prompt conditions and actual dimensions where supported. OpenAI's hidden prompt processing makes that a workflow comparison. Do not claim a clean comparison of model weights alone.

## Review and operation

Jay compares blinded left/right results; labels can be revealed after the choice. Permit ties and neither, and keep comments brief. Agents do not view images. No automatic juror calls or creative rewrite loop is implied.

Keep minimal job bookkeeping in the background to prevent duplicate submissions after interruption. Do not make routine hashes, receipts or execution records a user-facing ceremony. Stop on an uncertain submission rather than generating it again.

Reuse the existing single R2 uploader. Never create a second index writer, alter production queues, start paid hardware or schedule the full corpus merely by opening this study.

## Implementation and current readiness

The source pool and revised design are recorded in `corpus.json` and `plan.json`. All 150 production prompt hashes have been checked against the preserved catalog. The first precision draft is saved and its two-image pair has been generated and imported automatically into Stream and Compare. It is waiting for Jay’s review. Remaining scenes are not scheduled. The first pair explicitly uses the live native profile’s 512 × 512 output, 28 steps, guidance 3.5, conditioning limit 512 and seed 42 for both conditions. Volume V.56453901 was verified mounted at /workspace before generation.

`tools/artwork/prompt_clarity.py` now supports schema-2 corpus packages through `prepare-corpus`, with explicit settings supplied as JSON on stdin. The shared `tools/artwork/study_controller.py` runs these packages with a one-pair budget, reusing the existing isolated factory and native command adapter. Older FPC-001 packages remain separate and unchanged. The built-in runner remains available at `tools/artwork/builtin_runner.js` for a separately scheduled reference lane.
