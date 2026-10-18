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
