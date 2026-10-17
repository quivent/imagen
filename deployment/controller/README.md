# Mac controller source closure

This tree preserves the source used by the Mac factory, its four model-specific command adapters, bounded queue refiller, reverse SSH tunnel, and legacy agent observer. It keeps `tools/artwork/` and `docs/artwork/` relative paths so the existing factory resolves imports and scene configuration. `SOURCE-MANIFEST.json` records upstream and captured SHA-256 values; changed hashes identify sanitization. The scene catalog contains source prompts only; no generated paths, asset records, or review evidence were copied.

The primary studio and current inbox, Enforcer, Performance, and lifecycle collector already live at the checkout root (`serve.py`, `server/`, `scripts/`). Their captured service templates are in `../launchd/`. They are not duplicated here. Control middleware and remote/GPU/R2 runtime capture are maintained separately under `deployment/`.

## Generation defaults

The continuous refiller submits FLUX.1 at 512×512 and FLUX.2 at 1024×1024, following Jay’s resolution increase on 2026-10-17. Both retain 28 steps, guidance 3.5 and their existing per-pass seed policy. Accepted jobs retain their submitted settings. The live refiller uses this repository’s source and the existing private factory database.

## Prerequisites and configuration

Use macOS with user launchd, Python 3.11+ (the active installation uses 3.14), Node 22.12+, npm, OpenSSH, `cwebp`, and `dwebp`. Run `npm ci` at the checkout root. Python controller code uses only the standard library. SSH requires credentials and pinned known-host entries supplied outside Git. The GPU host must already have its remote workers deployed; capturing these sources starts no inference.

Set `FACTORY_ROOT` to the absolute `deployment/controller/tools/artwork` directory and `FACTORY_REPO` to `deployment/controller`. Factory state is generated beneath `FACTORY_ROOT/.state`; never commit it. To reuse an existing database, migrate it separately while services are stopped and confirm stored absolute paths; this tree contains no database or images. A fresh queue is initialized with `python3 "$FACTORY_ROOT/artwork.py" status`.

The frontend local-gallery helper currently requires `ARTWORK_FACTORY_STATE="$FACTORY_ROOT/.state"`. The native-live authentication bridge requires `ARTWORK_CONTROL_TOKEN_FILE` pointing to a separately provisioned private token file. Neither value contains a token. The studio launcher reads `.runtime/service-env.json` and forwards SSH/API/thread values plus `ARTWORK_FACTORY_ROOT`, `ARTWORK_FACTORY_STATE`, `ARTWORK_CONTROL_TOKEN_FILE`, and `ARTWORK_PYTHON`. The same factory-state path must be supplied to all adapter/refiller/studio services. Adapter source requires an explicit current SSH endpoint; retired defaults were removed.

## Launchd templates

`../launchd/*.plist.in` are sanitized snapshots of the eleven loaded services. Render placeholders before loading; do not bootstrap template files directly. Supply absolute `CHECKOUT`, `FACTORY_ROOT`, `FACTORY_REPO`, `PYTHON`, `NODE`, `FACTORY_STATE`, `CONTROL_TOKEN_FILE`, and `CODEX` paths, the current `ROOT_THREAD`, explicit `ARTWORK_SSH_HOST`/`ARTWORK_SSH_PORT`, `GATEWAY`, and a suitable executable `PATH`. Set non-template runtime environment values separately as needed. The old shared `giving.kinship.artwork-flux` service was not loaded and is deliberately excluded.

Before starting the four adapter templates, generate their command file privately:

```sh
python3 - "$FACTORY_ROOT" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
import os
state = pathlib.Path(os.environ.get('ARTWORK_FACTORY_STATE', str(root / '.state'))) / 'flux-comparison'
state.mkdir(parents=True, exist_ok=True)
(state / 'argv.json').write_text(json.dumps([sys.executable, str(root / 'remote/adapter.py')]) + '\n')
PY
```

Create directories named by each rendered template's `StandardOutPath` and `StandardErrorPath`. Write private rendered plists outside Git, then use `launchctl bootstrap "gui/$(id -u)" /absolute/private/service.plist`. Start the studio and tunnel, then the four adapter services, and the bounded refiller last. The original `remote/factory_worker.py start` and `remote/refill.py start` installers remain captured, but rendered templates provide explicit deployment values. Stopping services or queue migration requires the operator to account for active jobs; never discard leases or resubmit uncertain jobs.

Start current inbox/Enforcer/Performance only after their database and current Codex coordinator thread are configured; their supported installers are the scripts at the checkout root. Current lifecycle observation depends on the local signed-in Codex installation (`~/.codex` sessions/database); it cannot manufacture agent status on an unrelated machine.

## Legacy observer

`giving.kinship.artwork-agent-watch` was running during capture, so its source and template are preserved. It is a historical observer for a different fixed three-agent team and expects `.tracker/status.json` and `.tracker/runtime/claims.json` under `FACTORY_REPO`. Its historical thread ID was removed. It is **not** a default service for the current team. Before any explicit activation, configure a current authorized thread/team, provide tracker state separately, and create `agent-watch/config.json` from its example. Current dispatch enforcement uses the root inbox/Enforcer services instead.

Verify loaded services with `launchctl print`, verify loopback and public HTTPS, and inspect `/api/studio-monitor` for fresh source observations. Agent running/done state must continue to come from lifecycle events; service configuration is only intended work. No service was restarted by this source capture.
