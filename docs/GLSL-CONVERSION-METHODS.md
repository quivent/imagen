# Five methods for image-to-world conversion in pure GLSL

Proposed experiments, 2026-10-18. These are alternative ways to construct and fit a scene, and can be combined. They are not five completed converters or measured quality results.

The target is an explorable three-dimensional interpretation of an existing Imagen image. All runtime scene geometry, intersection, materials and lighting must be computed in GLSL. A thin application shell may load shader source and numeric parameters, pass input/uniforms, and capture rendered pixels. Offline analysis and optimization may propose parameters or shader revisions; they do not become a second runtime renderer. No source-image textures, image planes, meshes, splats or external scene engine supply the visible world.

One image cannot identify hidden geometry, physical scale or a unique combination of shape, light and materials. Keep observed evidence, inferred values and authored completions separate. Agents do not view images; vision models inspect them, numerical tools compare pixels, and Jay evaluates and accepts the visible world.

## What we already have

- Existing FLUX images, prompts, immutable job IDs, SHA256 hashes and generation settings.
- Pixtral and Gemma for independent source analysis and candidate critique; DINO for feature similarity.
- The Draa Valley GLSL trial, camera controls and a searchable 848-scalar parameter scaffold covering individual palms, buildings, fields, ridges, bank sections and global appearance.
- Source-analysis records, captured candidate renders, model-feedback records and a view export carrying the current parameter state.
- A documented capture/feedback protocol. A general automatic pixel-fitting controller has not been implemented.

The 848 values are controllable authored guesses, not 848 measured properties. Source-analysis output also needs validation: the recorded Pixtral scene-contract response contains malformed JSON, while Gemma supplied pixel-like boxes despite being asked for normalized coordinates. Preserve those outputs; do not silently promote them into reliable fitting targets.

The common starting source is Draa Valley job `1ebd04ec5f1d4eb8bee09bde90c4a206`, SHA256 `4750bc169d8d8f66e1f19176904c783d458121bfe8929c959180475f70e35218`. Use the same source for initial comparisons so different methods do not receive easier artwork.

## 1. Fit the existing procedural shader

**Idea:** Keep the current scene structure and search its numeric parameters until its renders explain the source more closely.

**Procedure:**

1. Validate the source observations and declare the supported fitting targets.
2. Fit camera/framing and major landmark placement first. Fit channel/banks and object proportions next, followed by light, palette, materials and fine detail.
3. Search small related groups of parameters rather than changing all 848 together. Start with bounded coordinate search; introduce a more sophisticated optimizer only if the measurements justify it.
4. Render every proposal with a fixed clock and viewport. Compare coarse color layout, supported landmarks, silhouettes and edge positions separately; add DINO and attributed Seer feedback as supporting signals.
5. Keep the best valid candidate and preserve its complete parameter state.

**GLSL representation:** The existing heightfields, analytic forms and implicit surfaces, driven by per-object uniforms.

**First experiment:** Hold shader source fixed. Evaluate a baseline and at most 24 proposals affecting camera, channel shape, tower placement, ridge proportions and sun direction. Use a square source-matching view at 256×256 for exploration of the parameter space, then validate finalists at 512×512 and the recorded translated views. These are proposed budgets, not completed runs.

**Main limitation:** Numeric fitting cannot invent a missing kind of shape. A wrong palm crown or absent wall remains wrong even with well-fitted numbers. Stop and record a structural gap rather than compensating with camera tricks.

**Why try it:** It uses the greatest amount of existing work and gives us the quickest reproducible baseline.

## 2. Recover visible contours and fit geometric constraints

**Idea:** Build the geometry from the image's visible boundaries and spatial relationships before worrying about surface detail.

**Procedure:**

1. Identify the horizon, bank edges, water boundaries, ridge outlines, rooflines, tower silhouette, palm trunks/crowns, field boundaries and negative space.
2. Record confidence and approximate image coordinates. Validate coordinate conventions and mark occluded sections as unknown. Model-suggested boxes are initial hypotheses; they are not segmentation masks.
3. Fit source-view camera and projected geometry jointly. Infer a bounded heightfield, channel curves, building masses and plant forms whose projections satisfy those constraints.
4. Add plausible thickness, side surfaces and hidden continuation as explicit authored choices.
5. Test translated viewpoints before spending effort on materials.

