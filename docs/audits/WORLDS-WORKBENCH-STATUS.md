# Worlds and Workbench status

Read-only audit, 2026-10-18. Checked source and saved JSON receipts; no artwork viewed, rendering performed, services contacted, or GPU/worker changes made. This is a filesystem snapshot, not browser QA or a claim about the latest deployed build.

## What actually exists

| Surface | Implemented behavior | Limit |
|---|---|---|
| `/worlds/draa-valley/` | WebGL2 procedural GLSL scene; 848 bounded numeric parameters; movement/look/return; parameter editor; source and recorded Seer evidence; view export. Saved recipe links restore parameters, camera and clock and reject a changed fragment shader. | An authored interpretation, not recovered geometry. Terrain-following movement has no building/interior collision. Acceptance remains pending. The default route opens the original trial, not the best fitting result. |
| Workbench → Image → World → Experiments | Saved source/baseline/best comparisons, every candidate, downloadable scene recipes, Explore links, translated captures, follow mode and 20-item pagination. Refresh pauses while hidden/inactive. API validates immutable image/recipe identities. | Numerical scores do not establish visual quality, correct depth or traversal. Recipe exploration requires the matching current shader; unsupported old shader revisions retain captures but cannot be explored through that viewer. |
| Pixel fitting | Actual local CGL rendering and bounded parameter search, persistent loop implementation, objective versions, complete saved candidate states and validation captures. | Settings API updates configuration; it does not launch a stopped Python fitter. One live loop state is global, not one independent running loop per displayed source. |
| Contour fitting | Source-matched attributed box hypotheses, coordinate ambiguity records, numerical contrast extraction, failed first proxy fit, and a second 24-render refinement with full histories. | Saved research results only; no live Method2 controls. Boxes/contrast points are not segmentation or recovered depth. |
| Experiment4 source surface | Three saved relief conditions, source-RGB vertex attributes, GLSL instanced quads, movement/return viewer, hashed binary geometry. Saved native512 proof records 262,144/262,144 equal arrival pixels, max RGB byte difference0. | Exact source encoding is not reconstruction. Depth is handwritten row/luminance relief; source pixels supply appearance. Keep separate from the strict procedural, no-source-pixel world contract. |
| Research | Searchable approach catalog, notes, shortlists, pipeline recipes and saved experiment plans with explicit missing adapters. | Plans do not execute pipelines, install models or generate evidence. Most pipeline entries explicitly require adapters. |

Evidence: `src/workbench-results.js`, `server/world-experiments.mjs`, `scripts/worlds/fit_parameters.py`, `scripts/worlds/fit_loop.py`, `scripts/worlds/contour_refine.py`, `public/worlds/draa-valley/world.js`, `public/worlds/source-surface/viewer.js`, `scripts/worlds/source_surface.py`, `src/research-experiment-planner.js`.

Saved local history at audit time contains **8,099 candidates in258 batch records**:

- Experiment1 FLUX.2:4,536 pixel-fitting candidates across145 batches;25 contour candidates across2 records.
- Experiment2 FLUX.1:3,072 pixel-fitting candidates across96 batches.
- Experiment3 source initialized:463 pixel-fitting candidates across14 batches.
- Experiment4 source surface:3 conditions in1 record under Method3.

These are archive counts, not active jobs. `.runtime/worlds/fit-loop.json` records **stopped**, Experiment3, objectivev2. Settings still have `paused:false`; that does not mean a process is running. Sources, objective versions and capture resolutions differ, so totals and scores cannot be treated as one comparable optimization sequence.

## Concrete cleanup findings

