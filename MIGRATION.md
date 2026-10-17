# Migration plan: replace the two-GPU generation instance

Prepared: 2026-10-17. This runbook is retained with the source. The replacement is now serving ordinary generation on both GPUs; current runtime details remain in private operational records.

Standing constraint: do not generate diagnostic, benchmark, smoke-test, or proof images. Verify the pipeline using already-authorized ordinary artwork only. Originals are retained locally and uploaded independently to R2; Stream must not wait for R2. The 500 W GPU limits are accepted and unchanged. Ordinary replacement timings observed during migration were approximately 2.9 seconds for FLUX.1 and 10 seconds for FLUX.2, with the existing settings.

## Objective and assumptions

Move the existing FLUX.1 and FLUX.2 generation lanes from the faulty rental to a replacement two-GPU instance. Preserve completed artwork, receipts, queued work, request identities, gallery history, and Controls behavior. Verify the replacement under the real workload before ending the old rental.

“Another 2x” is interpreted here as another instance with two GPUs. The replacement provider, GPU model, VRAM, SSH endpoint, storage arrangement, and price have not been supplied. Those details must be filled in before execution. This plan does not select or purchase an instance.

The setup below was established by reading the local runtime code and handoff documents. Their descriptions of the old machine are historical observations, not a fresh hardware inspection. Recheck live state at migration time.

## Current architecture and boundaries

| Component | Current location and role | Migration action |
| --- | --- | --- |
| Studio frontend | `/Users/jay/Imagen`, GitHub `quivent/imagen`, Vite | Keep on the Mac; verify after backend cutover. |
| Public ingress | Existing TLS relay and Mac reverse tunnel | Keep the existing route to the Mac. GPU replacement does not require a DNS move. |
| Runtime tooling | `/Users/jay/kinship-of-cancer/tools/artwork` | Keep on the Mac; update connection configuration and persistent service environments. |
| Native source | `~/FLUX` | Preserve the exact source used by the current worker. |
| Factory | Mac `tools/artwork/.state/`, including `queue.sqlite3` | Back up and retain job IDs, variants, originals, receipts, and review state. |
| GPU 0 | `flux1-dev`, native FLUX.1 BF16 | Recreate one resident serialized lane. |
| GPU 1 | `flux2-dev-nf4`, FLUX.2 BF16 with NF4 text encoder | Recreate one resident serialized lane. |
| Private worker APIs | Remote loopback ports `18761` and `18762`, reached over SSH | Retain private access and existing protocol. |
| Controls backend | Existing `artwork-comparison` Vercel project, restricted SSH bridge | Install bridge on replacement; update endpoint and pinned host key; redeploy. |
| R2 archive | Existing study prefix, immutable image/receipt objects, mutable index | Retain object keys and history; move uploader ownership. |

The public frontend repository is not a full backup of this system. Its `.gitignore` excludes artwork data, dependencies, build output, operational records, and runtime directories. Backend tooling also lives outside this repository.

The studio currently imports middleware from `../kinship-of-cancer/tools/artwork/control/`. A compatibility symlink at the old `tools/artwork/comparison` path points to `/Users/jay/Imagen`. Preserve both during this GPU move. Treat making the frontend independently portable as separate work.

## 1. Record the replacement and acceptance criteria

Before starting, record the following in a private operational note:

- Old and new provider instance IDs, SSH endpoints, and verified host fingerprints.
- GPU models, UUIDs, VRAM per GPU, driver version, CPU/RAM, and storage size/mount.
- Actual hourly compute price, storage charges, transfer charges, and termination behavior.
- Backup destination, migration owner, start time, and the maximum paid overlap window.
- A baseline prompt, settings, and agreed performance/cost acceptance criteria.

Acceptance requires both real model lanes to load and render concurrently without OOMs, device faults, or persistent hardware throttling. A successful SSH connection or a healthy empty worker is insufficient.

For comparison, the old handoff recorded roughly 7.77 seconds/image for FLUX.1 and 26.17 seconds/image for FLUX.2 under its study workload. These are historical measurements. Repeat the same workload on both hosts if the old machine is still usable; do not treat them as a guarantee for different hardware.

