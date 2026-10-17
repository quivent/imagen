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
