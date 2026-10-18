#!/usr/bin/env python3
"""Name FLUX.1 gallery entries from prompt metadata; never fetch image bytes.

Run once or periodically: python3 scripts/image_names_flux1.py
Names and Gemma's reusable phrase bank are persisted under ignored .runtime/.
Existing names are immutable; SHA mismatches fail closed. No gallery/R2 writes.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import pathlib
import re
import subprocess
import time
import urllib.parse
import urllib.request

PROFILE = 'flux1-dev'
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.runtime/image-names/flux1-dev.json'
BANK = ROOT / '.runtime/image-names/flux1-title-bank.json'


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def fetch(base):
    jobs = {}
    cursor = None
    while True:
        query = {'limit': 100, 'profile': PROFILE}
        if cursor:
            query['cursor'] = cursor
        with urllib.request.urlopen(base + '/api/gallery?' + urllib.parse.urlencode(query), timeout=45) as response:
            data = json.load(response)
        for job in data['jobs']:
            if job['profile'] == PROFILE:
                jobs[job['id']] = job
        cursor = data.get('nextCursor')
        if not cursor:
            return jobs


def subject(prompt):
    # Drop repeated atlas instructions, retaining the actual scene description.
    prompt = re.sub(r'^.*?1536x1024\.\s*', '', prompt)
    return prompt.split('Sophisticated painterly realism', 1)[0].strip()


def key(prompt):
    return hashlib.sha256(prompt.encode()).hexdigest()


def study_metadata():
    """Resolve study transport IDs through local, text-only experiment packages."""
    corpus_path = ROOT / 'deployment/controller/docs/artwork/geographic-scenes.json'
    corpus = {}
    if corpus_path.exists():
        corpus = {s['id']: s for s in json.loads(corpus_path.read_text()).get('scenes', [])}
    requests = {}
    for package_path in sorted((ROOT / '.runtime/research').glob('**/runs/*/package.json')):
        try:
            package = json.loads(package_path.read_text())
        except (OSError, ValueError):
            continue  # A study preparer may be atomically replacing its package.
        source = package.get('sourceCorpus', {}).get('scene', {})
        for request in package.get('requests', []):
            if request.get('model') != PROFILE or not request.get('prompt'):
                continue
            scene = request.get('scene', '')
            condition = next((label for label, prompt in package.get('prompts', {}).items()
                              if prompt == request['prompt']), None)
            metadata = {'sceneName': source.get('name'), 'sceneId': source.get('id'),
                        'studyCondition': condition}
            if metadata['sceneName']:
                requests[(scene, key(request['prompt']))] = metadata
    return corpus, requests


def study_title(job, corpus, requests):
    match = re.fullmatch(r'adhc-[0-9a-f]+-(scene-\d+)', job.get('scene', ''))
    if not match:
        return None
    metadata = requests.get((job['scene'], key(job['prompt'])), {}).copy()
    scene = corpus.get(match.group(1), {})
    metadata.setdefault('sceneId', match.group(1))
    metadata.setdefault('sceneName', scene.get('name'))
    if not metadata.get('sceneName'):
        raise ValueError('Cannot resolve study scene name: ' + job['scene'])
    labels = {'A': 'Original Wording', 'B': 'Precision Wording'}
    condition = labels.get(metadata.get('studyCondition'))
    title = metadata['sceneName'] + (' — ' + condition if condition else '')
    return title, metadata


def phrases(prompts):
    instruction = '''Invent concise, evocative exhibition titles from TEXT PROMPT METADATA ONLY.
Do not claim to see images. Never invent objects, weather, colors, locations or lighting absent from the supplied text.
For each numbered scene return six distinct title roots (2–5 words each, each naming this particular place or subject)
and six distinct motifs (1–3 words each, grounded in its text). Every root + " — " + every motif must make a plausible title.
Avoid generic filler such as Untitled, Study, Variation, Masterpiece, Whispers, Symphony, Dreamscape.
No numbering or model names inside phrases. Use natural title case. Return ONLY a JSON object:
{"0":{"roots":[six strings],"motifs":[six strings]},"1":...}.'''
    payload = {
        'model': 'gemma4-12b-artist',
        'messages': [
            {'role': 'system', 'content': instruction},
            {'role': 'user', 'content': json.dumps({str(i): subject(p) for i, p in enumerate(prompts)})},
        ],
        'max_tokens': 3000,
        'temperature': 0.7,
        'chat_template_kwargs': {'enable_thinking': False},
    }
    remote = "import sys,json,urllib.request; p=sys.stdin.buffer.read(); r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8004/v1/chat/completions',data=p,headers={'Content-Type':'application/json'}),timeout=240); print(r.read().decode())"
    import shlex
    response = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-p', '11012', 'root@184.186.104.194', 'python3 -c ' + shlex.quote(remote)],
        input=json.dumps(payload), text=True, capture_output=True, timeout=270, check=True,
    )
    raw = response.stdout
    raw = raw[raw.index('{'):]
    content = json.loads(raw)['choices'][0]['message']['content']
    content = content[content.index('{'):content.rindex('}') + 1]
    result = json.loads(content)
    for i in range(len(prompts)):
        record = result[str(i)]
        for field in ('roots', 'motifs'):
            values = [re.sub(r'\s+', ' ', str(v)).strip(' ."') for v in record[field]]
            if len(values) != 6 or len(set(v.casefold() for v in values)) != 6:
                raise ValueError('Expected six distinct ' + field)
            if any(not v or len(v) > 55 or '\n' in v for v in values):
                raise ValueError('Invalid title phrase')
            record[field] = values
    return result


def metadata_title(job, corpus):
    scene = corpus.get(job.get('scene'), {})
    # Reused scene IDs are not evidence that the current prompt depicts the same subject.
    if scene.get('prompt') and subject(scene['prompt']) == subject(job['prompt']):
        return scene['name']
    description = re.sub(r'^Scene:\s*', '', subject(job['prompt']), flags=re.I)
    phrase = re.split(r'[.;:]|,', description, maxsplit=1)[0]
    phrase = ' '.join(phrase.split()[:8]).strip()
    return phrase[:65].rstrip() or 'Landscape from the Written Prompt'


def update(base, allow_model=False):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _update(base, allow_model)


def _update(base, allow_model):
    jobs = fetch(base)
    existing = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {'schema': 1, 'profile': PROFILE, 'source': 'prompt-metadata', 'names': {}}
    bank = json.loads(BANK.read_text()) if BANK.exists() else {}
    corpus, requests = study_metadata()
    studies = {j['id']: study_title(j, corpus, requests) for j in jobs.values()
               if j.get('scene', '').startswith('adhc-')}
    prompts = list(dict.fromkeys(j['prompt'] for j in jobs.values() if j['id'] not in studies))
    missing = [p for p in prompts if key(p) not in bank]
    for start in range(0, len(missing) if allow_model else 0, 8):
        batch = missing[start:start + 8]
        for attempt in range(3):
            try:
                result = phrases(batch)
                break
            except (ValueError, KeyError, subprocess.SubprocessError) as error:
                if attempt == 2:
                    raise
                print('Retrying phrase batch:', type(error).__name__, flush=True)
                time.sleep(2)
        for i, prompt in enumerate(batch):
            bank[key(prompt)] = result[str(i)]
        save(BANK, bank)
        print(json.dumps({'phraseScenes': len(bank), 'neededScenes': len(prompts)}), flush=True)

    names = existing['names']
    used = {v['title'].casefold() for v in names.values()}
    # Oldest first keeps the assignment stable as new work arrives.
    for job in sorted(jobs.values(), key=lambda j: (j.get('created', 0), j['id'])):
        if job['id'] in names:
            if names[job['id']]['sha256'] != job['sha256']:
                raise ValueError('Immutable gallery identity changed: ' + job['id'])
            continue
        if job['id'] in studies:
            title, metadata = studies[job['id']]
            seed = job.get('settings', {}).get('seed')
            if title.casefold() in used:
                title += ' · Seed ' + str(seed)
            if title.casefold() in used:
                title += ' · ' + job['id'][:8]
            names[job['id']] = {'title': title, 'sha256': job['sha256'], **metadata}
            used.add(title.casefold())
            continue
        record = bank.get(key(job['prompt']))
        if record is None:
            title = metadata_title(job, corpus)
            if title.casefold() in used:
                title += ' · Seed ' + str(job.get('settings', {}).get('seed'))
            if title.casefold() in used:
                title += ' · ' + job['id'][:8]
            names[job['id']] = {'title': title, 'sha256': job['sha256']}
            used.add(title.casefold())
            continue
        # Diagonal order varies roots and motifs together before exhausting combinations.
        candidates = [record['roots'][r] + ' — ' + record['motifs'][(r + offset) % 6]
                      for offset in range(6) for r in range(6)]
        title = next((v for v in candidates if v.casefold() not in used and len(v) <= 90), None)
        if title is None:
            # Future repeated passes stay descriptive, with a genuine immutable seed identity.
            seed = job.get('settings', {}).get('seed')
            for candidate in candidates:
                suffix = (' · Seed ' + str(seed)) if seed is not None else (' · ' + job['id'][:8])
                if (candidate + suffix).casefold() not in used:
                    title = candidate + suffix
                    break
        if title is None:
            raise ValueError('Title bank exhausted for ' + job['id'])
        names[job['id']] = {'title': title, 'sha256': job['sha256']}
        used.add(title.casefold())
    assert all(j['id'] in names for j in jobs.values())
    assert len(used) == len(names), 'Duplicate image titles'
    assert all(0 < len(n['title']) <= 110 and re.fullmatch(r'[0-9a-f]{64}', n['sha256']) for n in names.values())
    existing['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save(OUTPUT, existing)
    print(json.dumps({'profile': PROFILE, 'covered': len(jobs), 'names': len(names), 'uniqueTitles': len(used), 'output': str(OUTPUT)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:48624')
    parser.add_argument('--watch', type=int, default=0, metavar='SECONDS', help='Refresh incrementally; cached names remain fixed.')
    parser.add_argument('--allow-model', action='store_true', help='Opt into text-only Gemma calls for new phrase banks; default is metadata/cache only.')
    args = parser.parse_args()
    while True:
        update(args.base.rstrip('/'), allow_model=args.allow_model)
        if not args.watch:
            break
        time.sleep(max(args.watch, 10))
