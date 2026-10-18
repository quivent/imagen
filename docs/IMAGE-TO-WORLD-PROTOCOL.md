# Imagen to Basalt world protocol

Agreed protocol, 2026-10-17. Turn selected Imagen artwork into an explorable Basalt world by fitting existing authored scene programs and their data, then refining the result through Seer feedback. Basalt already supplies scene composition, shared geometry and materials, camera and navigation machinery, compilation, resident execution and presentation. The new integration is image analysis, mapping to those existing capabilities, and a bounded fitting and evaluation loop.

This document specifies the workflow. It does not establish that the image-to-world fitting system is implemented, that every scene supports every interaction, or that a particular world has passed its execution and exploration checks.

## Shared pipeline

Selected artwork → Seer scene brief → existing Basalt foundation → permitted parameter fitting → Basalt render → Seer feedback → exploration checks → owner acceptance.

### 1. Select and preserve the artwork

Choose one existing completed image. Preserve its immutable identity and SHA256, generation receipt, original prompt, model revision and recorded generation settings. Preserve the accepted original throughout fitting. A candidate world, its renders and its feedback are separate artifacts linked to that source image.

Work from ordinary authorized artwork. Do not generate extra test artwork or change production generation settings for protocol verification. Agents do not view images; vision models inspect image content, and Jay judges the visual result.

### 2. Produce an attributable scene brief

Pixtral and Gemma inspect the image and describe subject, composition, objects, spatial relationships, lighting, palette, materials, apparent scale and atmosphere. Separate visible observations from inferred geometry and invented hidden space. Record ambiguity and disagreements instead of silently treating either model's interpretation as ground truth.

The brief follows Basalt's existing scene-design decisions: subject, light story, eye, essential feature, scale ladder, palette roles, value structure, parts, materials, motion and budget. Additional depth or segmentation models may supply constraints if separately provisioned and verified. Pixtral, Gemma and DINO availability does not itself establish a depth-reconstruction capability.

One view cannot determine the unseen sides or connected space. Record which parts of the world are inferred or authored extensions of the image. Metric dimensions require a declared reference; an image alone does not establish physical scale.

### 3. Map the brief to existing Basalt programs

Inspect the current authored worlds and shared libraries before proposing missing capabilities. For each required part, identify the reusable scene, geometry, material, composition and navigation programs, their source revisions, their declared inputs and the evidence for the selected execution route.

Distinguish reusable capability, a known integration boundary and an unassessed capability. Historical receipts and source inspection guide selection; neither establishes that the selected world works now. Use the existing scene catalog and task records rather than creating another world registry.

Choose one bounded existing world as the first foundation. Preserve its accepted behavior and working execution route while preparing a candidate.

### 4. Fit permitted data within the authored contract

Select the existing inputs that may vary, their names, units, coordinate conventions, ranges and dependencies. Candidate parameters may include camera pose, proportions, placement, palette and material values where the selected programs expose them. Keep an explicit list of fixed properties and permitted changes.

The fitting loop proposes candidate values, renders them and evaluates the results. Record the candidate's parameter changes and the reason for each revision. Do not silently alter geometry, navigation, a march budget or material mathematics outside the permitted scope.

Computation belongs in Lithos `.ls`; Lion `.lion` carries data. Shared programs remain in their existing homes and are reused with runtime values. Never duplicate or compile a program per instance merely to change numbers. Do not add executable composition to Lion cargo, host scene mathematics, a new scene language, renderer or compiler as a shortcut.

Agents prepare analysis, mappings, parameter proposals and surrounding integration within the owning repository's rules. Jay authors Lithos and any new scene mathematics. A missing form is an authoring or language decision, not permission to implement it in another host language. This protocol does not authorize agents to write Lithos.

### 5. Render through Basalt's existing route

Use the existing compilation, binding, resident execution and presentation machinery. Preserve the distinction between a compiled scene artifact, bound AGX instructions and matching cargo; do not invent new packaging or apply placement twice. Programs are prepared and reused according to the existing runtime contract.

For every evaluated render, retain the source-image identity, selected scene and program revisions, cargo identity, parameter changes, camera pose, viewport, resolution and clock. Record the actual execution and presentation routes for that scene. Metal submission or presentation alone does not establish that scene computation ran as Lithos-produced AGX.

