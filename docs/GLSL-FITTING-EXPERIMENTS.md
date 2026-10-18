# Saved GLSL fitting experiments

2026-10-18. First executable trials of Methods 1 and2 from [GLSL conversion methods](GLSL-CONVERSION-METHODS.md). Live history: `/worlds/draa-valley/iterations/`.

## Execution and preservation

The fixed Draa Valley shader remains unchanged. `scripts/worlds/offscreen_glsl.c` is a thin macOS CGL capture host: it compiles GLSL, passes numeric uniforms and reads pixels. It changes the GLSL version directive from300es to410 and omits the ES precision qualifier for this validation route. It supplies no scene geometry or materials and samples no source-image texture. Native captures do not establish WebGL rendering parity.

`scripts/worlds/fit_parameters.py` performs bounded coordinate proposals. Every candidate has a PNG, complete 848-scalar parameter recipe, camera, fixed clock, source/shader identity, objective components and running-best decision. Output directories cannot overwrite an existing run. Method 1 run1 recipes were reconstructed from its recorded deterministic proposal sequence, and its final reconstructed parameters were checked against the saved best recipe; later runs save recipes directly during proposal evaluation.

`experiment_store.py` atomically publishes separate run records. `/api/world-experiments` exposes their public metadata, immutable hash-verified captures and downloadable recipes. The viewer polls every 2 seconds while visible, retains failed/rejected attempts and can open a candidate in the existing interactive GLSL world. Recipe loading verifies the shader hash and parameter bounds. Baseline/live default parameters are preserved.

`archive_experiments.mjs` copies captures, recipes and scene specifications into an independent R2 experiment prefix. Every uploaded object is downloaded again and SHA256/size verified. The initial archive contains four run records and 165 verified objects including its manifest. The existing generation archive/index is untouched. Future runs publish local progress during fitting; run the archiver after a bounded run for remote persistence.

## Numerical objective

The original 1024×1024 source is identified by job `1ebd04ec5f1d4eb8bee09bde90c4a206` and SHA256 `4750bc169d8d8f66e1f19176904c783d458121bfe8929c959180475f70e35218`. PNG bytes are decoded numerically without an agent viewing them. Source and candidate use square framing; the source is area-averaged to 256 or512 without a crop or reference exposure/tone adjustment.

Comparisons use normalized display-RGB code values, not a claim of calibrated linear radiance:

- 60% mean absolute RGB difference after area averaging to 16×16.
- 25% gradient-magnitude difference at 64×64, scaled by the source 95th-percentile gradient with a 0.02 floor and clipped to [0,1].
- 15% mean absolute RGB difference at 64×64.

Weights are declared development choices. No similarity/edge metric establishes visual acceptance. Geometry or semantic fidelity can regress while a pixel objective improves.

## Results retained

| Candidate | Proposal search |256×256 pixel loss |512×512 pixel loss | Decision |
|---|---|---:|---:|---|
| Original baseline | None |0.169251|0.169458|Preserved |
| Method 1 run1 |24 proposals across 12 controls |0.139684|0.139530|Retained numerical improvement |
| Method 1 run2 |24 narrower proposals from run1 best |0.135992|0.135772|Retained numerical improvement |
| Method 2 initial |600 cheap projected-envelope proposals, then actual capture |0.181827|0.181660|Rejected under pixel objective; preserved |
| Method 2 run2 |24 actual-render proposals with soft contour constraints |0.162938|0.162861|Retained separate candidate |

Method 1 run2 is approximately 19.9% below the original baseline loss at 512×512. Method 2 run2 is approximately 3.9% below that baseline. These are loss reductions, not percentages of visual quality. The two methods used different proposal mechanisms and total compute; this table is not an equal-cost efficiency comparison.

Method 2's initial surrogate improved while the rendered candidate worsened. Its follow-up retains soft region constraints and a separate numerical edge-Chamfer measure instead of treating coarse palm envelopes as exact silhouettes. The follow-up contour total at 256 decreases from 0.032145 to 0.029955. That measure is separate from the common pixel loss and is not semantic segmentation.

Both methods have captured forward, lateral, close and return views. The three translated views differ from arrival and the fixed-clock return matches it. This checks deterministic state and changed views; it does not demonstrate convincing parallax, collisions, interiors, correct hidden geometry or owner acceptance. Agents have not viewed the images. Jay's visual and exploration review remains pending.

## Reproduce a new bounded run

From the Imagen checkout, with macOS OpenGL/CGL, `clang` and Python/NumPy available:

```sh
python3 scripts/worlds/fit_parameters.py --output .runtime/worlds/method1/new-run
python3 scripts/worlds/fit_parameters.py --initial .runtime/worlds/method1/run1/candidate.json --step-scale .5 --output .runtime/worlds/method1/new-refinement
python3 scripts/worlds/contour_refine.py --help
node scripts/worlds/archive_experiments.mjs
```

The original source must already exist at `.runtime/worlds/method1/source.png` and pass its pinned hash. Remote model/GPU services are not required by these local fitting/capture runs. R2 archival uses the existing private credential configuration; credentials and generated artifacts stay outside source control.

### Continuing Method 1 loop and live algorithm controls

`scripts/worlds/fit_loop.py` continues from the best saved Method 1 recipe. Each cycle saves a new `run3-loop-*` directory and publishes every proposal without replacing previous runs. Methods 1 and 2 remain separate.

Version 1 repeatedly searched 12 controls at progressively smaller steps. Its 11 loop batches brought the 512-pixel weighted delta from 0.1357722783 to 0.1257515235, but later gains became small. Version 2 uses `scripts/worlds/search_controls.py` to rotate deterministically through 849 eligible scalar controls: 848 shader values, excluding the two ray-quality controls and the inactive fixed-clock water-speed control, plus four camera-pose controls. Families are camera, lighting, materials, terrain, palms, buildings and fields. Each proposal changes one scalar; paired positive/negative trials start from the same state. This broadens parameter coverage within Method 1 and does not implement the other methods.

The default batch is 32 proposals across 16 controls, with steps of 4% of each control’s legal range and a 30-second interval. The eligible control list interleaves families and rotates between batches. Three consecutive batches below the meaningful relative-gain threshold (default 0.2%) widen the step multiplier to 2×, then 4× after six; effective steps are capped at 25% of range. A meaningful gain resets the counter. Any strictly improved 512-pixel validation may be promoted, including gains below that threshold: the threshold governs exploration, not acceptance. Search proposals are selected at 256 pixels. The metric, fixed shader and source remain unchanged.

The first version-2 batch reduced validated delta from 0.1257515234912956 to 0.12464259309331265 (0.8818425% relative improvement). This is a single numerical result, not evidence of perceptual or 3D-quality improvement.

The **Algorithms** page at `/worlds/draa-valley/algorithms/` tunes families, step size, proposals, interval, adaptive widening, meaningful-gain threshold and pause/resume. `/api/world-algorithms` serves sanitized live state and validates atomic settings writes. Editing requires the local workstation or an existing authenticated studio session; reads are public. Settings are saved to `.runtime/worlds/fit-settings.json` with a revision. The daemon snapshots them at each batch boundary and records them in the report. During a batch, UI changes are pending until the next batch; pause finishes and validates the active batch before holding. A changed settings revision wakes an idle loop within a second. The page distinguishes editable settings from active-run settings by revision.

The local launch agent `giving.imagen.glsl-fit-loop` keeps the loop independent of the chat session. Its source plist is in `deployment/launchd/`; paths refer to this workstation and must be adjusted elsewhere. State, stdout and errors are in `.runtime/worlds/fit-loop.json`, `fit-loop.log` and `fit-loop-error.log`. An exclusive file lock prevents duplicate loop workers. Hash checks protect the source/shader identity. Less than 5 GB free disk space prevents the next batch.

Stop gracefully after the current batch by creating `.runtime/worlds/fit-loop.stop`. To unload immediately, use `launchctl bootout gui/$(id -u)/giving.imagen.glsl-fit-loop`; completed candidates are retained. To resume, remove the stop marker and bootstrap the installed plist in `~/Library/LaunchAgents/` (or kickstart an already loaded service). Saved loop artifacts are local; they are not automatically added to the earlier verified R2 experiment snapshot. Neither generation GPUs nor inference services are started by this loop.

The viewer has five method buttons, with saved runs and loops nested under each. Untested methods show an empty state. With “Follow new iterations” enabled, the viewer advances when the latest run in the selected method was selected; an explicitly selected older run is preserved.

Card score is `10 × clamp(1 − weighted pixel delta, 0, 1)`, displayed with six decimal places. Source against itself is 10/10 with zero delta. Delta is displayed as `100 × weighted delta` percent, with six decimals. This is a display transformation of the image objective, not a calibrated perceptual or 3D-quality rating. Source and objective are shared, but capture resolution must also match for fair comparisons. The Algorithms page’s best score uses 512-pixel validation; candidate cards use the recorded candidate capture, typically 256 pixels. A common-resolution overall leaderboard is not yet implemented.

### Objective version 2: literal fit