Observe warmed, already-authorized ordinary renders on each lane and concurrent ordinary work; do not create additional validation images. Record cold load separately, warm median and slowest render, completed images per hour, VRAM, power, temperatures, throttle reasons, and errors. Calculate cost per completed image using the actual rental rate and observed combined throughput; include idle/load time when assessing a short rental. Set the maximum acceptable cost before accepting the machine.

## 2. Inventory and back up before touching the old rental

Capture exact source revisions and local modifications in all three source locations: `Imagen`, the artwork backend repository, and `~/FLUX`. Preserve the old `native/source.json` hashes so rebuilding does not silently substitute a newer native worker.

Back up these independent state groups:

| State | Preserve |
| --- | --- |
| Mac factory | Entire artwork `.state/`, with a consistent SQLite backup; selected artwork and retained originals; job/variant identities and remote associations. |
| Mac studio | `data/`, `exclusions.json`, `winners.json`, and relevant task/operational records outside Git. Browser-only comparison observations require separate export if valuable. |
| Mac controls | Private `.state/control/` keys and token; winners/corrections journals in `.state/`; persistent service configuration. |
| Remote jobs | Entire `/workspace/artwork/jobs/`, including each profile's `control.json`, job specifications, PNGs, and receipts. |
| Remote native engine | `/workspace/artwork/native/` source, source manifest, `jobs.jsonl`, profiles, timings, and output. Exclude live Unix sockets from transfers. |
| Model cache | `/workspace/artwork/models/`, its completion manifest, and any referenced cache targets. Preserve pinned snapshots and symlink targets. |
| Remote Controls | `/workspace/artwork/control/`, especially `requests/` and its idempotency records. |
| Remote uploader | `/workspace/artwork/r2/` upload proofs, status, source provenance, configuration, and private credential material. |
| Environment | Installed package list, Python/CUDA/driver versions, supervisor definitions/wrappers, and relevant logs. |

Use the factory backup command rather than copying only an actively written SQLite database:

```sh
cd /Users/jay/kinship-of-cancer
python3 -B tools/artwork/artwork.py backup --help
# Run backup with the supported arguments; record the resulting directory.
```

Check the backup's coverage and separately copy anything it omits. Make a final consistent backup after draining. Verify counts, representative file reads, and SHA-256 hashes; keep the only recovery copy off the old rental. Store credentials in private files with restricted permissions, outside Git and public site paths.

If the faulty host is unreachable, inventory what is already verified on the Mac and R2. Mark remote-only or in-flight work unresolved. Do not assume the R2 index reconstructs queue journals, native state, or Controls request deduplication.

## 3. Stage the new host without sending production traffic

Keep old and new endpoint variables distinct. Do not change global defaults while the old adapters are active. Examples below use placeholders and must not be pasted unchanged:

```sh
export NEW_ARTWORK_SSH_HOST='root@NEW_HOST'
export NEW_ARTWORK_SSH_PORT='NEW_PORT'

ssh -o StrictHostKeyChecking=yes -p "$NEW_ARTWORK_SSH_PORT" \
  "$NEW_ARTWORK_SSH_HOST" 'nvidia-smi; df -h /workspace; findmnt /workspace'
```

Verify the SSH fingerprint through the provider console or another trusted channel before recording it in `known_hosts`. A scanned key alone does not authenticate the new machine. Never disable host-key checking to get the migration through.

Check that `/workspace` is the intended persistent volume, with enough free space for weights, caches, outputs, and transfer staging. The documented selected weights alone total approximately 114 GB decimal. Size the volume from actual usage plus headroom; two GPUs do not combine their VRAM for these independent lanes.

Confirm both GPU UUIDs and device ordering. Run a basic CUDA allocation/compute check on each, inspect hardware error and throttling reports, and sample both under load. Reject a replacement that repeats persistent external HW Power Brake or device faults; do not attempt power-limit or driver workarounds as part of this move.

