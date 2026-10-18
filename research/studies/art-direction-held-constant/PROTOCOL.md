# Art Direction, Held Constant

Study plan · Planned · ADHC-001

Related research note: **Where the Image Quality Comes From**.

## Question and hypothesis

How much does deliberate art direction improve our image-generation workflows,
and does that improvement transfer to self-hosted FLUX?

Primary hypothesis: a structured art-directed brief improves judged adherence
and visual quality over the short-brief condition within each FLUX profile.
Secondary question: how do the three workflows compare when supplied the same
frozen brief? Because the built-in tool's underlying model and internal prompt
processing are not exposed, this is a workflow-level comparison, not a clean
ablation of model weights or architecture.

## Pilot design

- Three briefs: a Draa Valley oasis, a restrained architectural courtyard, and
  an opaque Imagen app icon. These sample our actual landscape, architecture
  and design uses without requiring unsupported transparency from FLUX.
- Two prompt conditions: the short brief and one frozen structured brief.
- Three workflows: built-in OpenAI image generation, self-hosted FLUX1-dev,
  and the currently installed FLUX2 profile. Record actual model and encoder
  precision; the historical NF4 profile name alone does not establish precision.
- Two independent repetitions per cell: 36 planned images in total.
- Write each structured prompt before viewing any output. Supply identical
  prompt bytes to all workflows within its condition; do not give one provider
  extra art direction, references or unrecorded edits.

The brief expansion is the intervention, so it adds explicit visual decisions.
Both conditions retain the same central subject and intended use. Evaluation
uses the original core brief for common requirements and records the added
constraints separately, rather than rewarding verbosity by definition.

## Instructions before generation

1. Review and freeze `plan.json`. It contains all six prompt texts and the design.
2. Capture each worker's actual checkpoint, encoder type, precision, steps,
   guidance, conditioning limit and output dimensions. Reconcile worker readiness
   and available memory; do not alter production settings to run the study.
3. Request 1024×1024 for the matched-resolution cohort if all workflows support it.
   Record actual output dimensions. A prompt request is not a size guarantee in
   the built-in tool. Keep mismatches as a separate cohort; never silently resize
   an original or regenerate it merely because processing rejected its size.
4. Freeze justified profile-specific settings before the batch. Equal step counts
   are not equal computation across models; seeds are reproducibility controls
   within a workflow, not matched noise between different generators.
5. Check conditioning length against each profile. If a structured brief is
   truncated, record the effective input and treat that cell as a different
   conditioning condition. Do not assume a longer prompt reached the model.
   Audit complete outgoing payloads too: the captured built-in packet appends an
   output-dimensions sentence. Normalize that noncreative suffix across the
   workflows before execution, or explicitly report the wrapper difference.
   Equal stored brief hashes alone do not establish equal outgoing prompts.
6. Generate the execution order and anonymous review IDs. Keep paired conditions
   distributed across order so warm-up and changing service conditions are visible.
7. Use a new explicit study state under `.runtime/research/art-direction-held-constant`.
   Queue only these reviewed study requests; keep existing production jobs isolated.

## Execution tools

Use `tools/artwork/artwork.py --state STUDY_STATE ...` for durable factory jobs.
For the built-in lane, use the functions.exec orchestration in
`tools/artwork/builtin_runner.js`, after setting functions.exec's
`store('artwork-runner-state', '/absolute/Imagen/.runtime/research/art-direction-held-constant/factory')`
to that same study state. The runner passes it explicitly on every CLI operation;
replace the checkout prefix with the actual path.
Do not run the orchestration in Node: its tools exist in the agent environment.

Use existing authorized FLUX adapters with a dedicated study queue and explicit
model filter when their private workers are ready. Do not start a second consumer
against the production queue, change an existing daemon's state root, or create
another R2 index writer. A command adapter must save the original and its receipt
inside its assigned work directory before completing the factory request.

The runner and queue support claims, heartbeats, idempotent requests, receipts,
originals and review. This plan does not claim that a one-command 36-image study
launcher or automatic Compare import has already been implemented. Integrate
those handoffs against the preserved factory IDs when the pilot is scheduled.

## Record each attempt

Keep study/cell/repetition IDs, short and effective prompts and their hashes,
workflow identity, known model revision or explicitly unknown identity, actual
settings, references, requested and actual dimensions, original SHA256, queue
wait, provider generation duration when known, total wall time, processing time,
measured cost when known, and completion/uncertainty status. Missing cost or
provider-internal timing remains unknown. Never infer either from elapsed time.

No automatic best-of selection, enhancement, post-generation editing or image
discarding in the primary cohort. Preserve failed and uncertain attempts as
outcomes. Retry only after reconciling whether a source and receipt already exist.

## Review in Imagen

Use Compare for blinded, randomized pairs. Jay is the primary visual reviewer;
agents do not view images. The jurors may provide separately recorded feedback
when explicitly included in the study execution, but do not substitute their
opinions for the blinded preference outcome.

Rate core-brief adherence, composition, spatial coherence, material/light
plausibility, distinctive details and overall preference. Permit ties and
record notes. Review at matched display size while keeping access to originals.
Record raw-versus-directed wins within each workflow first, then cross-workflow
comparisons under the frozen supplied brief. With six images per prompt condition
per workflow, results are exploratory; report counts and paired changes rather
than claiming a general winner.

## Separate throughput experiment

After the quality pilot, compare serial versus up-to-six-call scheduling using
a separate declared workload and provider limits. Report throughput, queue wait,
per-image latency and recovery independently. A concurrency improvement is not
an image-quality improvement. Do not mix additional throughput-study images into
the primary pilot without recording their distinct purpose.

## Completion and next decision

Produce the immutable attempt ledger, original/receipt inventory, blinded review
record and a short findings document. State which art-direction improvements
transfer to FLUX and which remain unresolved. Consider a larger follow-up only
after reviewing the pilot's actual variation and failure modes.

Current status: planned. No requests have been enqueued, no images generated,
and no workers or remote services started by documenting this study.
