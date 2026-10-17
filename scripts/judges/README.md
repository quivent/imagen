Pixtral, DINO and Gemma run on physical GPU0 beside FLUX1, under Supervisor. FLUX2 stays on GPU1. Model snapshots and the isolated inference environment live under `/workspace/artwork/judges` on the persistent volume.

Pixtral serves the existing `pixtral-critic` model name at `http://127.0.0.1:8002/v1`. Send ordinary OpenAI chat completions with an image data URI. The existing FLUX evaluator can use `MOJ_PIXTRAL_URL=http://127.0.0.1:8002/v1` or `PIXTRAL_CRITIC_URL` at the same address. The Beauty advisor accepts `BEAUTY_PIXTRAL_URL`.

Gemma serves `gemma4-12b-artist` at `http://127.0.0.1:8004/v1`, using `unsloth/gemma-4-12b-it-NVFP4` and Google's `gemma-4-12B-it-assistant` through vLLM's MTP path (three speculative tokens). Send OpenAI chat completions with one image data URI and text. For concise feedback, set `chat_template_kwargs` to `{"enable_thinking": false}`. The service has an 8192-token context, one concurrent sequence, and a 20% GPU memory budget. Audio and video are disabled for this artist feedback endpoint. These serving limits do not change the downloaded weights.

DINO serves `dinov2-giant` at `http://127.0.0.1:8003`:

- `GET /health`: readiness, model revision, GPU and embedding dimensions.
- `POST /v1/embeddings`: `{"model":"dinov2-giant","input":"data:image/png;base64,..."}`. Returns normalized CLS features. `input` can also contain a list of up to two image data URIs.
- `POST /v1/compare`: `{"image_a":"data:image/png;base64,...","image_b":"data:image/png;base64,..."}`. Returns cosine similarity and distance. These describe visual similarity, not artistic merit.

All inference requests are serialized per model. Bindings are loopback only. From the Mac, forward the endpoints over SSH:

```sh
ssh -N -p 11012 -L 8002:127.0.0.1:8002 -L 8003:127.0.0.1:8003 -L 8004:127.0.0.1:8004 root@184.186.104.194
```

For the original in-process `sensory_gates.py` integration, use `SENSORY_DINOV2_MODEL=/workspace/artwork/judges/models/dinov2` and `SENSORY_GATES_ALLOW_DOWNLOAD=0`. That full gate also requires its separately configured SigLIP companion; the DINO service alone does not provide SigLIP or the full gate.

Use immutable image content and retain its SHA256 alongside feedback. Keep feedback receipts separate from the original generation receipts. Provisioning these services does not automatically change prompts, judge existing images, or enable a feedback loop.

```sh
supervisorctl status artwork-pixtral artwork-dino artwork-gemma
supervisorctl restart artwork-pixtral
supervisorctl restart artwork-dino
supervisorctl restart artwork-gemma
```

Runtime versions are pinned in `/workspace/artwork/judges/runtime.lock.txt`; Pixtral/DINO weights and hashes are recorded in `download-receipt.json`, with Gemma and its drafter in `gemma4-download/download-receipt.json`. Setup verification is recorded in `setup-proof.json` and `gemma-setup-proof.json`. Verification uses model outputs and programmatically defined image fixtures; agents must not view artwork.

The Seers tab observes real image requests through `seer_observer.py`, attached to the two vLLM servers and the DINO app. It stores captured image bytes by SHA256 and pairs each review with its own inputs, prompt, timestamps and feedback under `seers/`. It preserves the original response, including streamed Pixtral/Gemma responses; nonvisual requests do not replace visual feedback. It does not schedule reviews or change generation prompts.

`seers_snapshot.py --watch` supplies fresh readiness and review observations over one private SSH connection shared by connected Seers viewers. `server/seers.mjs` serves `/api/seers/events` and hash-verified captured images. The browser subscribes only while Seers is visible; stale connections show unknown activity while retaining historical feedback. The three-model inference/capture proof is `seers-proof.json`.
