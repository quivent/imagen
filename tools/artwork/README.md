# Artwork research runner

The missing built-in runner was brought from `kinship-of-cancer`. Seven of its
supporting factory files were already present byte-for-byte in Imagen's captured
deployment core. We reuse those files rather than copy another factory tree.
The deployment CLI has one existing improvement over its sibling: it also
recognizes `ARTWORK_FACTORY_STATE`. The research wrapper deliberately supplies
its own isolated state and does not inherit that production setting.

## Local entry point

```sh
python3 -B tools/artwork/artwork.py --help
python3 -B tools/artwork/artwork.py status
```

The default state is `.runtime/artwork-research`, or `ARTWORK_RESEARCH_STATE`.
An explicit global `--state /path` overrides it. No production queue, originals,
tokens or live services were moved. The wrapper loads the existing
`deployment/controller/tools/artwork` modules. Python3.11+ is required; asset
completion also requires `cwebp` and `dwebp`. Python queue operations use the
standard library.

## Built-in orchestration

Run the contents of `builtin_runner.js` in the agent's `functions.exec` context
from the Imagen checkout. This is an execution step, not a Node command. It
claims up to six queued built-in requests. It keeps 30-second heartbeats and
saves a small receipt before completing the image into the version store.
It never prints base64 image data. The checkout is discovered at execution time.

This runner is for authorized new-image jobs. Reference/edit jobs are deferred;
the current instruction against agent image viewing remains in force. Reconcile
any claimed handoff and saved receipt before retrying interrupted work. Do not
blindly regenerate an uncertain job.

The built-in runner's tool-specific model remains `builtin`: exact hosted model
identity is not exposed by this interface. Record it as unknown when absent.
Requested dimensions are a prompt instruction in this tool; actual dimensions
must be validated. The factory rejects mismatched dimensions rather than
silently rescaling an original. Resolve any mismatch as a receipt/processing
case before requesting another generation.

## Verification without generation

```sh
python3 -m unittest discover -s tools/artwork/tests -p 'test_*.py'
```

The inherited suite uses temporary queues, synthetic image fixtures and mocked
provider requests. It does not invoke image generation or use the production
state. No additional HTTP service or legacy review desk is started by setup.

The linked study is a plan, not a queued batch:
[Art Direction, Held Constant](../../research/studies/art-direction-held-constant/PROTOCOL.md).

For a dedicated study, set functions.exec storage key `artwork-runner-state` to
an absolute study factory directory before running the source. That explicit
state is passed to every CLI operation. Without it, the wrapper default applies.

## FLUX.1 prompt-clarity study

`prompt_clarity.py preview` reads the frozen design without writing anything.
`prompt_clarity.py prepare` saves the paired package and command-adapter argument
file, with no queue, network request or generation. A separate explicit
`enqueue PACKAGE_HASH` operation targets only the run's isolated factory. No
command in this script starts inference; later execution uses the existing
bounded command worker. The preparation command never starts inference. Separate app controls can explicitly start the guided runner described below.

Read the [specification](../../research/studies/flux1-prompt-clarity/SPECIFICATION.md),
[implementation](../../research/studies/flux1-prompt-clarity/IMPLEMENTATION.md) and
[generation protocol](../../research/studies/flux1-prompt-clarity/GENERATION-PROTOCOL.md)
before executing anything. The built-in OpenAI runner above is a different
backend and must not claim the FLUX.1-only study jobs.

## Guided study controller

`study_controller.py` supplies durable status, guidance, start, pause, review,
local receipt reconciliation and bounded execution for a prepared package.
The app starts `advance` only after an explicit Start or review-and-continue
request. The controller calls the captured native FLUX adapter, never the
built-in OpenAI runner. A lock fences each package; validated receipts and
originals precede pair publication. No ambiguous job is retried automatically.
Read the Research autonomy protocol before live execution.
