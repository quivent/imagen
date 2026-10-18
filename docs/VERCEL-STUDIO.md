# Deploy the Imagen studio to Vercel

Deploy this repository as a **new** Vercel project. The root `vercel.json` builds the existing Vite frontend and deploys `api/studio.mjs` as its HTTP/WebSocket connection bridge. It does not deploy GPU workers or launch local daemons.

## Public and studio navigation

Click the Imagen mark in the header, or press **⌘K / Ctrl K**, to open the studio switcher. Choose **Working studio** for every workflow tab, or **Public view** for the presentation. Vercel remembers that choice for the browser tab's session; no URL parameter is required. The local working studio and `artwork.influx.vision` start with every workflow tab visible.

The Vercel public view hides Controls, Tasks, Performance, Metrics, Agents, Daemons and Monitor. The other tabs remain visible. Compare also hides generation settings, run buttons and authenticated rating actions in public view, so it never directs visitors to the hidden Controls tab. These tools remain available in the working studio. Explicit `?studio=1` and `?studio=0` links remain compatible, and are cleaned from the URL when the switcher is used. Existing authentication continues to protect actions and private Controls state.

On the Mac, a same-origin localhost request can establish the existing signed Controls session from the private local token file. The token stays server-side. This route requires a loopback client, a loopback Host and an exactly matching Origin; public gateway and Vercel requests cannot use it.

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

The studio polls the authenticated gallery API for the R2 index every 10 seconds, retaining its last verified collection on failure and pushing changed records over the shared WebSocket. New archive objects appear once the single uploader has added them to that index. The API has its own short index cache, so visibility follows the next successful refresh rather than a fixed delivery deadline. Local worker arrivals continue to appear independently.

The backend must remain running and reachable. This package moves frontend hosting; it does not make the Mac daemons, local archive or Vast services independent of their existing hosts.

## Deploy

1. In Vercel, import `quivent/imagen` into a new project, such as `imagen-studio`. Use the repository root and Node 24.x. The root configuration selects Vite, `npm run build` and `dist`.
2. Set `ARTWORK_STUDIO_ORIGIN` if needed. No model, SSH or storage secrets belong in this frontend project.
3. Deploy a Preview first. Check Stream/Compare, actual Seer state, live task delivery, reconnects, and an existing authenticated Controls session through `/controls`. Do not generate test artwork.
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


### Main studio routes

Every main tab has a native app route: `/stream`, `/compare`, `/controls`, `/tasks`, `/performance`, `/models`, `/seers`, `/worlds`, `/workbench`, `/metrics`, `/winners`, `/agents`, `/daemons`, `/rules`, `/protocol` and `/monitor`. The route map and URL helpers live in `src/studio-route.js`. Early boot recognizes these paths before the app mounts. Existing visibility and authentication still govern access to each panel.

Legacy `?tab=` links, `/metrics.html` and `/monitor.html` canonicalize to the corresponding route locally. Comparison IDs remain query state on `/compare`; Workbench uses readable experiment/method/page parameters. Local middleware explicitly serves the main Vite index for canonical paths, preventing HTML extension fallback from treating `/metrics` or `/monitor` as legacy redirect files. Asset/API routes and `/worlds/draa-valley/` continue using their own handlers. Vercel's configuration includes equivalent index rewrites for a future deployment; these changes have only been run locally.

### Gallery-only entry (local, ready for a future deployment)

`/gallery` serves `gallery.html`, a separate Vite entry that imports only the archive gallery component, styles and image cache. It contains no studio navigation, access switcher, model controls, tasks, agents or research UI. It reads the existing public, read-only `/api/gallery` pages and hash-addressed artwork URLs; R2 credentials remain server-side. The third top-level Gallery area in the native app reuses this same component through `/gallery/studio`.

The gallery uses 24 works per page, model filter buttons and stable archive cursors. Latest refreshes every 15 seconds while visible; earlier pages keep their place. Unchanged image nodes are reused. Original files are shown without cropping, and a click opens the original in a gallery viewer. There is no eager whole-archive preload.

The build emits `dist/gallery.html`. Vercel rewrite configuration is prepared for `/gallery`, but no remote deployment, domain change or root-route replacement has been performed. To serve only the gallery as a site's home in a later deployment, point the chosen deployment's `/` entry to `gallery.html` while retaining the existing read-only artwork API. That routing choice is separate from the working studio and leaves the legacy API/frontend project untouched.
