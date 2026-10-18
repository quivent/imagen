# Imagen startup protocol

The purpose of startup is to establish what is actually operating before changing it. Perform these checks in the background and give Jay a short factual status, not a receipt dump.

## Recover the assignment

Read AGENTS.md, the latest user instructions, the current study plan and the task ledger. The current production study is ADHC-001: exact production prompts versus saved precision rewrites of the same 150 scenes. Conditions for a scene use the same FLUX1 model, settings and seed and execute serially. Reviews never gate generation. Later passes use new paired seeds. Do not substitute the older FPC-001 three-seed draft or the archived three-brief proposal.

## Establish live operation

Read `python3 -B tools/artwork/parity_daemon.py status` and any explicitly configured additional lane status. Check launchd ownership, process lock and fresh heartbeat, then verify completed-image progress over an observed interval. Check the FLUX worker health and actual native jobs on each assigned GPU. A loaded model is not proof of useful work.

Read the instance's /etc/vast-agents-guide.md before remote work. Verify workspace_is_volume and the mounted volume identity, and confirm model/original paths resolve onto it. Do not infer attachment from the directory name. The established volume is V.56453901 mounted at /workspace; re-verify it live after instance changes.

If an already authorized daemon has stopped, diagnose its state and restore the same scheduler and recorded requests. Do not invent a second consumer, replace the model, change sampling controls, replay an uncertain job, or silently activate paid hardware. Respect an explicit user pause. Safe transport checks can retry; uncertain submissions require reconciliation by their existing job ID.

## Establish the display path

Gallery displays completed artwork from R2, updates automatically and contains no generation controls. Native Gallery can select the current study collection; All artworks preserves the earlier archive. The standalone public Gallery remains gallery-only.

Production selects an image-generation study. Its Controls must show the actual active scene and frozen settings, and its Stream/Compare must show that study's results. Workbench retains GLSL fitting/research. Do not put legacy FLUX1/FLUX2 controls under the active production/precision study.

Verify the actual local endpoints and numerical DOM state in Imagen's WebKit environment: current study identity, live daemon state, current scene, accessible controls, current Gallery arrivals and bounded comparison pages. No screenshots or image viewing. Navigation must not start or stop inference.

## Maintain the workers around production

Verify the single R2 uploader and the continuous naming daemon. Use `python3 -B scripts/image_names_daemon.py status` for naming heartbeat and missing-name counts. Preserve original IDs/hashes; naming reads metadata, not images. No additional R2 writer.

The agent-dispatch daemon selects available current sessions for explicitly ready authorized tasks. The coordinator must not choose ongoing assignments. Runtime -32600 prohibits direct child-session CLI input; for that explicit rejection, the daemon journals an exact followup_task action and queues it to root as a mechanical tool adapter. Execute that chosen action verbatim; do not choose another worker or ask for approval. Queue acceptance is not proof of activity: require the child’s actual lifecycle transition. Keep unresolved deliveries reserved against replay. Record requests and preserve UI/Performance mandates.

## Before reporting readiness

Observe completed-image progress, the display path and current agent assignments. Report only verified facts: whether generation is advancing, how many images are complete, the measured throughput window, any actual blocker and where Jay can see the result. Do not call a planned feature or merely loaded worker live.