GLSL is an optional output route when an existing supported consumer requires it. It is not an intermediate prerequisite for the native Basalt path. Compatibility with generated meshes or splats is a separate intake question; importing a 3D asset does not by itself create a traversable Basalt world.

### 6. Evaluate and refine through the Seers

Pair every rendered image with its own immutable identity, candidate parameters and view before requesting feedback. Pixtral and Gemma assess visible composition, lighting, palette, materials, source resemblance and consistency between views. Keep each model's attributed feedback and revision with the render it evaluated.

DINO supplies visual features and similarity measurements. These support comparison; they are not aesthetic judgments, geometry validation or proof of a successful world. Do not collapse all acceptance into one similarity score. A different viewpoint may legitimately differ from the source image.

Evaluate the source-matching view and additional recorded viewpoints. Preserve identity, spatial relationships and the intended light story as the camera moves. Feed the critiques into another permitted parameter proposal, retain the previous candidate, and repeat within the agreed work and resource budget. Stop or hand off when improvement requires new authored computation.

The Seers tab displays actual model inputs, review status and recorded feedback. Its presence does not schedule reviews, run the fitting loop or authorize automatic prompt changes. An executable fitting controller remains separate implementation work.

### 7. Demonstrate exploration and obtain acceptance

Use the selected world's existing navigation and probes. Start from a repeatable arrival, translate through space, reach a recognizable landmark, approach its detail, move around it or through an authored passage, and return reliably. Follow the authored scale, grounding and collision contract.

Show that the renderer consumed the changed camera position and produced corresponding parallax and occlusion. Looking around, orbiting a fixed target, zooming, changing field of view or animating a flat image alone does not establish traversal. Check the same feature from multiple positions, including newly revealed regions.

Measure behavior and latency only through the existing authorized Basalt procedure. This document authorizes no GPU benchmark or visible probe. Label performance targets separately from measured results, and keep component evidence distinct from a complete world trial.

Jay's explicit acceptance establishes accepted output. Planning closure, a successful compilation, a plausible model critique or a high similarity score does not. Preserve the last accepted artifact and route until its replacement has passed the relevant checks.

## Pure GLSL trial protocol

Jay authorized a pure GLSL trial on 2026-10-17. This is an explicit browser-rendered branch of the shared pipeline. Its scene computation lives entirely in GLSL: geometry, terrain, surface detail, material selection, lighting, water, ray construction and intersection. JavaScript supplies the WebGL canvas, input state, uniforms, loading and artifact export. Source artwork is reference only and is never a sampled shader texture. No meshes, image planes, depth maps, splats, Three.js scene graph, Metal scene implementation or native AGX claim belongs to this branch. Basalt's Lithos authorship, native runtime and existing scenes remain unchanged.

### Trial sequence and durable records

1. Freeze one already completed source image by profile, job ID and SHA256. Retain its prompt, dimensions, generation settings and receipt identity. Do not regenerate the source to suit the world.
2. Send the immutable image to Pixtral and Gemma. Capture each model's actual input identity, output, model name, time and completion reason. Request observed composition and landmarks separately from inferred depth, hidden space, dimensions and camera. Keep disagreements visible. DINO may later compare source and candidate but does not produce a prose brief or aesthetic verdict.
3. Choose a bounded set of recognizable features from those observations. Record each modeled form and parameter as observed, inferred or an authored extension. Existing approved GLSL may be reused where its inputs and execution contract match. A new GLSL interpretation is authorized for this trial; that is not permission to author Lithos or alter Basalt scene mathematics.
4. Keep the procedural scene in independently inspectable `.vert` and `.frag` sources. Expose the small set of fitted values as uniforms. Record the shader hashes, uniform values, camera location/orientation, viewport, clock and source identity for each evaluated view. Do not bake a different program for each parameter candidate.
5. Compile and link the shaders, check execution errors, and render an arrival view plus translated views. Preserve those as separate candidate artifacts with hashes. Static compiler success alone is not a rendered-world result. Alternate validation routes must identify any source adaptation and cannot establish browser or native AGX execution.
6. Send candidate renders to the Seers with their source brief and candidate identity. Record whether a model actually compared both images or assessed the candidate only against the textual brief. DINO's pairwise similarity is supporting evidence. Retain previous candidates and feedback; make a bounded parameter revision where justified. Do not describe manual orchestration as an automatic fitting loop.
7. Check arrival, translation toward a landmark, close approach, a lateral viewpoint and return. Capture changed positions and resulting render hashes. Pixel changes support movement but do not establish convincing geometry, collision behavior, visual resemblance or acceptance. Record navigation limitations explicitly. Jay evaluates the visible result and alone accepts it.

