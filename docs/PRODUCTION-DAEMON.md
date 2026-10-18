# Continuous production-prompt study

`tools/artwork/parity_daemon.py` is the **single authoritative scheduler** for the production/precision study, ADHC-001. Do not launch `production_flow.py`, a competing scheduler implementation, or a second uploader. Two GPU lanes use this same daemon implementation with separate lane roots and a shared reservation directory. The daemon reuses the existing native FLUX.1 worker and per-package controller. It does not rent hardware, alter precision, or start a replacement model server.

For each of the 150 preserved scenes, it generates the frozen baseline, then its saved precision revision, on one GPU with the same seed and explicit settings. Pass one uses seed 42, pass two 43, and so on. Each pair is an immutable package. A missing precision draft waits for its saved draft; it never substitutes a placeholder. Completed pairs remain available for review, but **review never stops the next scene**.

## Install and start

Run from the Imagen repository. Python 3, `ssh`, `cwebp`, `dwebp`, working SSH-key authentication, a loaded native worker, and the attached persistent model volume are prerequisites. Confirm the current SSH endpoint and the `/workspace` volume before starting. Keep authentication secrets out of commands and source files.

Configure only the nonsecret endpoint in your shell:

```sh
export ARTWORK_SSH_HOST='root@YOUR_WORKER_HOST'
export ARTWORK_SSH_PORT='YOUR_WORKER_SSH_PORT'
```

Install the launchd configuration with explicit identical pair settings:

```sh
python3 - <<'PY' | python3 -B tools/artwork/parity_daemon.py install
import json, os
print(json.dumps({
    'settings': {'width': 512, 'height': 512, 'steps': 28,
                 'guidance_scale': 3.5, 'max_sequence_length': 512},
    'sshHost': os.environ['ARTWORK_SSH_HOST'],
    'sshPort': os.environ['ARTWORK_SSH_PORT']
}))
PY
python3 -B tools/artwork/parity_daemon.py start
python3 -B tools/artwork/parity_daemon.py status
```

Installation writes configuration and a plist; it does not enable generation by itself. Start explicitly enables the daemon and loads `vision.influx.imagen.parity`. The plist source is `deployment/launchd/vision.influx.imagen.parity.plist.in`; its installed location is `~/Library/LaunchAgents/vision.influx.imagen.parity.plist`. `RunAtLoad` and `KeepAlive` are true.

## Operation and persistence

The scheduler runs independently of Imagen, Vite, and browser tabs. Closing or restarting the app does not stop generation. launchd restarts the process after failure and loads it after user login. The Mac must remain awake, logged in, and able to reach the worker; this is not a remote supervisor daemon.

```sh
python3 -B tools/artwork/parity_daemon.py status
launchctl list vision.influx.imagen.parity
python3 -B tools/artwork/parity_daemon.py pause
python3 -B tools/artwork/parity_daemon.py resume
```

Pause takes effect before the next image; an in-flight image finishes. A user pause persists across process and app restarts. Resume explicitly enables scheduling again. Avoid `launchctl kickstart -k`, stopping the native worker, or killing the scheduler while an image is running.

Status reports `enabled`, `runnerAlive`, `heartbeatAt`, `stage`, `currentPackage`, `sceneId`, `sceneIndex`, `pass`, `seed`, `completedPairs`, and `problem`. A live heartbeat alone does not prove image progress: check that completed pairs advance and the remote worker actually runs jobs. GPU utilization will briefly drop between images and during transfer/preflight.

Daemon configuration, cursor, and heartbeat live under `.runtime/research/production-parity-daemon/`; stdout/stderr are `daemon.log` and `daemon-error.log` there. Immutable packages, job journals, and generated originals remain under `.runtime/research/flux1-prompt-clarity/runs/`. The historical directory name is shared with older FPC packages; the package's `study` field distinguishes ADHC-001. Preserve both trees. No new R2 writer is created by this scheduler.

## Recovery without duplicate generations

Only one daemon process per lane can hold its scheduler lock. Cross-lane reservations prevent duplicate scene/seed ownership. Each package also has its existing controller lock. On restart, the saved scene/pass/seed cursor is reused. An already completed pair advances the cursor without regeneration, even if it has no review. A partial pair uses its already completed arm rather than generating it again.

Transient SSH/preflight failures retry automatically **only when the package has no submitted jobs**. Missing drafts also resume automatically when a saved draft appears. Unknown submitted jobs, ambiguous completion, identity drift, or processing failures with recorded jobs enter `needs-attention` with scheduling disabled. Keep the job IDs and existing files; do not delete journals or queue a replacement request.

Inspect the package recorded in daemon status:

```sh
python3 -B tools/artwork/study_controller.py status PACKAGE_ID
python3 -B tools/artwork/study_controller.py reconcile PACKAGE_ID
```

Reconciliation is local and does not generate another image. An interrupted image with no durable completion evidence must be checked against the worker before any retry. The daemon deliberately refuses resume while its own stage is `needs-attention`; an operator must first resolve the underlying request and then clear that attention state as part of an explicit recovery. There is no automatic force-reset command.

Normal startup does not require manual reconciliation, human review, or restarting the app. Keep maintenance and diagnostic details out of the normal generation flow.

## Two GPU lanes

The native GPU1 deployment is in `deployment/worker/second-flux1-gpu1/`. Its worker uses HTTP 18763 and a separate native socket/job root. It shares the existing volume models and unchanged source with GPU0. The single uploader discovers both roots under the normal `flux1-dev` archive profile.

For a fresh two-lane installation, supply `laneCount: 2`, `laneIndex: 0`, `workerPort: 18761`, `initialRange: [0, 75]` in GPU0's installation JSON. Supply `laneCount: 2`, `laneIndex: 1`, `workerPort: 18763`, `initialRange: [75, 150]` for GPU1, with the same settings and SSH endpoint. Install GPU1 using:

```sh
python3 -B tools/artwork/parity_daemon.py --root .runtime/research/production-parity-daemon-gpu1 install < /path/to/private-install-input.json
python3 -B tools/artwork/parity_daemon.py --root .runtime/research/production-parity-daemon-gpu1 start
python3 -B tools/artwork/parity_daemon.py --root .runtime/research/production-parity-daemon-gpu1 status
```

GPU1's launchd label is `vision.influx.imagen.parity.gpu1`. Its heartbeat, logs, enabled state, and cursor persist in its separate root. Both lanes use the same immutable study-package store and reservation records. First-pass ranges partition the corpus; later passes use disjoint alternating scene indices. Each lane keeps production then precision serially paired on its own GPU. Review remains optional and never gates either lane.

Do not reconfigure a live lane's endpoint or settings halfway through a pair. Existing in-flight work and reservations must be reconciled before changing lane partitioning. Never remove a reservation to make an uncertain job run again.

## Audited prompt revision rollout

The historical catalog and completed packages remain unchanged. `prompt_revisions.py` can select an independently approved assistant baseline/Qwen revision from `baselines-40.json` for the next package. The compiler verifies authors, source/baseline/revision hashes and actual tokenizer counts, records prompt revision metadata and preserves the original source. Unreviewed or rejected drafts are not selected. Unready scenes retain historical generation during the incremental transition; do not claim all 150 new revisions are complete.

An active package is loaded from its immutable saved data until both conditions finish, even if newer text or settings arrive. Reload changed scheduler source only at a checkpoint with no active package, while holding its state lock. Do not kill an in-flight image or delete a reservation. Shared Controls changes also wait for the next pair.
