# Applying Basalt's latency discipline to the GLSL trial

2026-10-18. Read-only Basalt comparison and first Imagen scheduling change. No Basalt source was edited; no latency benchmark or resident probe was run.

## Evidence and transferable principles

Basalt's [FIELDLATENCY8 analysis](../../Basalt/docs/compilation/FIELDLATENCY8.md) separates input handling, changed-frame encoding, submission, GPU execution and presentation. Its saved presentation improvement did not shorten GPU execution. The GLSL trial must likewise distinguish draw-call CPU time, actual GPU time, and input-to-present behavior. A faster requestAnimationFrame callback is not a measured GPU or presentation improvement.

The recorded [AFFINE2 optimization](../../Basalt/docs/compilation/evidence/AFFINE2.json) composes repeated transforms and validates complete output under declared tolerances. Its [render-pass reuse record](../../Basalt/docs/compilation/render-pass-reuse.json) preserves output while reusing submission resources. The [event-driven latency record](../../Basalt/docs/compilation/live-latency-event-driven.json) replaces timer polling, with explicit limits on what its observations measure. These support reducing repeated work, retaining compiled resources, and separating measured changes from plausible hypotheses.

Saved Basalt timings concern their recorded native scenes, viewport and execution route. They are not timings for Draa Valley, WebGL, or the browser compositor.

## First implemented change: render fixed-clock candidates on demand

The browser previously requested another frame indefinitely, including saved candidates with a fixed clock and no movement. The frame scheduler now:

- Coalesces camera, parameter and resize changes into one pending request.
- Stops requesting frames after a fixed-clock view settles.
- Continues while movement is held or the scene clock is animated.
- Suspends hidden views and pauses while a dialog blocks the scene; explicit changes and returning to the page resume it.
- Resets elapsed input time after an idle interval, retaining the existing movement timestep cap.

Geometry, march limits, resolution policy, shading and shader source are unchanged. The fragment hash still matches the original trial, so saved parameter recipes retain their shader identity. Scheduler tests use a fake frame clock; they establish scheduling behavior, not browser latency or GPU speedup. No performance number is claimed.

## Shader work identified by source inspection

1. `main` computes terrain heights for 16 palms and 24 buildings in each fragment. These values depend on scene parameters, not the pixel. A candidate optimization is to compute them in GLSL at a less frequently executed stage and pass the results, subject to actual interface/resource limits and full-frame parity. Keep scene computation in GLSL.
2. `terrain` evaluates the six-section bank function directly and again through `channel`; it also evaluates an invariant terrain-noise expression inside the eight-ridge loop. Share identical intermediate values before considering approximation. Compiler elimination may already handle some repeated arithmetic; source inspection alone does not establish a speedup.
3. Finite-difference normals call the full scene evaluator six times per shaded hit, and shadow rays query it repeatedly. Investigate hit-specific or analytic derivatives and spatial bounds while preserving behavior at seams and occlusions. These are proposed changes, not equivalent implementations already established.
4. Rotation and other parameter-dependent transforms are recalculated within scene queries. Reuse them in GLSL and keep instance variation as data, following the same principle as Basalt's transform composition.
5. Keep the linked program, uniform locations, vertex array and transport resources resident. The current browser renderer already retains these; do not rebuild them on movement.

## Validation order

Preserve every existing scene and recipe. Stage each shader change as a separate version, then compare matched complete output at fixed parameters, camera, viewport and clock across arrival and translated views. Declare the required tolerance before interpreting differences. Never count lower resolution, fewer steps, reduced detail or changed shadows as an equivalent-work latency optimization.

Separate a verified output-preserving change from a measured performance result. Use appropriate bounded measurements for the selected execution route. Basalt's native benchmark and resident machinery remain governed by [its existing benchmark rules](../../Basalt/docs/compilation/BENCHMARKS.md); this document grants no probe execution or synthetic input permission.

The subsequent local Vite/Workbench lifecycle, history-memory and cache pass is documented in [VITE-PERFORMANCE.md](VITE-PERFORMANCE.md). It preserves the shader and objective; its HTTP/data-size observations are separate from GPU rendering latency.
