# Deploy the Imagen studio to Vercel

Deploy this repository as a **new** Vercel project. The root `vercel.json` builds the existing Vite frontend and deploys `api/studio.mjs` as its HTTP/WebSocket connection bridge. It does not deploy GPU workers or launch local daemons.

## Public and studio navigation

Every entrypoint shows all studio tabs, including Compare, Controls, Tasks, Performance, Models, Seers and Worlds. Worlds presents the agreed image-to-world pipeline and marks the fitting integration as planned.

Use `?tab=gallery` to open Compare or `?tab=controls` to open Controls directly. Legacy `?studio=0` URLs and saved compact-navigation preferences no longer hide tabs. Existing server authentication still protects actions and private Controls state.

## Hosting boundary

```text
Browser → Vercel static studio + connection bridge
                    ↓ HTTPS / WebSocket
           existing studio backend
                    ↓ existing private connections
           FLUX workers / Seers / local daemons
```

`ARTWORK_STUDIO_ORIGIN` is the backend's HTTPS origin, defaulting to `https://artwork.influx.vision`. Set it in both Preview and Production if using a different backend. It contains no path or credentials. Leave that existing gateway route pointing to the backend; pointing the backend origin back at this Vercel frontend would create a proxy loop. A later custom-domain move needs a separate, stable backend hostname first.

The frontend uses same-origin URLs. The bridge forwards original cookies and streams, preserves authentication cookies, and sends the backend's expected Origin. It rejects browser writes and socket upgrades from foreign origins. It forwards no SSH keys, HF tokens or R2 credentials. Runtime records are fetched from the backend, never copied into the static bundle.

Vercel currently documents Node HTTP server exports with `ws` in its [WebSocket beta](https://vercel.com/docs/functions/websockets). This bridge uses that supported server shape. Connections must reconnect across function lifetimes and deployments; the studio's existing reconnect behavior remains in place. HTTP streaming uses the same bridge. The configured function duration is 300 seconds. Platform routing and actual deployed reconnection still require deployment verification.

The backend must remain running and reachable. This package moves frontend hosting; it does not make the Mac daemons, local archive or Vast services independent of their existing hosts.

## Deploy

1. In Vercel, import `quivent/imagen` into a new project, such as `imagen-studio`. Use the repository root and Node 24.x. The root configuration selects Vite, `npm run build` and `dist`.
2. Set `ARTWORK_STUDIO_ORIGIN` if needed. No model, SSH or storage secrets belong in this frontend project.
3. Deploy a Preview first. Check Stream/Compare, actual Seer state, live task delivery, reconnects, and an existing authenticated Controls session through `?tab=controls`. Do not generate test artwork.
4. Promote that project when satisfied. Leave the existing `artwork-comparison` project and its required API unchanged.

For CLI deployment from a separately linked new project:

```sh
npm ci
node --test tests/vercel-studio.test.mjs
npm run build
vercel link
vercel deploy
```

Choose the new studio project when linking. `.vercelignore` excludes private runtime records, local artwork, scripts and the separate GPU/API source bundle. The deployment includes frontend source, Vite's local plugin modules needed for the build, and the bridge; only the static output and traced bridge dependencies are served.

## Current deployment

Production: **https://imagen-studio-hazel.vercel.app**

Studio navigation: **https://imagen-studio-hazel.vercel.app/?studio=1**

Deployed on 2026-10-17 as the new `imagen-studio` project. The existing `artwork-comparison` project and domain routing were preserved. Public HTML, Seer JSON and event streaming, runtime task records, live WebSocket delivery and unauthenticated Controls rejection were checked through the deployed origin. No images were viewed and no artwork was generated. Browser visual verification remains unavailable in this environment.

See [the image-to-world protocol](IMAGE-TO-WORLD-PROTOCOL.md) and [backend redeployment source](../deployment/README.md) for their separate scopes.