The installer assumes Linux, `uv`, a suitable Python interpreter, Supervisor, `/opt/supervisor-scripts`, and `/var/log/portal`. Provision those prerequisites or adapt the service installer before running it. A different provider image may not have them.

## 4. Recreate the runtime and models

Rebuild virtual environments on the new machine; do not transplant a venv across hosts. Capture and reuse the old environment's actual resolved versions, including requirements that are currently unpinned.

The recorded Blackwell environment used PyTorch `2.14.1+cu130`, torchvision `0.29.1+cu130`, and the pinned remote requirements. Treat those as the existing environment to reproduce after checking the new hardware/driver compatibility. A different architecture or older driver may require a deliberate environment change and a fresh baseline.

For a compatible image, the existing installation recipe is:

```sh
# On the replacement, after checking the base interpreter exists:
uv venv --python /venv/main/bin/python /workspace/artwork/.venv
uv pip install --python /workspace/artwork/.venv/bin/python \
  torch==2.14.1 torchvision==0.29.1 \
  --index-url https://download.pytorch.org/whl/cu130
# Transfer the reviewed requirements.txt first, then install it into this venv.
```

Transfer model files using a resumable copy, or run the existing pinned downloader with authorized model access. Preserve complete snapshot structure and dereference or transfer any symlink targets outside the copied directory. Verify the source manifest and sizes; verify transfer hashes for copied weights. The current downloader's size check is not an independent full-content hash audit.

Install the HF token through private SSH stdin into its scoped mode-0600 file only if download access is needed. Generation should remain offline once models are complete.

Run installation against the replacement explicitly from the Mac:

```sh
cd /Users/jay/kinship-of-cancer
ARTWORK_SSH_HOST="$NEW_ARTWORK_SSH_HOST" \
ARTWORK_SSH_PORT="$NEW_ARTWORK_SSH_PORT" \
python3 -B tools/artwork/remote/manage.py install
```

The installer snapshots `~/FLUX` by default; use `ARTWORK_FLUX_SOURCE` to select the preserved exact source if necessary. It refuses to overwrite running services. If a model manifest already exists, Supervisor installation can autostart inference services. Therefore stage code before restoring production job journals, then ensure the workers are stopped before the final state copy. Do not let restored queued jobs begin during preparation.

If using downloads, run `manage.py download` with the same explicit endpoint overrides and wait for a successful completion manifest. Record source hashes and installed package versions on the replacement.

## 5. Freeze submissions and drain the old host

This is the production interruption window. Keep the public gallery available, but stop every path that can create or dispatch generation work.

1. Hold automatic generation recovery/correction paths and any agent-watch behavior that could restart adapters or refill. Record how to release that maintenance hold.
2. Prevent new Controls submissions at the backend while preserving read access where possible. A UI notice alone is not a submission lock. If no maintenance gate exists, implement one or temporarily disable its submission route before proceeding.
3. Stop the bounded Mac refiller:

   ```sh
   cd /Users/jay/kinship-of-cancer
   python3 -B tools/artwork/remote/refill.py stop
   ```

4. Prefer draining already dispatched work: let active renders, remote queued jobs, and their Mac transfers finish. Watch the bounded factory backlog until both lanes and adapter slots are idle. Stop all four adapters using `factory_worker.py stop` once they have finished.
5. Pause both remote lanes through their existing `/control` API to prevent further execution. Pausing finishes the current render and leaves queued work waiting. Check both `/health` and `/jobs`, not only a dated status file.
6. If a full drain is too slow or the hardware fails, stop dispatch, pause the workers, and explicitly classify every remaining factory/remote job. Preserve IDs and receipt evidence. Stopping adapters mid-request can leave an ambiguous local lease; resolve it before redispatching.
7. Let the old R2 uploader finish verified completions. Record coverage and immutable object proofs. Stop `artwork-r2` before the replacement uploader becomes the index writer.
8. Gracefully stop the idle `artwork-flux1`, `artwork-flux2`, and `artwork-native-flux1` Supervisor services. Take the final state snapshot and transfer the delta.

