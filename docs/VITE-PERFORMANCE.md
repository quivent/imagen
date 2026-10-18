# Local studio performance

This records the October 18, 2026 performance pass. Changes stay local until Jay requests a deployment. Source images, experiment records, saved recipes, pure GLSL shaders and the fitting objective remain the authoritative research artifacts.

## UI lifecycle

Main panels load their component and markup only on first selection. Their controllers retain the existing active/hidden lifecycle. Pending imports cannot mount after disposal, and Workbench HMR destroys the old controller before remounting. Public Models still hosts Seers; public/studio navigation rules remain unchanged.

Workbench preserves image elements by candidate identity and image URL. A live append adds its own card rather than recreating Source, Baseline and previous candidates. Changed captions update independently. Closing the modal releases its image source. The image-readiness history is capped at 256 URLs; conditional page data at 16 requests. Existing experiment/method buttons, switches and 20-result pagination remain.

Models avoids rebuilding an unchanged inventory each second. It recomputes freshness, then rebuilds only when inventory or model state actually changes.

## Live observations

The shared WebSocket requests topics required by active consumers. Compare data is needed by Compare and Controls rather than every panel. Leaving the final full-gallery consumer releases the archive snapshot and switches remaining Stream consumers back to recent-only delivery. Cached small public observations still reopen immediately, with the server delivering a current snapshot on subscription. Controls remains private and is cleared when its last listener leaves. Server patch baselines and unsent observations are dropped when their topics are no longer requested.

Vite explicitly excludes `.runtime`, deployment sources and Python environments from its filesystem watcher. Operational-record watches remain in place. Runtime changes reach the interface through the existing APIs/live observations rather than HMR.

## Experiment history and artifacts

The server keeps compact run summaries and artifact locators. Parameter recipe bodies remain in the original records and are read and hash-verified when requested. Clean candidate metadata is written to the ignored `.runtime/worlds/.viewer-cache` directory. At most eight complete cleaned runs are retained in the hot cache; immutable source records are never rewritten by this cache. Superseded generated cache files are removed, with a grace period for concurrent readers/processes.

A per-snapshot experiment/method index stores run offsets, objective-version boundaries and best results. Page reads load only the needed runs and materialize at most 20 candidates. Up to 32 pages per experiment/method are cached; changed source metadata creates a new index. Encoded JSON is reused while its page object remains current. The response ETag allows unchanged polls to return 304 with no body; the client retains its own bounded page cache.

Image routes still require registered hashes and validate the actual PNG bytes on GET. Conditional immutable hits and HEAD avoid unnecessary body reads. Browser image caching keeps successful responses only, capped at 384 entries and 128 MiB, evicting oldest entries. This budget concerns browser disk cache, not decoded-image RAM.

Publication reuses already prepared immutable candidate records and hashes each unchanged capture once. Hash results are bounded to 512 files and candidate preparation to two runs. It still atomically publishes a complete run JSON record, retaining compatibility with archival and provenance tools; it is not an append-only record format. The running fitting daemon requires a graceful restart to import this Python change.

## Verification and measured limits

- The production build passes and produces separate panel chunks. The main HTML is about 19 kB and main JavaScript about 58 kB before compression; these are current sizes, not a measured before/after comparison.
- Regression tests cover retained image identity during live appends, inactive polling, modal disposal, lazy loading/navigation/HMR disposal, topic scope and patch recovery, gallery release, disk-backed history bounds and append continuity, page boundaries, cache budgets, and incremental capture hashing.
- One numeric snapshot contained 208 run summaries totaling 1,332,870 serialized bytes; two loaded cleaned runs totaled 48,233 bytes. No recipe bodies were retained; 6,716 recipe locators were indexed. These are serialized-data measurements, not heap or process RSS.
- A local warm page sample returned 19,507 bytes with request times 15.94, 1.63 and 1.91 ms. An unchanged conditional request returned 304 and zero bytes. These are small sequential HTTP observations, not a browser or end-to-end latency benchmark; older samples are not controlled comparisons.
- A saved capture and recipe were downloaded numerically and their SHA-256 identities verified. No images were viewed.
- The launchd fitter was signaled gracefully during cycle 55. It completed and saved cycle 56, then resumed cycle 56 under a new process with the improved seed and Experiment 2 native 512 resolution. No stop marker, extra inference workload, or generation-worker change was introduced.

The local CGL fitting renderer and the browser still share the Mac's GPU. These UI/server fixes do not establish how much GPU contention affects interaction. No browser performance trace, heap snapshot, visual QA or GPU benchmark was performed, and no claim of measured interactive speedup follows from these changes.
