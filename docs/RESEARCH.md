# Imagen research notebook

Research is a native-app Workbench tab. The initial catalog contains38 entries
across direct source methods, learned geometry, multiple views, representations,
rendering, optimization and hybrids. Model, representation and renderer are
different kinds of choices; they can be combined into a pipeline rather than
treated as exclusive competitors.

The catalog lives in `src/research-catalog.js`. Each entry records inputs, output,
the proposed route into GLSL, a limitation, a first test and a primary source or
local implementation. Tests and trial designs are Imagen research proposals,
not claims that an external model has been integrated or benchmarked locally.

Examples checked against primary project sources include
[Depth Anything3](https://github.com/ByteDance-Seed/Depth-Anything-3),
[SHARP](https://github.com/apple-aiml-research/ml-sharp),
[TripoSR](https://github.com/VAST-AI-Research/TripoSR),
[Stable Fast3D](https://github.com/Stability-AI/stable-fast-3d),
[TRELLIS.2](https://github.com/microsoft/TRELLIS.2),
[DUSt3R](https://github.com/naver/dust3r),
[VGGT](https://github.com/facebookresearch/vggt),
[3D Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting),
[Instant-NGP](https://nvlabs.github.io/instant-ngp/),
[nvdiffrast](https://nvlabs.github.io/nvdiffrast/) and
[layered depth inpainting](https://shihmengli.github.io/3D-Photo-Inpainting/).
Rendering references include [PBRT](https://pbr-book.org/4ed/),
[Mitsuba](https://www.mitsuba-renderer.org/) and
[Stanford's ray-marching implementation](https://github.com/stanford-cs348b/ray-marching).

Filters use buttons and text search. Shortlists, per-method notes and new ideas
are saved through `/api/research-notes` into ignored
`.runtime/research/notes.json`. Writes require a same-origin loopback workstation
request, are validated and serialized, and atomically replace the notebook.
Unsubmitted note drafts survive filtering within the mounted panel. The panel
loads lazily and does not run background polling or start models. Source-link
buttons copy citations without launching Chrome.

## Common trial record

Freeze source identity, dimensions, camera convention and declared work budget.
Record native-resolution source match separately from novel-view evidence.
Measure silhouettes, occlusion, parallax, close-up detail, return reproducibility,
reconstruction time, frame latency and memory. Mark hidden content as observed,
inferred or generated. Keep proposed speed advantages separate from published
claims and local measurements. A model's output needs an explicit GLSL export,
rendering or distillation path before it can count as an integrated method.

The five existing experiment methods remain available; this catalog deliberately
extends beyond them. No external model was downloaded or remote GPU started by
adding the notebook.

## Production and Workbench

The first navigation level is Production, then Workbench. Production contains
Stream, Compare, Controls, Models, Winners and Worlds. Workbench contains
Experiments, Research and the operational/research tools; Stream, Compare,
Models and Worlds are shared. Shared tabs reuse the same controllers and data.
The former inner Workbench tab is labeled Experiments. The selected workspace,
last tab in each and experiment query are remembered locally. Private tools stay
out of public mode. This is a local Imagen change; no Vercel deployment occurred.

Verification includes the Vite build, ten focused Node checks, source-surface
layout checks and a hidden WKWebView DOM check. The WebKit check switched both
workspaces, verified the six Production tabs, preserved the Experiment4 query,
and loaded all38 research cards. No screenshots or image viewing were used.

## Documents and study plans

Research now has Methods, Documents and Studies sections. Documents contains
**Where the Image Quality Comes From**, a potential explanation separating art
direction, generator capability and workflow optimization, plus the artwork
tooling portability audit. The connected **Art Direction, Held Constant** study
is under Studies, with its execution protocol and all three short/structured
brief pairs rendered in the app. Its36-image pilot remains planned, not queued.

Only these reviewed Markdown sources are bundled by
`server/research-documents.mjs`; direct raw Markdown requests remain blocked.
The reader creates text and semantic DOM elements rather than interpreting raw
HTML. Related-document buttons connect the hypothesis, study and audit. Source
citations copy their URLs without launching Chrome.

The imported runner and isolated CLI are indexed in `tools/README.md`. The core
already present in Imagen is reused. Verification passed23 inherited factory
checks, a state-isolation check, the app build and a hidden WebKit document/link
check. No study queue or generation request was created.

### Experiment pipeline picker

Research → Pipelines contains ten selectable recipes grouped as a tree:

1. Exact source surface — existing Experiment 4 diagnostic, with verified source-view equality.
2. Depth-guided surface — Depth Anything 3 into the source-surface geometry.
3. Occlusion-aware layers — inferred depth, hidden-region completion and layered GLSL surfaces.
4. Near-view Gaussian reconstruction — SHARP, followed by a GLSL splat adapter or explicit distillation.
5. Fast object reconstruction — TripoSR into a GLSL-rendered mesh.
6. Material-aware object reconstruction — Stable Fast 3D with translated materials.
7. Structured asset reconstruction — TRELLIS.2 with export and simplification.
8. Multi-view geometry — VGGT with held-out real views.
9. Radiance field → GLSL — Instant-NGP followed by an explicit baking/distillation step.
10. Inverse procedural world — source-derived geometry, camera and appearance fitting, including SDF, polygon and fractal candidates.

Recipes live in `src/research-pipelines.js`; the isolated UI component is `src/research-pipeline-picker.js`. They describe stages, proposed hardware, artifacts, first controlled tests and missing integration work. Primary model repositories are available through Copy model source. This is a recipe registry, not an inference scheduler: all exported plans disable execution, downloads, GPU startup and Seers contact. Model installation and live GPU occupancy are unverified. GPU placement is proposed; neither 96 GB card is assumed empty.

Add to planned experiments persists a `pipeline-<id>` shortlist entry through the existing same-origin workstation notebook API. Export pipeline plan produces a JSON manifest with the recipe, hardware assumptions, provenance requirements and common evaluation contract. Exported plans are reviewable inputs for implementing adapters, not commands that can silently start workloads. Existing experiments and source assets are unchanged.
