# Live status matrix

Observed **2026-10-18 18:49:30 UTC**. This is a dated verification, not a permanent guarantee. Production HUD/API observations and the task ledger remain the current display. No images or screenshots were viewed.

| Component | Observed state | Evidence and limits |
| --- | --- | --- |
| Persistent model volume | Mounted | Live findmnt: V.56453901 at /workspace, XFS on /dev/loop23. Qwen and existing weights reside there. |
| FLUX1 GPU0 | Enabled, scheduler alive | HTTP 18761 health 200; actual native worker endpoint; current pair count 412. |
| FLUX1 GPU1 | Enabled, scheduler alive | HTTP 18763 health 200; separate native job root; current pair count 341. |
| Continuous generation | Advancing | 20 additional complete pairs / 40 images in 166.3s, across both lanes; 14.43 images/min in this observed window. Aggregate 753 pairs. This includes scheduling, transport and preflight gaps. |
| Render duration | Receipt-derived | HUD mean 3.76s across latest 40 images; not end-to-end latency. |
| Qwen | Loaded, TP2, MTP active | health 200 and model qwen-precision; actual two-rank response of 128 tokens in 4.32 s; MTP accepted 75 draft tokens. Context 4096, seq1, KV 768 MiB per GPU, prefill 512, NVFP4 with mixed FP8 layers, eager/text-only. |
| GPU headroom after TP2 | Measured, variable | GPU0 free 5,035 MiB; GPU1 free 49,955 MiB at the live snapshot. Memory varies during FLUX and Qwen requests. No clock/power changes. |
| Pixtral | Loaded and responding | health 200/model pixtral-critic; actual native chat reply in 2.0 s. |
| Gemma and DINO | Health responding | Both loopback health 200; this check did not invoke vision or judge artwork. |
| R2 uploader | Single writer | Existing artwork-r2 scans both native job roots. HUD reports upload queue clear when fresh pendingJobs=0; background reverification is a separate state. No additional writer launched. |
| Automatic naming | Fresh arrivals verified | 12 new arrivals: 6 per GPU, exact reservation workerPort and receipt hashes matched. All 12 named automatically and visible in Gallery; latest checked 3,859/3,859, no missing/hash mismatch. Naming PID 39323 heartbeat advanced. |
| New prompt baselines | Written and token-counted | 150 substantive assistant baselines, around 40 actual CLIP tokens including special tokens; painterly style retained. |
| Qwen prompt revision | Still in progress |30 retained drafts, 23 independently approved at this snapshot. Qwen selfdiff is not trusted automatically. The drafting/audit work remains open. |
| Revised production pairs | Applied and completed |2 baseline/Qwen complete pairs found in immutable package/control records, with explicit revision identity. Other historical pairs remain intact. |
| Qwen/Pixtral chat tabs | Actual app Send tested | Real native WebKit Send→model→stream→savedreply passed for both. Independent local histories; Stop cancels the model request; code stays text. |
| Production HUD | Native DOM verified | Live worker evidence, measured render mean, pipeline stages and observation age. Stale observations cannot claim rendering. |
| Navigation | Native DOM verified | Gallery/Production/Workbench/Worlds top-level; Monitor hidden. Prompts has two columns; tool tabs fill one row without overflow at 1024 px. |
| Source checkpoint | Committed | dd39bf4 captured app and sanitized server configurations; final follow-up includes rollout guards/docs. Runtime credentials/models/generated outputs remain ignored. |

The protocol is in `research/studies/art-direction-held-constant/PROTOCOL.md`. Operational recovery is in `docs/PRODUCTION-DAEMON.md`. Pending Qwen revisions remain visibly pending or rejected in Prompts; counts do not imply image-quality approval.
