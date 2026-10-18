# Imagen desktop baseline

This is a stripped copy of the Tauri shell in `~/Trinity/cartography`. It runs
Imagen's existing Vite interface in macOS WKWebView. The original SwiftUI app
at `~/kinship-of-cancer/tools/artwork/macos` and the installed Artwork Studio
are untouched. Its initial window dimensions are reused here; Imagen has its
own generated landscape-and-frame icon.

## Run locally

From Imagen:

```sh
npm --prefix desktop ci
# Keep the existing studio service running; start it only if needed:
npm run dev
# In another terminal:
npm run desktop:dev
```

The desktop window opens `/workbench` on `127.0.0.1:48624`. All current tabs,
local APIs, live events, histories and Vite hot updates use that same service.
The preflight checks that it is Imagen before starting. Opening or closing the
desktop does not start or stop fitting, generation, or service daemons.

Imagen is now the working interface. The signed build is installed at
`~/Applications/Imagen.app`; open it with `open ~/Applications/Imagen.app`.
Use this app for ongoing experiments and verification instead of opening Chrome.
The loopback service remains its implementation detail, not a separate browser
workspace. The frontend remains Vite and continues to receive live updates.

`npm run desktop:build` builds `Imagen.app` under
`desktop/src-tauri/target/release/bundle/macos/`. Its distinct bundle identifier
is `vision.influx.imagen`; nothing installs over the original.
**This initial app requires the local Imagen service, including after a build.**
It is a connected native client, not a standalone distribution. No remote URL,
Vercel deployment, GPU worker or model is bundled.

## What was stripped

Trinity's command modules, scanners, filesystem watchers, shell plugin,
application state and project dependencies were removed. The Rust host exposes
no commands or IPC capabilities. Source locations and copied-file hashes are
recorded in `BASELINE.json`. Generated Cargo/build output stays ignored.

The master icon is `assets/imagen-icon.png`. Its built-in image-generation
prompt is saved in `assets/imagen-icon.provenance.json`. Run
`npm --prefix desktop run icon` on macOS to regenerate the `.icns` and embedded
PNG representations, then rebuild the app. The copied original `Studio.icns`
is retained as baseline history and is no longer selected.

## Renderer integration

This gets the interface off Chrome without rewriting it. The embedded viewer
still renders through WebGL in WKWebView. **Tauri alone does not turn it into a
native GPU renderer.** No shader or fitting objective changes are included.

The next boundary is a native rendering surface owned by Rust, with the Vite
interface sending camera and parameter changes. Preserve the pure GLSL scene,
source/recipe identities and arrival/translated-view validation when choosing
the native execution path. Metal or wgpu would require a deliberate GLSL
translation/compilation path; an existing OpenGL path has macOS API limits.
Do not silently replace scene logic or lower rendering quality to fit a host.

After that, extract the required local APIs from the Vite plugin lifecycle or
package a supervised service before claiming a standalone app. Native rendering
and standalone service packaging are separate from this working UI shell.

## Checks

```sh
npm --prefix desktop run check
node desktop/scripts/check-studio.mjs
```

The baseline does not establish a memory or latency improvement. Those require
measurements in the native application under matched work. No image viewing is
required to compile or verify service identity.

Initial verification: optimized macOS app build and strict signature verification
pass. The generated `Imagen.app` with its custom icon is about 7.25 MiB. Service identity and four
studio/Workbench route tests pass. No app window was opened or visually inspected;
keyboard behavior, downloads and WebKit rendering still need interactive checks.
