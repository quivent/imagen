# FLUX.1 · Prompt Clarity

Status: preparation only. No images have been requested for this study.

## Question

Does precise art direction improve FLUX.1 dev artwork when the model and generation settings remain the same?

A uses the exact historical prompt. B expresses the same scene and artistic intent through the clarity protocol. This is a paired comparison of prompt preparation, not a comparison of generators.

## Small first pilot

Start with the Draa Valley scene from Experiment 2. Use three paired seeds for six new images in total. The first pair can be reviewed before deciding to execute the other two. Existing images remain historical references; neither arm silently reuses a previous generation.

| Variable | Both arms |
| --- | --- |
| Model | FLUX.1 dev |
| Precision | Historical BF16; verify actual transformer and encoder precision before execution |
| Output | 512 × 512, matching the recorded FLUX.1 baseline |
| Steps | 28 |
| Guidance | 3.5 |
| Conditioning limit | 512 tokens; record CLIP lengths; verify T5 is untruncated |
| Seeds | 47, 1047, 2047, paired across A and B |
| Runner | Existing private resident FLUX.1 worker through the factory command adapter |

These are historical replication settings, not newly tuned quality settings. Do not inherit current Production slider values. A different resolution or sampling setup requires a new run package applied equally to both arms.

## Arm A · Original

Take the prompt byte-for-byte from `public/worlds/experiments.json`, Experiment 2, source job `bd704f7d9a3e4cd29d14d39695fab4cf`. Record its SHA-256 in the package. Do not shorten it, improve it, or silently append a style template.

The original prompt asks for 1536 × 1024 in its prose, although the recorded image and worker settings are 512 × 512. Preserve that discrepancy in A. B makes the square framing explicit. Resolving this conflict is part of this clarity intervention; this pilot cannot isolate the contribution of each wording change.

## Arm B · Precise art direction

Use one frozen scene caption describing purpose and medium, composition and near/middle/far placement, subject proportions and relationships, materials, illumination, palette, visual hierarchy and exclusions. Clarify what was already requested. Do not add a more dramatic scene, a new subject, a different location or a different artistic style. The first B caption is a draft for Jay to revise before generation.

Prompt expansion happens before the paired generation. There is no automatic prompt rewriting between runs and no hidden model-specific suffix. If a model assists in drafting later, save the input, output and exact final caption; the image worker receives that frozen final caption.

## Review

Compare paired seeds in Imagen. Hide condition labels and prompts during the first choice; permit A, B, tie or neither. Record resemblance to the intended scene, composition, spatial coherence, materials/light, artistic appeal and unwanted additions separately. Reveal the arms only after saving the choice. Preserve both originals and their receipts regardless of preference.

A deterministic left/right shuffle avoids assigning A to a fixed named review slot by design; the small pilot may still have an imbalanced shuffle. Do not use the older GLSL pixel-fitting score as the outcome for this study. No agent views images. Seers feedback is a separate optional condition and is not invoked by preparation.

## Time and evidence

Expected image-generation time is similar because the checkpoint, resolution, steps and guidance are fixed. Measure transformer/denoising time, text encoding and complete worker time separately where exposed. Longer prompts can affect encoding; total queue and transfer time are separate. No speed improvement is assumed.

Six images provide a small exploratory comparison, not a general claim that one prompting protocol wins. Note failures, ties, clipping, truncation and any precision/runtime differences. Freeze a new revision before changing B or broadening the scene set.

## Guided operation

The default guided pilot stops after each verified pair for a light review. A three-pair cadence can complete the fixed batch before review. Prompts and numerical controls remain frozen in either mode. Start is explicit; the controller does not silently begin because a package was prepared. See the autonomy protocol for receipt validation, the native CLIP conditioning policy and bounded recovery.
