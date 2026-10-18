# Imagen UI operating map

The local Imagen app is the working studio. The standalone Gallery is the display surface. Keep these roles explicit; changing a collection or study must never silently mix their images.

## Four workspaces

The workspace buttons stay in this order: **Gallery, Production, Workbench, Worlds**.

| Workspace | Purpose | Access |
| --- | --- | --- |
| Gallery | Display archived artwork, with collection and model filters | `/gallery/studio` inside Imagen; `/gallery` as a standalone page |
| Production | Operate the selected image-generation study and inspect its output | Stream, Compare and Controls share the selected Production study |
| Workbench | GLSL experiments, fitting controls and research | Experiments, Research, shared Stream/Compare, separate Workbench Controls/Tasks/Agents and model chat |
| Worlds | Standalone world display | `/worlds`; no study selector or inner tool navigation |

Gallery has no tool tabs or study selector. The native Gallery defaults to **Production → Precision**; the standalone Gallery defaults to **All artworks**. Both expose their collection choice explicitly. The standalone page loads the Gallery component alone, without the studio app or working navigation.

## Production studies

**Production → Precision** is the default selected study. **FLUX1 / FLUX2** remains an explicit alternative for the earlier model comparison. The selection persists independently from Workbench study selection.

For Production → Precision:

- **Controls** shows dispatch status, the current scene and generation controls. It contains no images.
- **Stream** shows arriving study pairs, newest first.
- **Compare** shows the same study's paired output and review choices. Review does not stop generation.

Use the study's current-scene observation in Controls. The first corpus scene is preparation information, not evidence of what is generating now. Unavailable observations must remain unavailable rather than borrowing another study's data.

The production corpus remains the original 150 scenes. Each pair uses its frozen baseline and precision revision, with explicit provenance separating historical prompts from audited assistant/Qwen revisions, with matching scene, seed and generation settings. Each GPU worker generates one image at a time and keeps a scene's two conditions together. Independent workers can process different scenes concurrently.

## Keep working tools accessible

Tool tabs occupy one horizontal row and expand to fill the available container. At the tested 1024 px desktop width, the full Production row fits without horizontal overflow. Narrower screens can scroll the single row. Do not wrap tools into a second row or hide active working tools.

Production contains Stream, Compare, Controls, Collections, Models, Seers, Prompts, Qwen, Pixtral, Tasks, Agents, Performance, Metrics, Daemons, Protocol and Rules. Monitor is removed from visible navigation; its observation backend remains operational. Worlds is top-level, not a Production tool.

Workbench keeps Experiments, Research, Stream, Compare, its own Controls/Tasks/Agents, and Qwen/Pixtral chat. Gallery remains a separate display workspace.

Prompts compares the substantive assistant baseline with the actual Qwen revision, exact highlighted differences and measured tokenizer counts. It labels historical text, pending Qwen drafts and independent approval explicitly. Qwen/Pixtral tabs send real text/code conversations to their loaded models, preserve separate local histories and provide Stop. They do not execute code or control production automatically.

The compact Production HUD remains visible across Production tools. Green requires fresh observed rendering; between-image work is amber, and stale/unavailable status is explicit. Average time is measured worker render time across the latest up to 40 images and excludes dispatch/upload. The pipeline shows saved prompts, FLUX and R2 observations rather than invented completion percentages.

Workspace and study selectors share a row when space permits and wrap on smaller windows. At 1024 × 768, the compact Production navigation places panel content at approximately 223 px from the top; previously it began at 384 px. This is a measured layout reference, not a universal viewport guarantee.

## UI ownership and verification

The persistent UI agent owns navigation, header layout and Gallery styling, and coordinates study styling with the performance owner. Assignment records describe responsibility; only current lifecycle evidence establishes whether an agent is actively running.

Verify navigation with numerical DOM checks in a hidden WKWebView: visible tab counts, row positions, selected study, route changes, Gallery separation and zero images in Controls. Do not view images or capture screenshots. Verify private working tools remain accessible after every navigation change. A local change does not imply a Vercel deployment.
