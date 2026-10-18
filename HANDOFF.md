# Imagen handoff — 2026-10-18

## Superseding update — work completed after the original handoff

The original notes below describe an earlier incomplete state. Current state supersedes them:

- Qwen is LIVE on TP2 across both GPUs, NVFP4 with integrated MTP3 verified by actual accepted-token metrics.768MiB KV perGPU, context4096, seq1, prefill512, eager/text-only; FlashInfer autotuning disabled after an oversized warmup workspace failed. Actual128-token response4.32s. Pixtral is loaded and answered real native chat.
- Qwen/Pixtral chat tabs are working in the native app; real Send→model→stream→savedreply tests passed at1.8s/2.0s.
- All150 substantive assistant baselines are written and actualCLIP/T5-counted, roughly40tokens with painterly style retained (small overruns accepted by Jay). Qwen is REVISING those assistant baselines, not authoring them. Its runner and independent text reviewer are still working; latest counts are visible in Prompts. Do not claim all150Qwen revisions complete.
- Prompts tab shows the two texts side-by-side, exact highlights/counts, Qwen selfclaims separately from independent audit, pending/rejected status. Only independently approved matching hash/authorship/token rows enter a new production package.
- New rollout is live: first2approved baseline/Qwen pairs completed on the EXISTING GPU0/GPU1 production daemons. Historical packages/source unchanged. A running pair loads its immutable saved package, so text updates never recompile or stop it. Unready scenes retain historical generation during incremental transition.
- Compact Production HUD is implemented and native-DOM verified: actual worker rendering/between-image/stale states, actual recent40-image render average and pipeline stages. Tabs expand to one row fitting1024px. Worlds top-level; Monitor hidden.
- Checkpointdd39bf4 commits168app/server/source files and sanitized current supervisor/launcher configs. Final follow-up commit covers rollout guards, docs and final chat/UI changes. No Verceldeploy or Gitpush requested/performed.
- Jay says complete all open tasks EXCEPT Qwen's work. Non-Qwen tasks (protocol docs, fresh-arrival naming, live-status matrix, rollout) are now finished/being final-committed. Qwen drafting and semantic review remain open; do not interrupt them. docs/LIVE-STATUS-MATRIX.md contains dated observations.
- Fresh names:12post-baseline arrivals,6from eachGPU, exact SHA/receipt/reservation/model-condition proof; all named and inGallery. Namingdaemon PID39323 active,3859/3859covered at latest check.
- Current user instructions remain: noimage/screenshotviewing, noChrome, no secrets, no generation stopping, no automatic Pixtral→prompt crosstalk.

## Original handoff snapshot (historical)

## Immediate user requests — unfinished, priority

Jay is replacing this agent. Stop unrelated work. The immediate request is substantive baseline prompts and Qwen revisions of those prompts, with a visible comparison and a compact truthful Production HUD. Jay explicitly says Qwen must write a revision of the assistant-written prompt. Do not substitute Qwen-authored baselines for that division of authorship.

Latest exact instructions: “The fucking baseline prompts are 5 words”, “Do 40”, “You write 77 token prompts or <77”, and finally “Qwen has to write a revision on your prompt”. Prior agent interpreted 40 as baseline token budget, but did not implement it. Write substantive assistant baselines of about 40 actual CLIP tokens, not short scene titles. Qwen revises each assistant baseline. Preserve scene identity and make changes meaningful; headings/reordering are insufficient. Count actual tokenizer tokens. Do not imply visible improvement without human judgment.

**No production corpus prompts were changed in this turn. No new baseline/revision pipeline was implemented.** Existing generation still uses the prior corpus. This is the central incomplete task.

## Exact Qwen count and current state

