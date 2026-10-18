# Implementation · FLUX.1 Prompt Clarity

## One application, two study contexts

Use the native Imagen application and its existing local Vite service. FLUX inference stays on Vast. Two adjacent buttons under Workbench select Image → World or FLUX.1 · Prompt Clarity. Production retains its existing workflow.

The selector remembers the study. Experiments and Workbench Controls mount the relevant study component. Research keeps its other sections available for Image → World; Prompt Clarity shows its own specification, implementation, generation protocol and runner source. Workbench Stream and Compare display the selected study's records rather than the old FLUX.1/FLUX.2 comparison archive. Tasks and Agents retain their workspace scope. Changing the study does not start, pause, enqueue or cancel anything.

The existing GLSL experiments, images, controls and saved query are preserved. Switching back restores that study. Research notes and plans remain on disk.

## Preparation script

`tools/artwork/prompt_clarity.py` compiles the historical A prompt and drafted B prompt into a paired request package. It calculates prompt hashes, freezes settings and seeds, and records the historical source and comparison order.

The API calls only its preparation and read operations with fixed arguments. Preparing a package saves JSON under the ignored `.runtime/research/flux1-prompt-clarity/runs/<package hash>/`. It does not open the production queue, start a worker, contact Vast or request an image. Identical inputs reuse the same package. Changed prompts/settings produce another package.

The script has a separate explicit enqueue command for later execution. Its queue is inside that run directory and uses the existing captured factory core. No factory refiller watches it. The original built-in image-generation tool runner remains available as a Research source document, but this A/B uses the FLUX.1 command backend. The OpenAI runner must not claim these jobs.

## Guided execution

The guided controller is implemented in `tools/artwork/study_controller.py`. After explicit Start it performs read-only worker/tokenizer checks, runs the existing private FLUX.1 adapter serially, verifies each receipt and original, and imports completed pairs into the study-specific Stream/Compare views. It pauses at the chosen review cadence and respects the pair budget. Reviews are durable, visually blind until saved, and can explicitly continue or pause the pilot.

An independent journal and per-run lock preserve progress. Reconciliation finishes local bookkeeping only from existing valid receipts; missing or uncertain evidence stops without another generation. Runtime drift and changed controls are not accepted as like-for-like results. The R2 observer reads the established index and does not add another writer. The prepared run remains unstarted until execution is requested.

See **A guided autonomous pilot** in Research for the states, controls, conditioning policy, evidence requirements and failure behavior. Live GPU execution has not been used to verify this implementation; synthetic fixtures and the existing adapter's contracts provide the present validation.

## Verification

Compilation tests establish exact historical A, matched numerical settings and seeds, and immutable package identities. Controller tests exercise bounded progression, review checkpoints, pause/resume, duplicate runners, receipt recovery, unknown submissions, runtime drift and control mismatches without real inference. API tests use temporary state and an injected launcher. Hidden WebKit DOM checks exercise guidance, study switching and blind review without displaying images.
