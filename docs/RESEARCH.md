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

The first navigation level is Production, then Workbench.

- Shared views: Stream and Compare reuse the same controllers and data.
- Production: Controls (FLUX generation), Tasks, Models, Seers, Collections, Worlds, Agents, Performance, Metrics, Daemons, Protocol, Rules and Monitor.
- Workbench: Experiments, Research, Controls (GLSL fitting), Tasks and Agents, plus the shared views.

The same display names for Controls, Tasks and Agents identify different panels and routes. Workbench routes are `/workbench/controls`, `/workbench/tasks` and `/workbench/agents`; Production retains its existing routes. Workbench Controls reuses the fitting controls inside Experiments, not the generation form. Both fitting views share one HTML template, controller and current experiment/method context. Inactive views stop their live observations; an external settings revision refreshes the other fitting view on return.

Tasks share the existing card/group renderer and collapsed Done format, with independent records. Production retains `tasks.json`; untagged legacy tasks belong to Production. Workbench uses the ignored `.runtime/workbench/tasks.json`, served through `/api/workbench-tasks`. Its Add task and state buttons save local records only; they do not dispatch workers. Writes require matching-origin loopback access and are serialized and atomic.

Agents share the component and canonical runtime evidence, filtered by the explicit `workspace` field on assignments. The monitor propagates this field from its existing private assignment registry; legacy untagged assignments belong to Production. A worker belongs to one workspace at a time. Coordinator scope is recorded separately. An empty Workbench assignment list remains empty, rather than rebranding the Production team. Stale activity remains unknown. No agent messages are sent by this navigation work.

Worlds currently contains the Draa Valley procedural GLSL trial and an overview of the image-to-world workflow. Collections retains saved Compare selections; the rename does not create a collection editor or alter saved data. Models, Seers, Performance, Metrics and Daemons remain in Production pending a separate placement request.

The selected workspace, last tab in each and experiment query are remembered locally. Early boot and mounted navigation agree on scope, including nested routes. Private tools stay out of public mode. This is a local Imagen change; no Vercel deployment occurred.

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

### Controlled experiment designer

Choose **Design experiment** on a pipeline to open Research → Plans. The designer keeps the pipeline context and asks for a registered source/baseline, a hypothesis, one change, controlled variables and a success criterion. Source choices use buttons, with dimensions, profile and exact SHA-256 shown as text; no image previews or automatic model calls are needed.

Saving writes a new immutable plan into the existing ignored workstation notebook (`.runtime/research/notes.json`). The server resolves the source from the registered experiment catalog rather than accepting client-supplied source metadata. It snapshots the source, baseline identity and pipeline recipe so future catalog edits do not rewrite the design. Export experiment includes those snapshots. There are no fabricated results: new plans are marked Planned, with empty evidence and no conclusion. A source-surface match remains distinct from evidence of correct 3D geometry.

Older notebooks migrate on read with an empty plans collection. Same-origin loopback authorization, atomic serialized writes and field bounds apply. The notebook holds at most 100 plans. Existing saved experiments, fit loops and archives are separate; saving a plan does not launch a run or change their data.

### Study contexts

Workbench has two adjacent study buttons: **Image → World** and **FLUX.1 · Prompt Clarity**. Selection is saved locally; explicit historical `/workbench?experiment=…` links still select Image → World. Switching studies changes no queues or worker state. Experiments and Workbench Controls swap their mounted components; the original GLSL query and artifacts remain available on return. Production remains independent of this selector.

Prompt Clarity's Research area presents its specification, implementation, generation protocol and actual preparation-script source. Its Stream and Compare have separate empty states until verified study results are imported; they never substitute the previous model-comparison archive. The guided controller imports receipt-verified pairs and saves blind human choices. The six-image pilot remains unstarted until an explicit Start action. The actual imported built-in tool runner is also readable in the original Research documents, separate from the FLUX.1 command adapter.

`/api/prompt-study` previews the compiled paired design and saves immutable JSON packages through a local, same-origin preparation action. Preparation alone exposes no implicit enqueue or inference; separate authenticated Start/review-and-continue actions control the bounded runner. `tools/artwork/prompt_clarity.py` provides the exact historical prompt, paired controls, alternating submission order, deterministic blind slots and explicit isolated factory enqueue for later authorized execution. Preparation does not call the built-in image tool, contact Vast, create a factory database, invoke Seers or change R2's writer.

### Gallery workspace

Gallery is a third top-level area alongside Production and Workbench, with no inner tool tabs or study selector. It shows the archive through the shared `archive-gallery` component. The separate `/gallery` entry serves this component without loading the studio application at all; `/gallery/studio` keeps the native top-level navigation available. Study-specific Stream/Compare views remain independent from this public artwork archive.

### Guided study controller

The FLUX.1 Prompt Clarity study now has a bounded execution controller rather than manual per-image handoffs. Research → Autonomy describes the implemented behavior. Controls holds the editable pair limit, review cadence and short review focus. Start is explicit; ordinary preparation, tab switching, polling and guidance saves never launch it. A detached bounded runner uses the existing native adapter, imports only receipt-verified pairs, waits at review checkpoints and respects pause requests. Compare provides Left/Right/Tie/Neither and explicit save-and-pause or save-and-continue actions.

The ignored per-package journal and factory store retain request IDs and evidence. A runner lock prevents parallel owners. Local receipt reconciliation never makes a generation request. Unknown submissions and changed controls/identities stop for attention. The read-only archive observer checks matching job/hash records in R2; it does not add another uploader or make review wait for a storage call. Guidance edits preserve the frozen prompts; a prompt change belongs to a new study revision.

Tests use synthetic numerical fixtures and injected launchers. The live GPU pilot is still unstarted. CLIP's native short-context behavior is explicitly recorded alongside T5's frozen conditioning limit; the earlier blanket no-truncation wording has been qualified in the study specification and protocol.