The legacy objective's 16×16 coarse-color and 64×64 fine-color/edge reductions underweight visible detail. Its original baseline value, 0.1694576452 at 512 pixels, must not be described as “17% of the image differs” or as a calibrated 8.3/10 resemblance rating.

`literal_components` in `scripts/worlds/pixels.py` measures corresponding pixels over the complete capture, using the source area-resized to the same dimensions. No alignment, palette correction or exposure fitting is performed on the source. Version 2 combines:

- 50% **pixel mismatch coverage**: fraction of corresponding pixels with RGB RMS error greater than 0.10 on normalized display RGB channels. This is an explicit initial tolerance, not a perceptually calibrated difference threshold.
- 35% **local structural difference**: luminance SSIM-derived difference in a 64×64 grid of patches, retaining within-patch variance and covariance. Each patch is 4×4 pixels in search and 8×8 in validation. Local SSIM uses constants 0.01² and 0.03²; its contribution is `clamp(1 − SSIM, 0, 1)` averaged across patches.
- 15% **full-frame color error**: mean per-pixel RGB RMS difference over all capture pixels.

For the original baseline at 512×512, pixel mismatch coverage is **62.728118896484375%**, structural difference is 0.5850974040742376, full-frame RGB RMS is 0.15476050235225808, and the new composite is 0.5416387612612437. The resulting rough score is 4.583612/10. The coverage's proximity to Jay's estimated 62% does not establish calibration: the 10% tolerance was selected before evaluating this result, and the tolerance sensitivity was also examined at 5%, 15% and 20%. Numerical audit: `.runtime/worlds/objective-v2-audit.json`. No images were viewed by agents.

The source still scores 10/10 against itself. All other scores are heuristic fit ratings. A weighted composite expressed as a percentage is an error index, not a fraction of perceptually incorrect content. The Algorithms page separately reports the directly interpretable fraction of pixels outside tolerance. 3D coherence, exploration, hidden geometry and performance remain outside this rating.

The loop snapshots `objectiveVersion` per run. Switching objectives recomputes the seed's validated error under the new objective and resets the small-gain counter before any new promotion. Historical reports are immutable; their objective defaults to version 1. New runs retain version and weights. Literal and legacy scores must not be ranked together. Algorithms exposes both objective choices; Literal fit is now active. CLI reproduction may pass `--objective-version 2` to `fit_parameters.py`.

Card delta is a **relative improvement in fitting error from the preceding displayed candidate**: `100 × (previous_error − current_error) / previous_error`, displayed with a sign and six decimals. Positive means improvement (sage); negative means regression (clay). The first candidate compares with the batch baseline; the saved-best overview compares with the previous saved best represented by the batch baseline. Source and baseline have no prior-candidate delta. A zero previous error displays an em dash rather than dividing by zero. The comparison is between saved proposals in sequence, not necessarily the optimizer's accepted parent, since paired proposals can share a parent state. This display convention does not change the fitting objective or stored results.


### Unified native Vite Workbench

The experiment workspace lives in the existing Vite app at `/workbench`, registered with the same tab and panel lifecycle as the other studio tools. `src/workbench.js` composes two native components:

- **Results** (`workbench-results.js`, `.html`, `.css`): the main workspace, containing the five method selectors, nested runs/loops, source → baseline → best comparison, saved candidates, detailed modal and translated views. Its IDs use the `iter-` prefix and styles are scoped to `.workbench-results`.
- **Controls** (`workbench-controls.js` and markup/styles in `workbench-panel.html`/`workbench.css`): an independently collapsible side panel for the selected method, with loop control, search families, step/batch/interval tuning, live status and collapsed scoring details. Its IDs use the `wb-` prefix. Methods without a tuning runner show an explicit note while keeping their saved outputs accessible in the main workspace.

There is one method selector; choosing a method selects real experiment outputs and updates the Controls context. The Controls switch opens/closes the side panel and remembers the choice for the browser session. Wide screens show controls beside results; narrow screens use an overlay panel that starts closed. Candidate layout responds to the actual available workspace width. Existing image caching, source identity, score/delta precision, card Explore links, recipe downloads and modal inspection are preserved. No iframe or duplicate static application is used.

Both components poll only while the Workbench is active and the document visible; Controls also pauses polling when closed or the selected method has no live tuner. Timers are disposed through the app’s existing HMR lifecycle. Search settings use the same `/api/world-algorithms` endpoint and daemon. The method selection has no effect on which algorithms are running; it selects the visible outputs and control context.

