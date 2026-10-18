#!/usr/bin/env python3
"""Validate the production-parity preparation; never queue or generate images."""
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
STUDY = REPO / 'research/studies/art-direction-held-constant'

def validate():
    plan = json.loads((STUDY / 'plan.json').read_text())
    corpus = json.loads((STUDY / 'corpus.json').read_text())
    source = (REPO / corpus['source']).read_bytes()
    if hashlib.sha256(source).hexdigest() != corpus['sourceSha256']:
        raise ValueError('Production catalog changed; reconcile the frozen study source')
    scenes = json.loads(source)['scenes']
    if len(scenes) != 150 or len(corpus['scenes']) != len(scenes):
        raise ValueError('Expected the complete 150-scene production pool')
    if len({scene['id'] for scene in scenes}) != len(scenes):
        raise ValueError('Duplicate scene identity')
    drafts = 0
    for original, frozen in zip(scenes, corpus['scenes']):
        if any(frozen.get(key) != value for key, value in original.items()):
            raise ValueError('Production scene changed')
        if hashlib.sha256(original['prompt'].encode()).hexdigest() != frozen['productionPromptSha256']:
            raise ValueError('Production prompt hash mismatch')
        draft = frozen['precisionPrompt']
        if draft is not None:
            if not isinstance(draft, str) or not draft.strip() or draft == original['prompt'] or not frozen.get('precisionAuthor'):
                raise ValueError('Precision drafts need distinct text and authorship')
            drafts += 1
        elif frozen['precisionStatus'] != 'awaiting-draft':
            raise ValueError('Missing precision prompt marked ready')
    if plan['execution'].get('imagesPerWorker',1) != 1 or plan['execution']['concurrency'] not in (1,2) or plan['design']['startingImages'] != 2 or plan['initialWorkflow'] != 'flux1':
        raise ValueError('Initial serial-pair policy changed')
    if plan['execution']['draftsReady'] != (drafts == len(scenes)):
        raise ValueError('Draft readiness is inaccurate')
    return {'study':plan['id'],'revision':plan['revision'],'scenes':len(scenes),'precisionDrafts':drafts,'startingImages':2,'generationStartedByValidation':False}

if __name__ == '__main__':
    print(json.dumps(validate()))