### Identification before fitting

A scene-category summary is insufficient. Before treating a candidate as a source-matching trial, both vision models perform three independent source-image passes: spatial inventory; surface and lighting analysis; and a proposed GLSL scene contract. Each pass receives the actual immutable source image, not only its generation prompt. Prompt requirements and visible observations must not be conflated.

The spatial inventory identifies distinct visible objects and coherent regions, estimated normalized screen boxes, silhouettes, relative proportions, visible parts, depth layers, overlaps and occlusion relationships. It also records negative space, horizon, vanishing-point and field-of-view estimates, plus features too uncertain to identify. Boxes and camera values are model estimates rather than measured segmentation, calibration or depth. No object quota justifies invented objects.

The surface pass identifies role-based palette estimates, separate materials, spatial texture frequency, edge character, visible reflectance, water shape and reflections, wet/dry bank transitions, sun direction evidence, shadow placement and softness, atmosphere and small identity-bearing details. Numerical physical properties remain inferred unless measured independently.

The scene-contract pass maps recognizable source features onto explicit procedural GLSL representations and adjustable parameters. It records image-space targets, relative placement and proportion constraints, source-view camera constraints, uncertain parameter ranges, unseen-space policy, additional viewpoints and rejection conditions. Geometry choices are implementation proposals, not image observations.

Retain each model's full response, completion reason, structured parse result and source identity. Truncated or unparseable output remains raw evidence and is not silently treated as a complete scene specification. Reconcile disagreements explicitly and retain both underlying observations. Promote only supported features into the fitting target; mark inferred completions separately. Every recognition constraint needs a candidate parameter or geometry mapping, or an explicit unresolved gap. Evaluate the mapping before adding detail: correct silhouettes, proportions, view composition and occlusion precede decorative texture.

A first shader draft built from the earlier broad descriptions remains a draft. Initial candidate feedback identified coarse palm/building forms, lighting and spatial-depth limitations. The expanded identification pass is required before claiming a faithful conversion; a live viewer, shader compilation and a similarity score do not waive that requirement.

### Pixel-guided iteration and inverse rendering

The [five candidate GLSL conversion methods](GLSL-CONVERSION-METHODS.md) specify alternative representations, fitting strategies and bounded first experiments. They are proposed experiments, not completed converters.

Jay requested pixel capture and iterative rewriting/fitting toward the closest practical GLSL interpretation. Treat this as inverse rendering: choose procedural structure and parameters whose rendered pixels explain the source, subject to semantic and exploration constraints. A single source view does not uniquely determine geometry, materials, light or unseen surfaces. No stage claims to literally reverse pixels into a uniquely recovered world.

Retain the untouched original. For each candidate, capture exact rendered pixels together with shader and parameter hashes, camera pose, viewport, clock, color conversion and execution route. Match source/candidate aspect ratio and document any crop or resampling. Evaluate in a declared common color space; handle tone mapping consistently. Pixel comparison is computation over bytes and does not grant agents permission to view images.

Fit in stages, retaining the best valid candidate and its lineage:

1. Establish source-view camera, framing, horizon, major silhouettes and negative space at coarse resolution.
2. Fit landmark positions, widths, heights, relative depth, overlaps, channel shape, bank profile and terrain contours.
3. Fit sun direction, shadow structure, sky and haze, then broad palette and separate material responses.
4. Fit per-object variations, crowns/fronds, masonry/roof forms, crop boundaries, reflections and surface frequencies.
5. Increase comparison resolution and revisit coupled parameters. Evaluate translated viewpoints and preserve coherent landmarks before accepting a lower source-view error.

The parameter model contains hundreds of independently mapped values, not a handful of scene-wide sliders. The first scaffold has 848 scalar values: 64 global/camera/material/light values, 192 palm values (16 instances), 288 building values (24 instances), 192 field values (16 instances), 64 ridge values (8 instances), and 48 bank-section values (6 sections). Each is consumed by GLSL; the initial values remain authored guesses rather than 848 observations or measurements. Screen-space targets from the Seers constrain these values only where supported. Record unidentifiable values and competing explanations instead of assigning false certainty.