The old `/worlds/draa-valley/iterations/` URL redirects into Workbench and preserves method/run query selection. `/worlds/draa-valley/algorithms/` also redirects into Workbench. Standalone controllers were removed after migration into `src/`. Workbench follows existing public/studio navigation visibility. This integration is local; Vercel has not been redeployed since Jay requested local iteration.

`server/world-pages.mjs` fixes Vite’s local directory-index behavior for the three Draa Valley page directories. Without explicit rewriting to each `index.html`, Vite’s SPA fallback could return the main studio with HTTP 200. Verification checks the returned HTML identity, not merely status. Query parameters such as recipe and method selection are preserved; unrelated API/assets are untouched.

### Multiple source experiments, hot reload and paged output

`public/worlds/experiments.json` defines top-level source experiments. Experiment 1 preserves the FLUX.2 source and all 143 completed loop batches, earlier runs and contour work. Its immutable stop-state and settings are recorded in `.runtime/worlds/experiment-1-loop-final.json` and `experiment-1-settings-final.json`. Experiment 2 uses FLUX.1 job `bd704f7d9a3e4cd29d14d39695fab4cf`, SHA256 `9416c4ea4a2a9767d5025cedbd0887600c4618d2eb49f76b5d7bde0fe5a0c897`, 512×512, with the same Draa Valley prompt and seed47 as Experiment 1. Selection used metadata; image bytes were downloaded and hash-checked without viewing.

Experiment 2 fits and validates at the source's native 512×512. Its fresh initialization uses the original authored shader parameters, not Experiment 1's fitted best. The first batch changed literal weighted error from 0.758905425034867 to 0.720463579666743. Its loop saves to `method1/exp2-*` and uses an independent seed/counter; it ran until the Experiment 3 handoff below. `.runtime/worlds/active-experiment.json` identifies the active source file and seed. Switching the UI experiment changes the view only; it cannot change the fitting daemon's active source. Archived experiment controls are hidden while its saved outputs remain accessible.

### Experiment 3: source-directed initialization

Experiment 2 was stopped gracefully at cycle95, preserving best native512 error
0.5834505936693694. Its immutable handoff snapshots are
`.runtime/worlds/experiment-2-loop-final.json`, `experiment-2-settings-final.json`
and `experiment-2-active-final.json`; every run and artifact remains available.

Experiment 3 uses exactly the same FLUX1 source, authored GLSL topology, native
512×512 captures and literal-v2 selection objective. It starts from the original
authored parameter scaffold, not Experiment 2's optimized recipe. The new
`scripts/worlds/initialize_from_source.py` first probes broad camera, focal length,
eye height, channel width and foothill-height adjustments. It then estimates
finite-difference RGB responses for material/sky/haze palettes, shared plot colors
and exposure. A regularized joint least-squares solve proposes bounded appearance
changes from source-minus-render color residuals. Area-averaged RGB32 is used only
inside that proposal solve; every render and acceptance measurement remains512.

All derivative probes and joint proposals are retained as actual numbered
iterations, including rejected ones. Literal-v2 error must strictly decrease
before any recipe is promoted. The best initialization then seeds the ordinary
849-control search in independent `method1/exp3-*` runs. Fixed-clock repeatability,
translated views and exact return are checked before activating its loop.

This tests whether a deliberate initialization improves convergence. It does not
reconstruct arbitrary silhouettes, identify objects semantically, or recover
unseen geometry; the authored scene topology is still fixed. No agent views the
source or rendered images, and numerical improvements require Jay's visual and
exploration judgment. Compare Experiments 2 and 3 using the same source and metric,
with initialization render cost included when assessing search efficiency.

The first initialization saved47 proposals, taking literal-v2 error from
0.758905425034867 to0.6896567153040707. Native512 repeatability and exact camera
return passed; capture and recipe endpoint hashes matched. The loop then started
with a fresh cycle0 using this seed. Experiment2 remains accessible with3072
saved proposals; its best error0.5834505936693694 is still lower than the initial
Experiment3 result. No superiority over the completed Experiment2 search is
claimed. Open `/workbench?experiment=3&method=pixel` to follow the new loop.

### Experiment4: source-preserving GLSL surface

Experiment3 was stopped gracefully after cycle13 with native512 error
0.6059616014832654. Its final state, settings and active-source snapshots are
saved under `.runtime/worlds/experiment-3-*-final.json`; its candidates remain
available. No archived shader, source or recipe was changed.

Experiment4 creates connected per-pixel geometry directly from the FLUX1 image.
`scripts/worlds/source_surface.py` stores source RGB as normalized vertex
attributes and a shared-corner depth hypothesis. The GLSL vertex shader computes
surface positions and perspective unprojection; the fragment shader emits the
stored colors. There is no image-texture input. This is source-colored geometry,
not a compact analytic reconstruction of objects or source-independent materials.