Do not reset queues or label interrupted jobs complete. A factory job ID is the remote idempotency key. Preserve the same ID with the same spec during reconciliation. Failed or uncertain jobs remain explicit; intentional new renders get new variants.

## 6. Restore durable state before production start

Restore the final remote job directories, native journals/output, Controls request ledger, and uploader proofs into the same absolute `/workspace/artwork` layout. Keep workers stopped while doing so. Do not copy process locks, PIDs, live sockets, or virtual environments as operational state.

Reconcile job counts by profile and state against the final inventory. Hash every migrated image against its receipt and preserve orphan files for investigation. The worker recovers a `running` record with a valid image/receipt as completed; without that evidence it marks it `uncertain`. Never rewrite an uncertain job to queued just to make it run.

Retain paused control state during restoration. Confirm the installation has not overwritten identity/provenance records. Take a pre-start destination snapshot so recovery behavior can be audited.

Install the restricted Controls bridge and R2 uploader, but keep production submissions blocked and keep the uploader stopped until index ownership has transferred. The R2 installer autostarts its Supervisor program, so run it only after the old uploader is stopped. Preserve the existing study prefix and archived job IDs.

## 7. Update every endpoint consumer

| Consumer | Required change |
| --- | --- |
| `remote/manage.py`, `remote/adapter.py`, `r2/manage.py` | Use the replacement `ARTWORK_SSH_HOST` and `ARTWORK_SSH_PORT`; remove dependence on stale defaults. |
| Four Mac factory adapters | Stop and recreate launch agents with replacement environment values. `start` leaves already-loaded agents untouched; changing a terminal export does not update them. |
| `control/studio_monitor.py` | Supply replacement SSH variables in the actual Vite service environment, since the collector inherits it. Verify fresh observations reach the new host. |
| `control/setup.py` | Change/refactor its hardcoded `HOST`, `PORT`, and `HOST_KEY`. It currently ignores the worker tools' SSH overrides. |
| Vercel production backend | Update `ARTWORK_SSH_HOST`, `ARTWORK_SSH_PORT`, and `ARTWORK_SSH_HOST_SHA256`; ensure the authorized restricted SSH key is installed on the replacement. Redeploy so new environment values are active. |
| Recovery helpers and one-off tools | Check inherited environments and stale host defaults before allowing automatic generation recovery again. |

The Vercel host value is a hostname; the worker tools conventionally use `root@hostname`. Do not blindly reuse the same string. The current setup computes `ARTWORK_SSH_HOST_SHA256` as the hexadecimal SHA-256 of the decoded public-key blob; do not paste an OpenSSH display fingerprint into it without checking the backend verifier's expected format.

Retain the existing Controls access token and SSH identity unless rotation is intentional. Transfer only the required restricted public-key authorization to the new host; do not copy the old host's entire `authorized_keys`. Never copy the old server's SSH host private keys to impersonate it.

Run the updated setup syntax check, install the bridge, privately configure Vercel, redeploy the existing API project, and run its restricted `probe`. These are future migration actions; writing this plan has not changed them.

## 8. Verify before reopening the queue

Start native FLUX.1 first, then its facade and FLUX.2. Check both workers are ready, correctly assigned to separate GPUs, and still paused until controlled tests begin.

Use ordinary authorized jobs and preserve their receipts. Observe each lane with the exact same prompt and settings as the baseline: 512 × 512, 28 steps, seed 42, token limit 512, and the recorded study guidance 3.5. The general Controls model defaults differ, so set guidance explicitly. Do not reduce steps, precision, or resolution to improve the comparison.

Using ordinary production work, validate the full path:

- Authenticated Controls state reaches the replacement; unauthorized actions remain rejected.
- Observe a real authorized request through the API and confirm one execution per request ID. Replaying it must return the existing request, not render duplicates.
- Both models render concurrently on distinct GPUs and produce valid, complete PNGs with matching SHA-256 receipts.
- The Mac adapter retrieves an original, verifies its hash, writes `generation.json`, and records a pending factory version.
- The single replacement R2 uploader verifies image/receipt objects and updates the existing index without losing old entries.
- Stream displays the new completion; Compare and Winners retain existing history; Controls pause/resume works; Monitor reports fresh replacement-worker observations.
- Browser image caching and old links still work. Existing originals and selected artwork remain intact.
- The warmed performance and concurrent soak checks from section 1 pass, including hardware error/throttle inspection.

Run `remote/manage.py check` against the replacement after both lanes have completed ordinary authorized generations. Its check requires ready workers and completed records; record the new ordinary job IDs separately so restored historical completions cannot stand in for new-host activity.

## 9. Cut over and observe

1. Confirm all production endpoint consumers select the replacement and the old worker services remain stopped.
2. Recreate the four Mac adapters with explicit replacement environment values; inspect the loaded launchd configuration to confirm them.
3. Unpause the replacement lanes and restore backend submissions. Release maintenance recovery holds only after they target the replacement.
4. Start the bounded refiller last. Confirm up to three outstanding factory jobs per model and one serialized render per GPU. Existing larger backlogs are not silently deleted.
5. Observe several ordinary completions from each lane through factory, R2, API, and Stream. Check for duplicate submissions, stale gallery frames, transfer failures, and growing queue age.
6. Record the exact cutover time, replacement instance ID, deployed API version, source/environment versions, baseline results, and archive coverage in the private handoff.

Keep the paid overlap bounded by the window recorded before migration. If validation is taking too long, stop new work and choose rollback or a deliberate outage rather than leaving two rentals running indefinitely.

## 10. Rollback

Before production cutover, abandon the new endpoint and resume the old setup only if its hardware remains usable. Keep the gallery available if generation must remain offline.

After the replacement has accepted work, first freeze Controls/refill and pause/drain it. Preserve all new jobs, receipts, original files, and Controls request IDs. Reconcile those records back to the rollback target before switching producers; otherwise a previously accepted request may execute twice or disappear.

Restore the old adapter/service environments, Vercel endpoint and host-key pin, and Monitor target together. Deploy the API configuration and verify both lanes before reopening submissions. Keep exactly one active uploader for the study index. Do not run both old and new factory dispatch paths concurrently against shared work.

If the old hardware is unsafe or unavailable, rollback means maintaining a truthful generation outage with the verified archive intact, not restarting faulty hardware or marking unresolved jobs done.

## 11. Retire the faulty rental and confirm billing

Once acceptance passes and the off-instance backup is verified:

- Confirm every old completed image and receipt is preserved off-host and reconcile any remote-only or uncertain jobs.
- Confirm no loaded service, deployed environment, or recovery tool still targets the old endpoint.
- Stop the old uploader and workers; remove obsolete restricted bridge authorization and old private runtime credentials where appropriate.
- End the old provider rental using its actual lifecycle controls. Stopping Python, Supervisor, Mac adapters, or refill does not stop rental billing.
- Check whether persistent volumes, snapshots, reserved addresses, or other resources continue billing; retain only the explicitly chosen backup resources.
- Record provider confirmation and termination time, plus any retained-storage charges.

The migration is complete when the replacement passes the workload/cost checks, both lanes run through the full application path, archived work remains accessible, ambiguous jobs are accounted for, and the old compute rental is confirmed ended.

## Source references

This plan was grounded in the current local files below; re-read implementations if they change before execution:

- `vite.config.js` and `.gitignore` in this repository.
- `../kinship-of-cancer/docs/artwork/STUDIO-HANDOFF.md`.
- `../kinship-of-cancer/tools/artwork/remote/README.md`, `manage.py`, `worker.py`, `native.py`, `factory_worker.py`, `adapter.py`, `refill.py`, and `requirements.txt`.
- `../kinship-of-cancer/tools/artwork/control/setup.py`, `bridge.py`, `studio_monitor.py`, and `corrections.py`.
- `../kinship-of-cancer/tools/artwork/r2/README.md` and `manage.py`.