- Download COMPLETE from Jay’s private R2, not HF: RadixArk/Qwen3.8-27B-NVFP4, revision319f741cce68d7914884900c138a1fbb70a42f30.
- Source prefix: hf-cache/hub/models--RadixArk--Qwen3.8-27B-NVFP4/; source tree JSON maps content-addressed blobs. All required checkpoint/config/tokenizer files hash/size verified. Three safetensors headers checked against index. 15 MTP tensors present.
- Persistent destination: /workspace/artwork/judges/models/qwen3.8-27b-nvfp4. Download size21,944,881,549bytes. No Mac weight copy.
- Qwen LOADED and HTTP health200 confirmed. One actual text completion succeeded.
- **Qwen has produced ONE TEST RESPONSE containing TWO candidate texts: one baseline and one precision prompt for Sahara dunes, plus its self-reported diff. ZERO Qwen prompts have been applied to production. ZERO full-corpus Qwen revisions completed.** Neither candidate’s token count was verified. Its self-reported diff contains inaccurate claims; require an independent comparison, not blind trust.
- That one response existed only in tool output; it was not saved as a production prompt or scheduled. Re-create from intended assistant baseline rather than treating it as approved.
- Test baseline: “Sahara dunes at dusk, wind-cut ochre crests, blue-violet troughs, tiny distant ridge, low viewpoint, rippled sand foreground, layered dunes, open sky, no plants, buildings, camels, restrained painterly realism.”
- Test precision: “Low angle view of rippled sand foreground leading to wind-cut ochre dune crests. Blue-violet troughs shadow the valleys. A tiny distant ridge sits beneath the last amber light. Layered dunes diminish into open sky. No plants, buildings, or camels. Restrained painterly realism style.”
- Runtime GPU1, loopback http://127.0.0.1:8005/v1, served model qwen-precision. vLLM0.31.0. NVFP4 modelopt mixed checkpoint, BF16 compute, maxcontext4096, seq1, GPU utilization budget0.30, language-model-only, eager, speculative methodmtp/3tokens. Model config architectureQwen3_5ForConditionalGeneration and integratedMTP supported by installed runtime.
- Supervisor artwork-qwen. Source scripts/judges/start_qwen.sh, deployment/worker/judges/artwork-qwen.conf. Remote launcher /workspace/artwork/judges/start_qwen.sh and logqwen.log. Startup completed after FlashInfer compilation. Do not restart without need. MTP tensor presence/config verified; actual acceptance metrics not yet checked.
- Downloader source scripts/judges/download_qwen_r2.py; remote same basename under judges. Completed process104150 exited cleanly; log/workspace/artwork/judges/qwen-r2-download.log.
- Do not enable automatic Pixtral-to-prompt crosstalk. Pixtral observes and gives feedback; Qwen may translate feedback only through the explicitly agreed protocol. Current instruction is Qwen revises assistant prompts and diffs original versus revision.

## Token limits — important correction

Actual installed FLUX1 tokenizer configs verified: CLIP77 tokens (including special tokens), T5 up to512 tokens. BOTH receive text. Text past CLIP’s first77tokens can still influence FLUX via T5. Prior agent initially implied77 was the whole model’s text limit; this was wrong and was corrected to Jay. Image512×512 is unrelated. Native max_sequence_length is fixed512; do not expose a fake adjustable context control.

A manually drafted sample was tokenized as47 CLIP tokens, not40: “Moroccan Sahara at dusk, low viewpoint over rippled ochre sand. Unbroken dune ridges recede toward a tiny distant ridge; amber crests contrast with blue-violet troughs. Restrained painterly realism.” This was NOT saved or scheduled.

Current corpus: research/studies/art-direction-held-constant/corpus.json;150 scenes. All precisionAuthor fields currently Imagen assistant, precisionStatusdraft. Original prompts average136words; precision159words. Groups1–51 +8% words,52–101 +33%,102–150 +8%. Middle50 retain original and append spatial composition; uniquely add horizontal3:2 wording despite actual square outputs. Integrity audit passes but does NOT prove semantic equivalence. Jay sees five-word baselines; reconcile actual UI/title versus actual submitted prompt instead of dismissing his report. OriginalBrief/name/full prompt are distinct fields.

Source integrity: tools/artwork/prompt_clarity.py compile_corpus_package verifies source catalog identity and exact original fields. Do not simply overwrite prompt and break production. Implement a new baseline field/revision with explicit provenance, or another deliberate validated migration; in-flight packages are immutable and must finish with frozen texts/settings. Preserve historical results and distinguish new prompt revision in comparisons.

## Production HUD — requested, NOT implemented

Jay wants a SMALL HUD visible in Production: green when actually running, average generation time, pipeline bar/stages. No source code was written for it yet. Do not report it complete.

Useful observations:
- /api/prompt-study returns daemon.lanes, fresh heartbeatAt, runnerAlive lock evidence, enabled, stage,currentPackage,activeSettings; workflow.pairs contain images.left/right.seconds from actual render receipts and completedAt. Page1contains20latestpairs/40image render times. Clearly label measured render average versus end-to-end time.
- .runtime/monitor/status.json generation.workers provides actual remote health: profile,port,gpuIndex,phase,running,current,queued,paused and generation.observedAt. generation.archive has uploader backlog,pendingJobs,confirmedJobs,lastSuccessAt,etc.
- Green must require fresh actual running/completion evidence; process alive or model loaded alone insufficient. Explicit stale/unknown/offline states. Do not simulate percentage progress or show all pipeline stages green from scheduler enabled.
- Backend server/prompt-study.mjs caches production_feed.py bypage2sec; frontend src/prompt-study.js polls3sec onlyactive/visible. A small dedicated endpoint/module can reuse these observations. Global Production HUD should survive tab changes, not be another Monitor tab.