**GLSL representation:** Analytic curves, height functions, extrusions and implicit surfaces evaluated directly in the shader. The result is genuine spatial geometry, with procedural surfaces completing unseen sides.

**First experiment:** Build a small validated constraint set for the two bank edges, tower, principal ridge and framing palms. Fit a geometry-only candidate with neutral materials. Compare contour error and a lateral view against Method 1 before adding appearance.

**Main limitation:** Visible contours constrain projection more strongly than depth. A shallow extrusion can fit the source and collapse from the side. Depth hypotheses and translated-view rejection checks are required.

**Why try it:** It addresses a major weakness of the first draft: naming an object is much less precise than reproducing its outline, proportion and overlap.

## 3. Search the GLSL program structure as well as its parameters

**Idea:** Search for a better procedural explanation when the existing shader's vocabulary is wrong.

**Procedure:**

1. Define a small approved vocabulary of reusable GLSL forms and operations: terrain profiles, boxes, tapered trunks, curved fronds, wall openings, unions, differences and bounded repetitions.
2. Propose alternative structures for one unresolved feature, such as a palm crown, clustered settlement or eroded bank.
3. Compile each candidate, check its execution and parameter bounds, and fit its numeric inputs using Method 1 or 2.
4. Compare candidates against source constraints and translated views. Penalize unnecessary complexity and source-facing cheats.
5. Retain the best structure as a versioned shader revision; instance differences stay in data rather than copied shader programs.

**GLSL representation:** Inspectable procedural GLSL assembled from a bounded set of forms. Any search representation is development tooling; scene computation remains in the resulting shader.

**First experiment:** Hold camera, terrain and lighting fixed. Compare three crown constructions for the framing palms, using the same candidate budget per construction. Keep the source-supported silhouette constraints and assess the crown from the side as well as from arrival.

**Main limitation:** Structural search expands quickly, and plausible code can still describe the wrong object. Bound the vocabulary, changed feature and search budget. Reject malformed or invalid proposals; do not execute arbitrary generated shader revisions without compilation and runtime checks.

