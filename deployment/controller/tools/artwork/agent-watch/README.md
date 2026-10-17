# Agent capacity observer

```sh
python3 -B tools/artwork/agent-watch/manage.py start
python3 -B tools/artwork/agent-watch/manage.py status
python3 -B tools/artwork/agent-watch/manage.py stop
```

The owned user launchd service is `giving.kinship.artwork-agent-watch`. It checks
every ten seconds and restarts if its process exits. Its private runtime files,
offset cache, pending wake and short lifecycle log live in ignored `.runtime/`.
It does not create a Codex daemon or an agent.

The source is the existing studio reader of this root's actual lifecycle events,
with a separate offset cache. The exact three known children are required. The
root is reported separately from capacity: three worker slots, running workers,
and available workers are separate fields. Unknown source states never count as
idle. Old file age is not used to pretend a worker is running.

A wake requires actual available capacity **and** fresh active artwork claims
for existing work. Persistent `config.json` records the current **wrap-up**
instruction: help work already in progress and finish its handoff, never select
queued tasks or start another feature. The observer's own claim and the
coordinator's personal render investigation (KOC-376/KOC-415) are excluded.
The only destination is the pinned existing coordinator, through supported
`codex queue`. It coordinates with existing claim owners and assigns only idle
known children. It forbids busywork, interruptions, new agents/daemons, GPU
changes, and delegating the personal render investigation.

An accepted wake stays pending until acknowledged explicitly, until a new root
lifecycle transition, or until all workers are running. The same capacity/work
signature stays suppressed after acknowledgment. There is a 60-second cooldown,
capped failure backoff, and no blind replay of an ambiguous command. A new root
turn gets 30 seconds to coordinate before the observer considers a wake.
No active work eligible for help produces `no-in-progress-artwork-to-help`,
rather than prompts to pick up queued work.

```sh
python3 -B tools/artwork/agent-watch/manage.py ack --wake-id EXISTING_WAKE_UUID
python3 -B tools/artwork/agent-watch/manage.py hold --seconds 900
python3 -B tools/artwork/agent-watch/manage.py clear-hold
```

The hold records intentional idle without changing actual observed counts.
`verify-queue` is an explicit one-time operational acceptance check that really
queues the coordinator; coordinate it before running. It is never invoked by
the daemon loop and never assigns work itself.
