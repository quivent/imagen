# Artwork folder portability audit

## Decision

Bring the missing runner and expose the already captured portable core through
an isolated Imagen tools entry point. Leave the original folder and live state
in place. No sibling-repository files were edited.

## Portable core already present

`store.py`, `images.py`, `workers.py`, `service.py` and the three desk assets match
the sibling files byte-for-byte in `deployment/controller/tools/artwork`.
`artwork.py` differs only in Imagen's additional `ARTWORK_FACTORY_STATE` fallback.
Core local imports resolve within that captured directory. The original tests
were copied here with their import path adapted to it. `IMPORT-MANIFEST.json`
records source hashes, reuse and adaptations.

## Why the complete folder cannot simply move

| Coupling | Evidence | Consequence |
| --- | --- | --- |
| Factory state | `store.py` records absolute version directories and reference paths in SQLite; backups record their restore root. | Moving `.state` requires a separate reconciled data migration. |
| Existing Imagen consumers | `server/native-live.mjs`, `local-gallery.mjs`, `workstation-session.mjs`, `generation-steps.mjs` and several scripts still discover the sibling state. | Removing it would disrupt reads and control authentication. |
| Original native app | `macos/Sources/ArtworkStudio/StudioModel.swift` and `macos/README.md` target the existing service; build records the repository root. | A source move is not an installed-app migration. |
| Atlas synchronization | `macos/sync_site.py` imports `site/src/lib/experiences/atlas.js`, reads `docs/artwork/geographic-scenes.json` and validates `site/public` assets. | This belongs to the original website. |
| Publication | `publication/publish.py` stages the comparison frontend and its isolated Vercel project. | Preserve the user's instruction to leave that remote frontend untouched. |
| Service ownership | `service_control.py` owns `giving.kinship.artwork-desk`; remote adapters own model lanes and queue consumers. | Copying controllers and starting them could create conflicting ownership. |
| R2 and judges | Existing Imagen deployment and judge directories already carry these components. | Reuse the existing source and preserve the single R2 index writer. |

No operational JSON, credentials, queues, images, models, runtime environments,
node_modules, native build outputs or daemon installations were copied. No
working directory, worker endpoint or active state path was switched.
