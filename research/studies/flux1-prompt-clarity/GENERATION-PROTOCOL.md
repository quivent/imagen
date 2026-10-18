# Generation protocol · Prompt Clarity

## Prepare, then stop

1. Read the specification and revise the B caption if needed. Keep A exact.
2. Compile the package in Research or run `python3 -B tools/artwork/prompt_clarity.py prepare`.
3. Inspect both frozen prompts, settings, paired seeds, hashes and comparison slots. Package preparation performs no inference and enqueues nothing.
4. Wait for Jay's instruction to generate; pressing Start pilot in Controls is that explicit execution request. Do not power up GPUs, run a factory worker, call an image-generation tool or invoke Seers as part of preparation.

## Before the first authorized pair

Verify the resident FLUX.1 worker and available GPU memory without changing its model, precision, driver or power settings. Capture actual transformer/encoder checkpoint identities and runtime versions. Measure both tokenizer paths. Preserve the native 77-token CLIP policy equally for both arms and record its truncation. Block a T5 caption that exceeds the frozen 512-token limit; do not silently truncate it or give the arms different limits.

Record the active model/settings and any shared GPU contention. Run arms serially on the same worker. Both requests have identical numerical settings and seed. Alternate AB and BA submission order between pairs to reduce order-related effects. Left/right review order is independently shuffled and recorded.

## Isolated factory handoff

After execution is authorized, the separate command below enqueues the frozen package without starting a worker:

```sh
python3 -B tools/artwork/prompt_clarity.py enqueue PACKAGE_HASH
```

The output identifies the isolated factory directory and job IDs. Run one command-worker claim at a time using the existing `tools/artwork/artwork.py` entry point, the generated adapter argument file and an explicit `--state` directory:

```sh
python3 -B tools/artwork/artwork.py --state RUN_FACTORY worker --backend command --model flux1-dev --concurrency 1 --argv RUN_ADAPTER_ARGUMENTS --once
```

The capitalized values above are placeholders taken from the prepared package. `--once` is bounded; it is not a daemon. The adapter talks over SSH to the existing private worker. No user prompt is interpolated into a shell command. Never point this worker at the production factory or add another refiller.

Keep the existing model files and runtime on the persistent volume. This protocol neither moves nor deletes them.

## Completion and interruptions

Persist the native request ID and generation receipt before any downstream import. Verify original SHA-256, actual dimensions, prompt, seed, steps, guidance, conditioning limit and actual precision. Reject a pair for like-for-like analysis if the controls differ; keep the artifacts and describe why. Do not resize or overwrite originals.

An uncertain request is reconciled against its existing ID and receipt. It is never blindly regenerated. A failed transport is not proof that inference did not occur. Stop a run when identity, timing or receipt evidence is incomplete.

Use the established R2 uploader as the single writer, preserving study/pair/arm provenance. Native live preview can remain available, but both preview and final capture must be tied to the correct package. The guided controller imports each fully verified pair into this study's Stream/Compare views. The separate R2 observation reports pending versus hash-matched index confirmation.

## Blind review and timing

The operator-only package contains the arm mapping; the review presentation must not expose it until a choice is saved. Save pair, shuffled slot choice, tie/neither, notes and reveal time. Never submit the GLSL image-matching score as an artwork preference score.

Report measured worker generation time for each arm and paired differences. Keep text-encoding, denoising, queue and transfer times separate where the worker exposes them. Include all completed attempts, not just preferred images. No automatic jury or prompt iteration follows a rating. Save choice & continue explicitly authorizes continuation inside the frozen pair budget; Save choice & pause does not.

## Guided runner

The native app now supplies the bounded controller described in **A guided autonomous pilot**. Use its Start, pause, review cadence and receipt-reconciliation controls for normal execution. The manual factory handoff above remains a recovery/operator reference; do not run it concurrently with the guided controller. No live pilot was started while building or testing these controls.
