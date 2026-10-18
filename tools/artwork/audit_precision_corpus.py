#!/usr/bin/env python3
"""Read-only prompt parity audit. Never contacts a worker or changes a corpus.

Exact source identity is enforced. Exclusion checks inspect negative instructions,
not arbitrary word differences. Unrecognized paraphrases require review rather
than being called contradictions. Token estimates are not tokenizer validation.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re

REPO = Path(__file__).resolve().parents[2]
DEFAULT_CORPUS = Path('research/studies/art-direction-held-constant/corpus.json')
NEGATIVE = re.compile(r'\b(?:no|not|without|exclude|avoid)\b', re.I)
STOP = set('no not without exclude avoid a an the and or with do to be into let make add added invented generic substitute substitution replace replacing turn include claiming effects that'.split())
ALIASES = {'dominating':'dominate', 'exaggerated':'exaggerate', 'fantastical':'fantasy', 'count':'', 'of':'', 'match':'', 'place':'', 'name':'', 'above-water':'abovewater'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalize_words(value):
    words = re.findall(r"[a-z]+(?:-[a-z]+)*", value.lower())
    normalized = set()
    for word in words:
        word = ALIASES.get(word, word)
        if word.endswith('ies'): word = word[:-3] + 'y'
        elif word.endswith('s') and not word.endswith(('ss', 'us')): word = word[:-1]
        if word and word not in STOP: normalized.add(word)
    return normalized


def negatives(prompt):
    """Return explicit negative scopes, stopping at sentence/semicolon boundaries."""
    scopes = []
    for sentence in re.split(r'[.;]', prompt):
        marker = NEGATIVE.search(sentence)
        if marker:
            scopes.append(sentence[marker.start():].strip())
    return scopes


def explicit_exclusions_preserved(original, precision):
    target = set().union(*(normalize_words(clause) for clause in negatives(precision)))
    missing = []
    for clause in negatives(original):
        # This source sentence includes positive palette after the restriction.
        clause = re.sub(r',\s*soft dawn gray.*$', '', clause, flags=re.I)
        wanted = normalize_words(clause)
        if wanted and not wanted <= target:
            # The first rewrite states the same conditional preservation rule
            # using 'rather than'; accept this documented paraphrase only.
            conditional = ('not replace animals or buildings with generic landscape' in clause.lower()
                           and re.search(r'animals.*preserve their recognizable identity rather than replacing them with generic landscape', precision, re.I)
                           and 'architectural forms' in precision.lower())
            if not conditional: missing.append(clause)
    return missing


def dimensions(prompt):
    return {tuple(map(int, pair)) for pair in re.findall(r'\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b', prompt)}


def audit(corpus, source_bytes, expected_count=150):
    errors, reviews = [], []
    def fail(code, scene=None, detail=None):
        errors.append({k:v for k,v in {'code':code,'scene':scene,'detail':detail}.items() if v is not None})
    if sha(source_bytes) != corpus.get('sourceSha256'):
        fail('source-file-hash-mismatch')
    source = json.loads(source_bytes)
    originals = {row['id']:row for row in source['scenes']}
    rows = corpus.get('scenes', [])
    if len(rows) != expected_count or len(originals) != expected_count:
        fail('scene-count-mismatch', detail={'expected':expected_count,'frozen':len(rows),'source':len(originals)})
    seen, rewrites, lengths = set(), {}, []
    exclusions_checked = 0
    for row in rows:
        sid = row.get('id')
        if sid in seen: fail('duplicate-scene-id', sid)
        seen.add(sid)
        original = originals.get(sid)
        if original is None:
            fail('unknown-source-scene', sid)
            continue
        if any(row.get(key) != value for key,value in original.items()):
            fail('production-source-changed', sid)
        production, precision = row.get('prompt',''), row.get('precisionPrompt','')
        if sha(production.encode()) != row.get('productionPromptSha256'):
            fail('production-prompt-hash-mismatch', sid)
        if not isinstance(precision,str) or not precision.strip():
            fail('missing-precision-prompt', sid)
            continue
        if production == precision: fail('unchanged-precision-prompt', sid)
        digest = sha(precision.encode())
        if digest in rewrites: fail('duplicate-precision-prompt', sid, rewrites[digest])
        rewrites[digest] = sid
        if row.get('precisionAuthor') != 'Imagen assistant': fail('missing-or-unexpected-author', sid)
        if row.get('precisionStatus') not in ('draft','ready','approved'): fail('invalid-precision-status', sid)
        requested = dimensions(production)
        if dimensions(precision) != requested: fail('dimension-prose-changed', sid)
        exclusions_checked += len(negatives(production))
        missing = explicit_exclusions_preserved(production, precision)
        if missing:
            reviews.append({'scene':sid,'code':'exclusion-paraphrase-needs-review','clauses':missing})
        # A positive request to include a source-prohibited subject is a concrete
        # contradiction; mere mention in a rewrite is not evidence of one.
        restricted = ('buildings','people','sunlight','lava glow','above-water view')
        for subject in restricted:
            source_bans = any(re.match(r'^(?:no|exclude|avoid|without|not (?:include|add|show))\b', scope, re.I)
                              and re.search(r'\b'+re.escape(subject)+r'\b',scope,re.I)
                              for scope in negatives(production))
            positive = re.search(r'(?<!not )\b(?:include|add|show)\s+(?:an?\s+)?'+re.escape(subject)+r'\b',precision,re.I)
            if source_bans and positive:
                sentence = re.split(r'[.;]', precision[:positive.start()])[-1]
                if not NEGATIVE.search(sentence): fail('explicit-positive-negative-contradiction',sid,subject)
        # Special source conditions that are easy to lose in generic rewriting.
        if sid in {'scene-123','scene-124','scene-128'}:
            if not re.search(r'\bunderwater\b',precision,re.I): fail('underwater-camera-condition-missing',sid)
        if sid == 'scene-104':
            for required in ('branching','rounded','fish','sandy','surface','caustic'):
                if not re.search(r'\b'+required+r'\b',precision,re.I):
                    reviews.append({'scene':sid,'code':'reef-condition-needs-review','condition':required})
        # Conservative rough character heuristic only; CLIP naturally truncates.
        lengths.append({'scene':sid,'production':math.ceil(len(production)/4),'precision':math.ceil(len(precision)/4)})
    for sid in sorted(set(originals)-seen): fail('missing-source-scene',sid)
    over = [row for row in lengths if row['precision'] > 512]
    return {'schema':1,'readOnly':True,'passed':not errors and not reviews,'sceneCount':len(rows),
            'sourceIdentityVerified':sha(source_bytes)==corpus.get('sourceSha256'),
            'distinctPrecisionPrompts':len(rewrites),'explicitExclusionClausesChecked':exclusions_checked,
            'errors':errors,'reviewRequired':reviews,
            'tokenLength':{'method':'ceil(characters/4); heuristic only, not actual CLIP/T5 tokenization',
                           'precisionEstimatedMaximum':max((r['precision'] for r in lengths),default=0),
                           'estimatedOver512':over},
            'limits':['No semantic equivalence proof or image-quality judgment.',
                      'Exclusion paraphrases unresolved by conservative scope checks need human review.',
                      'Actual native tokenizer limits remain the worker preflight responsibility.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=REPO)
    parser.add_argument('--corpus',type=Path,default=DEFAULT_CORPUS)
    parser.add_argument('--output',type=Path,help='Optional JSON report; corpus and model state remain unchanged')
    args = parser.parse_args()
    corpus = json.loads((args.root/args.corpus).read_text())
    report = audit(corpus,(args.root/corpus['source']).read_bytes())
    encoded = json.dumps(report,indent=2,ensure_ascii=False)+'\n'
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(encoded)
    print(json.dumps({'passed':report['passed'],'sceneCount':report['sceneCount'],
                      'errors':len(report['errors']),'reviewRequired':len(report['reviewRequired']),
                      'estimatedMaximumTokens':report['tokenLength']['precisionEstimatedMaximum']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