Use a declared objective with separate reported components: coarse color/layout residual, edge/silhouette displacement, supported landmark/screen-region constraints, material/light consistency, optional DINO feature distance, model critiques, and penalties for broken exploration or implausible parameter values. No arbitrary weighted total is an aesthetic verdict. Report the selected weights and normalization; pixelwise error alone can reward blur, wrong depth or a source-facing facade. Reject tricks that paste source pixels into the shader or break other viewpoints to improve the arrival view.

Start with bounded coordinate or grouped parameter proposals; each proposal changes a recorded subset and receives a deterministic capture. Finite-difference or derivative-free search is an implementation option, not a claim of a differentiable GLSL renderer. Model-suggested structural edits are a separate versioned shader revision. Evaluate those against the best prior candidate before replacing it. Keep a change only when the declared constraints support it, or explicitly record why Jay prefers it despite a metric regression.

Stop on the agreed iteration/render budget, repeated lack of improvement, unresolved structural ambiguity, unsupported geometry, or Jay's direction. Retain the best candidate and all unresolved constraints. Record automatic search separately from manual proposals. The current trial supplies the source brief, parameterized shader, candidate capture and model-feedback steps; a general automatic pixel-fitting optimizer is not yet implemented.

### First trial: Draa Valley

The source is FLUX.2 job `1ebd04ec5f1d4eb8bee09bde90c4a206`, SHA256 `4750bc169d8d8f66e1f19176904c783d458121bfe8929c959180475f70e35218`, 1024×1024. Both Seers described a narrow irrigation channel, date palms, cultivated plots, an earth-built settlement with a prominent tower, and ochre foothills. Their suggested channel widths differ (approximately one versus four meters); neither estimate establishes metric scale. The initial modeled half-width is an adjustable one world unit. Hidden regions, exact layout, dimensions, ground surface, building forms and navigable extent are authored interpretations.

The browser trial lives in Imagen at `/worlds/draa-valley/`, linked from Worlds. Its `source.json` and `brief.json` retain source identity and attributed observations; `scene.vert` and `scene.frag` contain the procedural world. The presentation shell supplies walking, looking, return-to-arrival, sun/channel controls and view export. Terrain-following movement is bounded, with no building collision, interior traversal or reconstructed depth claim. This is the first manually orchestrated trial, not an implemented general converter. Render and feedback receipts report their actual completed stages; final visual acceptance remains pending until Jay approves.

## First bounded implementation

Use one selected completed Imagen artwork, one existing Basalt world and a small explicit set of existing parameters. Produce an attributable brief and reuse map; fit candidate values; render the reference view and multiple translated views; collect Seer feedback; demonstrate arrival, traversal, a landmark, close detail and return; present the candidate for Jay's acceptance.

Any missing geometry, material or navigation computation is recorded as a bounded authoring handoff with existing source references. No new general engine, scene DSL or independent world registry is required by this first trial.

## Records and ownership

Use existing receipt, artifact and task mechanisms to retain the source, brief, reuse map, allowed parameters, candidate lineage, render provenance, Seer feedback and exploration evidence. These are conceptual record requirements, not a new runtime file format or API. Keep model weights, captured images, generated renders, operational records and credentials out of source control; commit the protocol and maintainable implementation source.

Imagen owns generation provenance, model request and feedback capture, and the proposed fitting-loop integration. Basalt owns its scene, cargo, compiler, resident and exploration contracts. Jay owns Lithos authoring and visual acceptance. Changes to source or runtime behavior require their own bounded implementation scope.

Do not contact other agents or sessions without Jay's explicit permission. A documentation handoff does not grant cross-session messaging, model downloads, service restarts or implementation approval.

## Maintaining the protocol

Keep the Shared pipeline, First bounded implementation, Records and ownership, and Maintaining the protocol sections identical in both repositories. Update both copies together when the agreed protocol changes. Repository references below are local navigation aids and may differ. A mirrored document is not a second scene catalog or task ledger.

## Repository references

- [Seer runtime and feedback capture](../scripts/judges/README.md).
- Basalt counterpart: [Imagen to Basalt world protocol](../../Basalt/docs/worlds/worldbuilding/IMAGE-TO-WORLD-PROTOCOL.md).
- Basalt [scene design](../../Basalt/docs/SCENE-DESIGN.md), [AGX entry points](../../Basalt/AGX.md) and [execution contract](../../Basalt/AGX-PLAN.md).
- Basalt [worldbuilding authorship and task policy](../../Basalt/.worlds-tracker/README.md).
