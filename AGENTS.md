# Imagen operating instructions

Read `docs/STARTUP-PROTOCOL.md` before changing the running system. Existing user instructions take priority.

- Generation MUST continue through the persistent production daemon. App closure, pending reviews, ratings, page changes and agent handoffs must never stop it. Honor an explicit user pause. Reconcile uncertain submissions by their existing ID; never blindly regenerate them.
- One authoritative study scheduler: `tools/artwork/parity_daemon.py`. Do not launch the older `production_flow.py` prototype or an additional production refiller against this study.
- Gallery is the public artwork display. Production is the active image-generation workflow. Workbench is image-to-world research. Controls must describe and operate the selected study and its actual runtime settings.
- Keep both GPUs useful when assigned to the active study; inspect live worker activity and completed-image deltas. Loaded memory or a running process is not proof of generation. Preserve requested models/settings and paired-condition parity.
- UI and Performance are continuing named roles. The daemon alone selects ongoing assignments from explicit ready tasks and available current sessions. The coordinator has no assignment discretion. Where runtime transport requires a root tool adapter, execute only the daemon’s exact journaled action, without reselection or approval. Retain mandates across handoffs and verify actual lifecycle activity. Record tasks in the existing task ledger/inbox.
- Keep the native Imagen app responsive. No Chrome. Use bounded result pages, retain unchanged image nodes, cancel hidden-panel requests and expose failed-panel retries. No dropdown selectors; use buttons and switches.
- Agents must not view images or screenshots. Numerical tests, metadata and hidden WebKit DOM/geometry checks are allowed; Jay judges artwork.
- Keep models and generated server originals on the verified persistent volume. Reuse the single R2 uploader/index writer. Never expose credentials or commit runtime records, model files or generated archives.
- Do not change the Vercel deployment unless explicitly requested. Preserve existing work and independently owned edits; avoid broad shared-file rewrites.