## Completed UI changes this turn

Worlds top-level after Workbench. Topnav Gallery / Production / Workbench / Worlds. Worlds removed from Production tools, opens directly. Monitor tab hidden; backend left intact. Existing agent had made these changes before context handoff.

Production Controls polished and actual editable controls:
- FrameSquare/Landscape/Portrait.
- Resolution512/768/1024 short edge. Landscape max1536×1024; portrait1024×1536. Accepted sizes multiples32, native worker supports max1536.
- FLUX1steps16/28/36 and guidance2/3.5/5, shared between both conditions.
- Apply parameters for NEXT complete pair per GPU; in-flight pair unchanged. Reset changes clears unsaved edits. No dropdowns/seeds/images.
- Native context remainsfixed512; an attempted adjustable context control was removed because native.py rejects other values.
- src/production-study-controls.js/.css; shared src/control-choice.js also used by legacy controls in src/app.js.
- tools/artwork/study_settings.py validates frame/sizes/steps/guidance; server/prompt-study.mjs settings action persists atomically. No actual generation settings were changed this turn.
- Tests: Node83pass/3skip, Python study_settings3pass, Vite build passes, git diff--check passes. Hidden WebKit tested frame→1536×1024,reset,nooverflow, without saving actual settings. Script .runtime/polished-controls-proof.js; harness scripts/worlds/verify_surface_webkit.swift. Never visually view images/screenshots.
- Fixed stale source-extraction marker in tests/model-steps.test.mjs after shared choice helper refactor; meaningful independent per-model step regression test passes.

## Live infrastructure / rules

Repo /Users/jay/Imagen. Native app /Users/jay/Applications/Imagen.app. Vite http://127.0.0.1:48624. No Chrome. No image/screenshot viewing by agents. Numerical PNG headers/DOM/tokenizer checks allowed.

Vast56453903: SSH root@184.186.104.194 port11012. Read /etc/vast-agents-guide.md before remote changes. VolumeV.56453901 physically verified at/workspace on XFS/devloop23,240GB;65GBfree before22GBQwendownload. Two RTX PRO6000 Blackwell96GB500W. GPU0FLUX+Pixtral/Gemma/DINO about78GBused. GPU1FLUX about33GB beforeQwen; Qwenweights19.84GiB plus boundedcache, plenty headroom observed. No existing workers stopped.

FLUX1GPU0HTTP18761 under/workspace/artwork; GPU1sameFLUX1HTTP18763 under/workspace/artwork-flux1-gpu1. Both continuous study schedulers must keep generating. Latest actual PNGheaders BOTH512×512 verified, not inferred from settings. No power/driver/speed changes authorized.

Scheduler tools/artwork/parity_daemon.py; launchd vision.influx.imagen.parity and .gpu1; state .runtime/research/production-parity-daemon and -gpu1; shared .runtime/research/flux1-prompt-clarity. Each sceneAthenB serial on sameGPU with sharedseed/settings. Preserve uncertain requests byID, no blind replay. Last observed aggregate514completedpairs and advancing. Current settings512×512/28steps/guidance3.5/context512.

One R2writer supervisorartwork-r2 scans both jobroots. Credentials private /workspace/artwork/r2/credentials.json; use programmatically only, never print/copy into docs/Git. Its Python is /workspace/artwork/r2/.venv/bin/python (system and mainworker venv lack boto3). Prefixartwork-comparison/2026-10-17-flux-study/.

Read AGENTS.md and docs/STARTUP-PROTOCOL.md. Daemon owns ongoing agent assignment; coordinator cannot arbitrarily reassign. Existing agents available; use exact journaled dispatch actions or user-authorized one-time delegation. Do not leave critical work to chase a new side request. Production must continue. No Verceldeploy without explicit request. Huge shared uncommitted checkout: preserve all work; no reset/blanket staging.

No commit or push was performed in this turn. Taskinbox entries cd01cef8-ee95-4b1b-a32a-51798ddd3220 and fd6219db-d5a2-4b30-aa3b-0af2c09e1977 describe Qwen download and Controls completion; prompt rewrite/HUD still pending. Avoid receipt blobs and perform concrete work. Jay is furious about unfulfilled promises, unnecessary explanation, and loss of context. Be brief and show working results.
