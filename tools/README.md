# Imagen tools

| Tool | Purpose | Execution |
| --- | --- | --- |
| [Artwork research CLI](artwork/artwork.py) | Durable requests, fenced claims, immutable originals, provenance and review, using the factory core already in Imagen. | Python3.11+; isolated research state by default. |
| [Built-in artwork runner](artwork/builtin_runner.js) | Up to six concurrent new-image tool calls, heartbeat, receipt-first completion and deterministic asset processing. | Execute its contents inside Codex `functions.exec` from Imagen; not Node. |

The runner invokes the built-in image-generation tool only when explicitly run.
Importing these sources does not generate images, contact a provider, start
workers or modify the live production queue. The planned first use is
[Art Direction, Held Constant](../research/studies/art-direction-held-constant/PROTOCOL.md).
See [the portability audit](artwork/PORTABILITY.md) for what was brought over.