Its generated baseline matches all262,144 RGB pixels at native512 exactly:
maximum byte difference0. This was checked numerically using the CGL renderer and
an independent hidden WKWebView running the actual viewer, without image viewing.
WebKit reported GL error0. Three saved candidates cover flat and two relief
strengths; translated views and recipes are retained in
`.runtime/worlds/method3/exp4-source-surface`. Hash-checked binary geometry is
served by `/api/source-surface/<sha256>.bin`; it is kept out of Git.

This exact match is expected from source-preserving encoding and does not prove
depth, hidden geometry, relightability or a complete world. The relief is explicitly
a handwritten image-row/luminance hypothesis. Source-view error cannot select
between arrival-preserving depths; the next research objective must evaluate
geometry or translated views independently. This baseline experiment is complete;
there is no automatic depth optimization loop claiming further RGB progress.

In Imagen choose Workbench → Experiments → Experiment4. It defaults to Structure
search and Explore opens the dedicated source-surface GLSL viewer. The viewer
provides movement, drag-to-look, a relief switch and exact return. The original
Draa Valley viewer and all previous recipes keep their original shader identity.
Both viewers retain the event-driven rendering scheduler.

`fit_parameters.run` accepts source metadata, experiment identity and search size explicitly. Initial recipes must match the source and shader hashes. Each recipe carries its source metadata so Explore and exported provenance identify the correct source. FLUX.2 Seer observations and baseline validation are not inherited by FLUX.1 recipes. No GLSL shader mathematics or generation workers were changed.

Workbench uses a breadcrumb: **Experiment → Method → Iterations**. Experiment and Method open selector buttons. Iteration-number selectors have been removed in favor of **Previous · Page N of M · Next** at the bottom, with a fixed20 saved candidate results per page. These saved candidate results are numbered as iterations across batches; internal run/batch IDs remain in provenance rather than the primary UI. The loop is the background process that keeps producing results. A final page may contain fewer than20. Follow new iterations selects the latest page; navigating pages disables follow and preserves the selected page. Delta compares with the preceding saved result, including across page boundaries. Metric-version boundaries use the corresponding baseline rather than subtracting incompatible objectives.

`/api/world-experiments?view=page&study=experiment-2&method=1&page=latest` returns only the selected20 results, reference/baseline/best, translated views, experiment catalog and pagination metadata. `server/world-experiment-pages.mjs` isolates sources and methods and caps pages at20. The original unpaged API and artifact/recipe URLs remain available for tooling and archival. `server/world-experiments.mjs` caches parsed manifests by modification time/size, coalesces concurrent collections and reuses the aggregate snapshot for one second. Image requests no longer parse every historical recipe again. In a local check, unpaged metadata was 4,363,866bytes; a selected page was23,325bytes (about99.5% smaller). Warm page responses measured2–3ms in that check; this is not an end-to-end browser benchmark.

Vite accepts Workbench component and raw-markup updates in `src/app.js`, remounting only the Workbench lifecycle. CSS uses Vite’s standard hot updates. A local Vite WebSocket test observed a `js-update` accepted at `/src/workbench.js` rather than `full-reload`. Fitting results use the paged live API independently of source HMR. No Vercel deployment was performed for these local changes.


### Canonical Workbench URLs

The native Vite workspace is `/workbench`, with readable selection state such as `/workbench?experiment=2&method=pixel&page=3`. Method slugs are `pixel`, `contour`, `structure`, `hypotheses` and `neural-field`. Internal IDs such as `experiment-2` and numeric method IDs remain in storage/API schemas, but are not required in browser URLs. Following live results omits `page`, so the link follows the latest page.

`src/workbench-route.js` parses legacy selection parameters and writes canonical URLs. Boot and tab navigation recognize `/workbench` directly; leaving Workbench restores the studio’s existing root/tab route and removes experiment-only parameters. Local middleware redirects old `?tab=workbench`, Iterations and Algorithms URLs to the canonical workspace. Static redirect stubs preserve legacy query state for old published links; the component normalizes it once loaded. World exploration and immutable recipe/image artifact paths are unchanged. Vercel’s configuration includes a static rewrite for future deployments; it has not been deployed during local work.


Workbench selection uses visible experiment buttons, followed by method buttons for the selected experiment. There are no dropdowns or dropdown-style breadcrumb selectors. The active experiment and method are highlighted; choices wrap within the available width. Bottom pagination remains fixed20 results per page. Switches remain the standard for binary settings.