**Why try it:** It gives the iteration loop a way to repair missing geometry instead of endlessly turning unsuitable knobs. Inverse constructive-solid-geometry research provides an example of searching program structure, but does not establish a ready-made image-to-GLSL converter for our pipeline. See [Metric Program Synthesis for Inverse CSG](https://people.csail.mit.edu/feser/metric.pdf).

## 4. Fit several plausible 3D interpretations and compare them

**Idea:** Keep several explanations of ambiguous depth, layout and hidden space alive instead of committing to the first guess.

**Procedure:**

1. Extract shared visible constraints, then identify the important ambiguities: channel depth/width, camera height, settlement distance, ridge scale or the placement of occluded plants.
2. Construct a small number of distinct, bounded scene hypotheses. Fit each to the same source using the same budget.
3. Render an identical route through each hypothesis: arrival, forward approach, lateral movement, landmark detail and return.
4. Ask the Seers to assess landmark identity, silhouette consistency and plausibility. A model's imagined hidden view is a proposal, not additional photographic evidence.
5. Present the surviving alternatives to Jay or keep competing interpretations recorded when the source cannot distinguish them. Do not average incompatible worlds into one.

**GLSL representation:** Shared procedural shader families with separate parameter sets and explicitly versioned structural differences where needed.

**First experiment:** Compare three Draa Valley hypotheses: a narrow/deeper channel, a wider/shallow channel and a more distant settlement. Keep image-space landmark targets shared, and compare their close and lateral views. No new FLUX artwork is required for this test.

**Main limitation:** Additional rendered views expose problems but do not reveal the source's true unseen geometry. Different generations sharing a prompt are not calibrated views of the same place.

**Why try it:** It directly handles the Seers' conflicting dimension estimates and tests whether a convincing source match remains a believable place to enter.

## 5. Fit a compact neural implicit field and evaluate it in GLSL

**Idea:** Represent difficult organic geometry with a small learned continuous function rather than hand-selecting every geometric formula.

**Procedure:**

1. Choose a bounded component, such as one ridge or rock formation. Supply explicit geometric priors and source-view constraints; a single image alone is not sufficient 3D supervision.
2. Train or fit a small coordinate-to-distance function offline. Fit procedural material outputs separately, or extend the field with carefully bounded material channels.
3. Implement the same fixed network operations in GLSL, with numeric weights as parameters. Validate parity with the offline function at recorded 3D points before rendering.
4. Check surface continuity, normals, safe intersection behavior and translated views. An approximate field is not automatically a reliable signed-distance function for unrestricted sphere tracing.
5. Compare this representation against the analytic component under the same source and exploration constraints.

**GLSL representation:** A small network evaluated using GLSL arithmetic, with weights supplied as numeric uniforms or uniform blocks within verified device limits. No sampled image, learned feature texture, voxel texture or external neural-rendering service supplies runtime appearance.

**First experiment:** Fit one background ridge as a compact implicit component. First verify the GLSL evaluator against its offline counterpart, then judge whether the component improves source resemblance and remains coherent from another position. Keep the rest of the scene procedural and unchanged.

**Main limitation:** Training, field regularization, safe intersection and shader resource limits add substantial work. The network can memorize one view while describing poor geometry. This is an experimental later branch, not the shortest first route.

**Why try it:** It may represent organic variation that is awkward in a small analytic vocabulary. SIREN demonstrates continuous neural representations including distance fields; adapting one into our GLSL runtime remains implementation work. See the [SIREN project and paper](https://www.vincentsitzmann.com/siren/). Original [NeRF research](https://arxiv.org/abs/2003.08934) uses multiple input views to fit a continuous scene function; it does not establish single-image recovery or a drop-in pure-GLSL solution here.

## Common comparison protocol

| Requirement | Rule for every method |
|---|---|
| Source | Same immutable image, original prompt retained as context, image observations recorded separately. |
| Runtime | GLSL computes the visible scene. Reference pixels remain outside the scene shader. |
| Capture | Same source aspect ratio, declared crop/resampling, color handling, viewport, pose, clock and execution route. |
| Parameters | Stable identities, ranges, origin, uncertainty and linkage to supported observations. Count genuinely consumed parameters rather than decorative controls. |
| Objective | Report coarse color/layout, contour/edge, landmark and semantic components separately. Save weights/normalization if using an aggregate score. |
| Exploration | Same arrival, forward, lateral, close and return views. Changed pixels alone do not prove parallax, coherent geometry, collision or traversal quality. |
| Fairness | Record proposal/render counts and structural changes. An initial equal candidate budget supports comparison, not a claim of equal compute cost. |
| Provenance | Save source, shader and parameter hashes, candidate lineage, captures, objective components, attributed model feedback and unresolved gaps. |
| Acceptance | Keep the last accepted candidate. Jay's explicit approval is required; no similarity metric or model critique establishes acceptance. |

Our earlier 480×300 validation captures demonstrate execution and changed views. They are not directly comparable pixel residuals against the 1024×1024 source without a declared, matching framing transformation.

For each method, retain the best candidate on each reported criterion and record tradeoffs. Inspect supported contours and layout before texture; do not reward blurred agreement or a facade that breaks under translation. Give more weight to better-supported constraints without hiding the others. Unknown source geometry stays unknown.

## Suggested order

Start with **1 + 2**: fit the current shader while replacing broad labels with validated geometric constraints. Use **3** where that exposes a missing form. Use **4** when several depth/layout interpretations fit the source. Reserve **5** for an organic component that simpler representations cannot fit well enough.

The immediate next implementation is a reproducible candidate controller: load source constraints and a parameter state, propose a bounded change, capture a deterministic GLSL render, compute the declared comparisons, retain the best valid candidate, and record why it changed. This document does not start GPU services, download models, run search budgets or authorize a Basalt benchmark.

See the [image-to-world protocol](IMAGE-TO-WORLD-PROTOCOL.md) for ownership, capture, feedback and acceptance rules.