1. **Worlds copy contradicts completed work.** `src/worlds-panel.html` still says fitting is the “next integration step” and marks Make a place / Render & refine PLANNED. `docs/IMAGE-TO-WORLD-PROTOCOL.md` also says a general pixel-fitting optimizer is not implemented. Update these as bounded implemented experiments, while preserving the real missing work: Basalt-native integration, new-source semantic constraints, perception/exploration acceptance, and structural conversion.
2. **Five method buttons imply five available implementations for every source.** `src/workbench-results.js` and `src/workbench-controls-tab.js` always list all five. Saved data currently covers Method1, Method2 and Experiment4's diagnostic under Method3; Methods4/5 have no runs. Show available results first; keep unimplemented methods in Research with an explicit status. Label Method3's existing output **Source surface diagnostic**, not completed Structure search.
3. **Controls are duplicated and overloaded.** Experiments contains a collapsible fitting-controls sidebar; Workbench also has a separate Controls tab with the same controls and source/method selectors. Production has another Controls tab. Choose one research control surface and label it **Fitting controls**. Retain an obvious way to access it from results; keep production generation controls independent.
4. **“Run loop” overstates its action when stopped.** `src/workbench-controls.js` only POSTs settings to `/api/world-algorithms`; `server/world-algorithms.mjs` saves JSON and reads process state. There is no spawn/restart path. Distinguish **Resume existing loop** from **Fitter stopped**; do not show an enabled-running switch as evidence of execution. Preserve existing generation behavior.
5. **Worlds currently advertises only the original trial.** Its prominent link has no recipe and therefore loads baseline parameters. Put the source-linked saved result and experiment history ahead of the old baseline; retain the original as a named baseline rather than silently replacing it.
6. **Scores resemble quality ratings.** Result cards turn `weighted_total` into `10 × (1 − error)`; source is10/10. The title warns this is heuristic, but the visible number still invites an aesthetic interpretation. Prefer **Source match error ↓**, retain component details and objective version, and label encoded source surfaces separately. A source-pixel copy's perfect arrival score must not imply an accepted world.
7. **Workbench context can be surprising.** `src/study-context.js` defaults to Production → Precision; `/workbench?experiment=…` selects Image → World. `src/study-panel.js` makes the same Experiments/Controls tabs mount different applications by selected study. Keep a visible study title in the content, preserve direct links, and avoid repeating Production → Precision as if it were ordinary production generation.
8. **Research breadth is useful but not production functionality.** Its catalog includes mesh/splat/depth and native model proposals with missing adapters. Keep these in Workbench Research; representation contracts must state whether source pixels, meshes or splats are used. “Rendered with GLSL” alone does not meet the strict procedural world constraint.
9. **Saved experiments still depend on the workstation API.** Vercel proxies `/api/*`; the local store reads ignored `.runtime/worlds` records/artifacts. Static viewer deployment is not a self-contained history deployment. Keep this dependency explicit in operational status, not as extra gallery navigation.
10. **Experiment archiver has stale recipe assumptions.** `scripts/worlds/archive_experiments.mjs` treats `data.recipes` values as JSON bytes (`Buffer.from(body)`), but current `createExperimentStore()` stores locator objects and supplies `readRecipe()`. It also does not archive source-surface binaries/viewer shader identities or materialize full batch histories from summary records. Do not claim the current complete research history is R2-restorable from this script. Existing archive proof records165 verified objects from an earlier snapshot; no upload was attempted during this audit.

The trial's Sun and Channel controls are **not classified as broken**: although legacy duplicate handlers remain near the file end, asynchronous startup installs the actual parameter/uniform handlers afterward. Removing obsolete duplicates would simplify maintenance, but is not required to restore those controls.

## Recommended separation

- **Production:** existing generation Stream/Compare, production parameters/queue, models and operational tools. Do not connect fitting pause/settings to generation queues.
- **Gallery:** completed images and curated collections; browsing and source provenance. No fitting methods, loop switches, empty research tabs or infrastructure panels.
- **Workbench → Image → World:** Results, Fitting controls, Research. Results owns source/method selection, saved histories, representations, source-match components and Explore. Research owns unimplemented methods, pipeline plans and documentation. Link a promising saved world into Gallery only with an explicit acceptance/status record.
- **World viewer:** open from a specific saved recipe; name the source, representation and acceptance state. Preserve baseline and all prior iterations. Keep source-encoded surface diagnostics visibly distinct from procedural worlds.

No implementation, deletion, navigation migration or service action is part of this audit.
