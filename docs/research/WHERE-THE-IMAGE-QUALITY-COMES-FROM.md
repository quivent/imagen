# Where the Image Quality Comes From

Research note · Hypothesis · 18 October 2026

Question: why can the built-in OpenAI image workflow produce results that Jay
prefers to our self-hosted FLUX outputs, and how much of the difference belongs
to art direction rather than the generator itself?

This is a potential explanation, not an established ranking. No controlled
comparison has yet separated these effects. Agent visual judgments are not
evidence here: Jay evaluates the artwork, and agents do not view the images.

## A generation is a workflow

What reaches the generator is often much more specific than the original
request. For Imagen's icon, the request became a brief about a landscape emerging
from a geometric frame, with a restrained palette, tactile materials, a strong
small-size silhouette and explicit exclusions. The saved prompt is in
`desktop/assets/imagen-icon.provenance.json`.

That art direction is a real input to quality. A model receiving a deliberate
brief and a model receiving a short subject description are doing different
tasks. A pleasing result cannot be attributed entirely to model capability
without controlling the prompt and evaluation conditions.

## Three possible contributors

- Art direction: translating intent into composition, lighting, materials,
  spatial relationships and clear constraints may improve either generator.
- Generator capability: learned visual knowledge, instruction following and
  aesthetic tendencies may account for a remaining difference. This is plausible,
  but our observations do not identify its size or internal cause.
- Workflow and settings: resolution, conditioning limits, sampling settings,
  precision, references, editing and candidate selection may change the result.
  Compare actual recorded settings, not profile labels alone.

OpenAI documents automatic prompt revision for its Responses image-generation
workflow, and describes instruction following and world knowledge in its image
model guidance. Those are documented capabilities, not proof that the opaque
built-in tool follows an identical internal sequence or exposes a particular
model revision. We do not know all of that tool's internal processing.

## What our pipeline optimization actually changed

The existing `kinship-of-cancer/tools/artwork/builtin_runner.js` orchestrates
up to six built-in generation calls concurrently, maintains 30-second claim
heartbeats, saves small completion receipts before conversion and then stores
the source and derived assets through the durable factory.

Those changes improve throughput and recovery. They do not upgrade model
weights or demonstrate an artistic-quality gain. A faster batch, a safer receipt
and a better image are distinct outcomes. Preserve originals so asset conversion
does not become an unnoticed quality confound.

Imagen now owns an adapted runner at `tools/artwork/builtin_runner.js` and an
isolated tools entry point. Its supporting portable factory code was already
captured in `deployment/controller/tools/artwork`; it is reused rather than
duplicated. The original folder cannot simply move because its live state,
native app, atlas synchronization, publication and workers remain entangled.

## The testable prediction

If art direction explains an important part of the observed difference, a
frozen structured brief should improve FLUX's outcomes relative to its short-brief
condition. If a substantial difference remains under the same supplied brief,
it remains consistent with generator or hidden-workflow differences, rather
than proving a specific architectural explanation.

The connected study is **Art Direction, Held Constant**. It crosses generator
workflow with brief type and keeps originals, prompts and actual settings. Its
first stage is a small blinded pilot, not a large unattended generation batch.
The goal is to find which improvements transfer into our own production pipeline.

## Evidence and boundaries

Sources checked on18 October 2026:

- [OpenAI image-generation workflow and revised prompts](https://developers.openai.com/api/docs/guides/tools-image-generation)
- [OpenAI image-model prompting guidance](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- Local original: `kinship-of-cancer/tools/artwork/builtin_runner.js`
- Local import and audit: `tools/artwork/IMPORT-MANIFEST.json` and `tools/artwork/PORTABILITY.md`

Missing evidence includes a blinded preference comparison, matched actual output
dimensions, effective conditioning-length checks and a stable identity for the
opaque hosted generator. None of those gaps should be filled by assumption.
