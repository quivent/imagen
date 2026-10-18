# A guided autonomous pilot

## The light-touch cycle

Prepare the frozen package. In Controls, choose a pair limit, a review cadence and a short review focus. Press Start pilot when ready. The controller checks the existing worker, generates both sides of a pair serially, validates their originals and receipts, and brings the verified pair into this study's Stream and Compare.

The default is three pairs maximum, with a review after each pair. Choose Left, Right, Tie or Neither, add an optional note, then Save choice & continue. Save choice & pause keeps the result without authorizing another pair. Arms are revealed only after that pair's choice is saved. Other outstanding checkpoint reviews must be saved before continuation is available.

A three-pair review cadence can complete the six-image pilot without intermediate choices; the final review remains yours. The controller never invents an artistic preference. Review focus is recorded guidance, not a hidden model prompt. Changing either frozen caption is a separate study revision.

## Durable progress

Each package has an independent control journal, a runner lock and its own factory database. Guidance and review writes are atomic and serialized. Only one runner owns a package at a time, and repeated Start requests do not extend its run window. Work is bounded to at most three pairs, one generation at a time and a 20-minute window for starting images. An already submitted image can finish after that window; it is not killed and blindly regenerated.

The runner proceeds independently of the open tab. Reloading Imagen or leaving Controls does not cancel it. Pause before next image lets an in-flight image finish and then stops further submission. Normal tab changes do not change any queue or worker.

Each job ID is recorded before remote submission. A durable command receipt is written before image processing or pair publication. Every original is checked for SHA-256, PNG dimensions, exact prompt, seed, steps, guidance, conditioning limit, declared model revision, measured generation time and receipt precision evidence. Transformer BF16 and the worker's encoder quantization flag are checked; runtime/precision/source identity is pinned from the first receipt and must stay identical. Exact encoder dtype is limited by the fields the current worker reports; missing provenance is not invented.

## Read-only preflight

The existing worker must be reachable and ready. The controller never rents hardware, powers up a GPU, restarts a daemon, changes power limits or changes a model. A busy or loading worker is checked again within the run window. An unavailable endpoint or unexpected evidence stops for attention.

Token counts are measured from the local tokenizer files on the worker, without loading image-generation weights in another process. FLUX.1 uses CLIP with a 77-token path and T5 with the frozen 512-token limit. The native CLIP truncation policy is retained equally for both arms and its lengths are recorded; unexpected T5 truncation blocks the run. This qualifies the earlier specification's broad “untruncated” wording: the claim concerns the long conditioning path, not a fictional unlimited CLIP context.

Actual precision is checked again in generation receipts; a model file or profile name alone is not treated as proof of the loaded runtime. Cold first-image effects and any GPU contention remain part of the measured record. No unrecorded warm-up images are generated.

## Recovery without replay

Unknown submissions, missing receipts, corrupted originals, runtime drift or settings mismatches stop the controller. An expired or interrupted claim is not automatically retried.

Reconcile saved results reads existing local receipts, checks their exact job and original, and can finish local bookkeeping and pair import. It makes no model or remote generation request. If there is no durable receipt, the controller remains stopped and the existing native job ID must be investigated. Resume requires an explicit new Start or a saved review with continuation.

The R2 check is read-only and separate from inference. Existing uploader/index ownership is retained. The UI reports how many completed study jobs appear in the R2 index with the same hashes; local completion does not pretend to be archive confirmation. Archive observation runs in the background so an R2 outage does not freeze review. No second uploader is installed.

## Operator controls

- Pair limit: one, two or three paired seeds.
- Review every: one, two or three pairs.
- Light guidance: what to pay attention to in the review.
- Start pilot / Continue pilot: explicitly authorize bounded execution.
- Pause before next image: finish the in-flight image, then stop.
- Reconcile saved results: recover bookkeeping from existing verified receipts only.
- Save choice & pause / Save choice & continue: record a blind outcome and choose whether another pair may proceed.

The CLI controller exposes the same operations in `tools/artwork/study_controller.py`. The `advance` command is the execution worker and is launched only after Start or an explicit review-and-continue action. Its state lives beside the prepared package, under the ignored research runtime directory.

## Automatic pilot report

Once the configured pairs are reviewed, the controller writes a compact report beside the journal. It summarizes saved human preferences, ties/neither, measured generation times and paired time differences. It does not invent an artistic score or turn a small pilot into a general ranking. The report is rebuilt from durable pair/choice records and is shown in the app.

## Current verification

The controller has been tested with synthetic numerical image fixtures and receipts, including interruption, repeated Start, pause/resume, a second-runner lock, missing evidence, incorrect settings and runtime drift. These tests request no real images. The actual GPU pilot remains unstarted; deployed worker connectivity and receipt compatibility will be checked when execution is requested.
