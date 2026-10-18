#!/usr/bin/env python3
"""Incremental FLUX.2 artwork titles from prompt metadata; never reads images.

Run from the Imagen checkout. Cached pools need no GPU calls. Opt in with
--allow-model to expand missing pools using text-only Pixtral requests over SSH.
Existing ID/title/hash assignments survive partial or empty gallery responses.
"""
import argparse
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import urllib.parse
import urllib.request

PROFILE = 'flux2-dev-nf4'
ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / '.runtime/image-names'
OUTPUT = DIRECTORY / f'{PROFILE}.json'
POOLS = DIRECTORY / 'flux2-title-pools.json'
REMOTE = '''import json,sys,urllib.request,urllib.error
payload=json.load(sys.stdin)
req=urllib.request.Request('http://127.0.0.1:8002/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
try:
 with urllib.request.urlopen(req,timeout=240) as response:
  print(response.read().decode())
except urllib.error.HTTPError as error:
 print(error.read().decode(),file=sys.stderr)
 raise
'''


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def validate_names(document):
    if (document.get('schema') != 1 or document.get('profile') != PROFILE
            or document.get('source') != 'prompt-metadata'
            or not isinstance(document.get('names'), dict)):
        raise ValueError('Unexpected naming map schema or profile')
    used = set()
    for job_id, item in document['names'].items():
        title = item.get('title')
        if (not isinstance(job_id, str) or not job_id
                or not isinstance(title, str) or not 3 <= len(title) <= 60
                or title != title.strip() or '\n' in title
                or not re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', ''))):
            raise ValueError('Invalid existing title or immutable identity')
        if title.casefold() in used:
            raise ValueError('Duplicate title in existing FLUX.2 naming map')
        used.add(title.casefold())


def gallery(base):
    rows = {}
    cursor = None
    seen = set()
    while True:
        query = {'profile': PROFILE, 'limit': 100}
        if cursor:
            query['cursor'] = cursor
        with urllib.request.urlopen(base + '/api/gallery?' + urllib.parse.urlencode(query), timeout=60) as response:
            data = json.load(response)
        if not data.get('ok'):
            raise RuntimeError('Gallery refused metadata request')
        for job in data['jobs']:
            if job['profile'] != PROFILE:
                raise ValueError('Unexpected profile')
            rows[job['id']] = job
        cursor = data.get('nextCursor')
        if not cursor:
            break
        if cursor in seen:
            raise ValueError('Gallery cursor did not advance')
        seen.add(cursor)
    return list(rows.values())


def scene_description(prompt):
    prompt = re.sub(r'^Use case: stylized-concept\. (?:Create one original landscape illustration for a dignified, beautiful travel atlas, 1536x1024\.|Original 1536x1024 landscape illustration for a beautiful travel atlas\.)\s*', '', prompt)
    return prompt.split('Sophisticated painterly realism')[0].strip()


def generate(batch):
    task = [{'key': key, 'description': scene_description(prompt), 'count': count} for key, prompt, count in batch]
    payload = {
        'model': 'pixtral-critic', 'temperature': 0.75, 'max_tokens': 3500,
        'messages': [
            {'role': 'system', 'content': 'You name artworks using their written generation prompts only. You have not seen the images. Return JSON only: an object mapping each key to an array of the requested number of distinct titles. Titles are evocative, specific, human, 2 to 7 words, maximum 60 characters. Ground every title in the positive description. Never add objects, weather, people or locations absent from the description. Never use exclusions as depicted subjects. Vary phrasing naturally, no numbered variants, edition labels, seed numbers, generic Untitled, or repetitious adjective substitutions. Make titles distinct across the whole batch.'},
            {'role': 'user', 'content': json.dumps(task, ensure_ascii=False)},
        ],
    }
    instructions = payload['messages'][0]['content']
    payload['messages'] = [{'role': 'user', 'content': instructions + '\n' + payload['messages'][1]['content']}]
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-p', '11012', 'root@184.186.104.194', 'python3 -c ' + shlex.quote(REMOTE)], input=json.dumps(payload), text=True, capture_output=True, timeout=280, check=True)
    raw = json.loads(result.stdout)['choices'][0]['message']['content'].strip()
    raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw)
    answer = json.loads(raw)
    cleaned = {}
    for key, _prompt, count in batch:
        titles = answer.get(key)
        if not isinstance(titles, list) or len(titles) < 8:
            raise ValueError(f'Missing title variants for {key}')
        titles = [str(title).strip().strip('"') for title in titles]
        if any(not 3 <= len(title) <= 60 or '\n' in title or re.search(r'\d', title) for title in titles):
            raise ValueError(f'Invalid title length or numbered variant for {key}')
        unique = list(dict((title.casefold(), title) for title in titles).values())
        if len(unique) < 8:
            raise ValueError(f'Too few distinct title variants for {key}')
        cleaned[key] = unique
    return cleaned


def materialize(previous, pools, rows, strict=False):
    validate_names(previous)
    names = previous['names']
    used = {item['title'].casefold() for item in names.values()}
    for job in sorted(rows, key=lambda job: (job.get('created', 0), job['id'])):
        if job['id'] in names:
            continue
        key = hashlib.sha256(job['prompt'].encode()).hexdigest()
        available = [title for title in pools.get(key, [])
                     if isinstance(title, str) and 3 <= len(title) <= 60
                     and title == title.strip() and '\n' not in title
                     and title.casefold() not in used]
        if not available:
            if strict:
                raise ValueError('Title pool exhausted: rerun to expand cached variants')
            continue
        title = available[0]
        names[job['id']] = {'title': title, 'sha256': job['sha256']}
        used.add(title.casefold())
    previous['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    validate_names(previous)
    atomic_json(OUTPUT, previous)


def run(base, allow_model=False):
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    rows = gallery(base)
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {'schema': 1, 'profile': PROFILE, 'source': 'prompt-metadata', 'names': {}}
    validate_names(previous)
    original_names = {job_id: dict(item) for job_id, item in previous['names'].items()}
    pools = json.loads(POOLS.read_text()) if POOLS.exists() else {}
    # Reuse the separate naming lane's metadata-only phrase bank, read-only.
    shared_bank = DIRECTORY / 'flux1-title-bank.json'
    shared = json.loads(shared_bank.read_text()) if shared_bank.exists() else {}
    manual = {
        '': (['Last Amber on the Sahara', 'Ochre Dune Crests', 'Sahara Sand Ridges'], ['Blue-Violet Troughs', 'Wind-Cut Sand', 'Distant Ridge', 'Quiet Open Space']),
        'scene-127': (['Red Sea Coral Wall', 'Beyond the Shallows', 'Reef Descent'], ['Open Blue', 'Layered Coral', 'Small Reef Fish', 'Sunlit Water']),
        'scene-128': (['Octopus at the Crevice', 'Coastal Rock Shelter', 'Mottled Mantle'], ['Curling Arms', 'Open Blue Water', 'Rocky Seabed', 'Overlapping Arms']),
        'scene-129': (['Mineral Chimneys', 'Seafloor Openings', 'Deep Ocean Plumes'], ['Black Water', 'Pale Tube Worms', 'Dark Smoke', 'Rugged Depths']),
        'scene-130': (['Eagle Rays Crossing', 'Diamond Wings', 'Over the Sandy Seabed'], ['Clear Blue Water', 'Separate Shadows', 'Slender Tails', 'Staggered Depths']),
        'scene-131': (['Ha Long Bay', 'Limestone Island', 'Karst Towers'], ['Jade Water', 'Layered Mist', 'Humid Morning', 'Vegetated Slopes']),
        'scene-132': (['Bali Rice Terraces', 'Hillside Paddies', 'Tropical Valley'], ['Narrow Channels', 'Stepped Green', 'Scattered Palms', 'Following the Contours']),
        'scene-133': (['Angkor Wat', 'The Western Pond', 'Sandstone Causeway'], ['Lotus-Bud Towers', 'Broken Reflections', 'Soft Early Light', 'Low Galleries']),
        'scene-134': (['Raja Ampat', 'Limestone Islets', 'Island Silhouette'], ['Turquoise Lagoon', 'Deep Blue Channels', 'Humid Distance', 'Tropical Green']),
        'scene-135': (['Floating Market', 'Thai Canal Boats', 'Fruit at the Waterline'], ['Shaded Timber', 'Quiet Activity', 'Baskets of Fruit', 'Narrow Boats']),
        'scene-136': (['Luang Prabang', 'Along the Mekong', 'Lao Temple Roofs'], ['Forest Hills', 'Riverside Green', 'A Small Boat', 'Trees and Roofs']),
        'scene-137': (['Borneo Canopy', 'Dipterocarp Crowns', 'Rainforest Layers'], ['Valley Mist', 'Humid Daylight', 'Leaf Structure', 'Branch Opening']),
        'scene-138': (['Bagan Temples', 'Pagodas by the Water', 'Irrawaddy Plain'], ['Dawn Mist', 'Brick and Reflection', 'Tapering Spires', 'Terraced Bases']),
        'scene-139': (['Krabi Limestone Coast', 'Karst Above the Cove', 'Cliffs by the Sea'], ['Turquoise Water', 'Tidal Rock', 'Green Ledges', 'Sandy Cove']),
        'scene-140': (['Komodo Saddle', 'Between Two Bays', 'Archipelago Ridges'], ['Dry-Season Light', 'Ochre Slopes', 'Serpentine Coast', 'Deep Blue Channels']),
    }
    # Scene IDs can be reused by later studies: require the original subject too.
    manual_subjects = {
        '': 'wind-cut ochre sahara dune crests',
        'scene-127': 'red sea underwater coral wall',
        'scene-128': 'one mottled octopus',
        'scene-129': 'deep ocean mineral chimneys',
        'scene-130': 'eagle rays crossing',
        'scene-131': 'ha long bay',
        'scene-132': 'bali rice terraces',
        'scene-133': 'angkor wat',
        'scene-134': 'raja ampat',
        'scene-135': 'thai floating market',
        'scene-136': 'luang prabang',
        'scene-137': 'borneo rainforest canopy',
        'scene-138': 'bagan brick pagodas',
        'scene-139': 'krabi limestone coast',
        'scene-140': 'komodo archipelago',
    }
    grouped = collections.defaultdict(list)
    for job in rows:
        if not re.fullmatch(r'[0-9a-f]{64}', job.get('sha256', '')):
            raise ValueError('Missing immutable image hash')
        grouped[job['prompt']].append(job)
        if job['id'] in previous['names'] and previous['names'][job['id']]['sha256'] != job['sha256']:
            raise ValueError('Image identity changed; refusing title reassignment')
    pending = []
    for prompt, jobs in grouped.items():
        key = hashlib.sha256(prompt.encode()).hexdigest()
        if key in shared:
            phrase_set = shared[key]
            additional = [root + ' — ' + motif for root in phrase_set['roots'] for motif in phrase_set['motifs']]
        elif (jobs[0].get('scene', '') in manual
              and manual_subjects[jobs[0].get('scene', '')] in scene_description(prompt).casefold()):
            roots, motifs = manual[jobs[0].get('scene', '')]
            additional = [root + ' — ' + motif for root in roots for motif in motifs]
        else:
            additional = []
        existing = pools.get(key, [])
        pools[key] = existing + [title for title in additional if 3 <= len(title) <= 60 and title.casefold() not in {item.casefold() for item in existing}]
    atomic_json(POOLS, pools)
    materialize(previous, pools, rows)
    # Existing complete inventories never trigger inference just to refill a pool.
    for prompt, jobs in grouped.items():
        missing = sum(job['id'] not in previous['names'] for job in jobs)
        if missing:
            pending.append((hashlib.sha256(prompt.encode()).hexdigest(), prompt, max(14, missing + 8)))
    if pending and not allow_model:
        missing_count = sum(job['id'] not in previous['names'] for job in rows)
        raise RuntimeError(f'{missing_count} images need expanded title pools; cached names preserved. '
                           'Use --allow-model only when text-model inference is authorized.')
    for start in range(0, len(pending), 7):
        batch = pending[start:start + 7]
        for attempt in range(3):
            try:
                generated = generate(batch)
                break
            except (ValueError, KeyError, json.JSONDecodeError):
                if attempt == 2:
                    raise
        for key, titles in generated.items():
            old = pools.get(key, [])
            pools[key] = old + [title for title in titles if title.casefold() not in {item.casefold() for item in old}]
        atomic_json(POOLS, pools)
        materialize(previous, pools, rows)
        print(json.dumps({'titlePoolsCompleted': min(start + 7, len(pending)), 'titlePoolsRequested': len(pending)}), flush=True)
    materialize(previous, pools, rows, strict=True)
    names = previous['names']
    assert all(names.get(job_id) == item for job_id, item in original_names.items()), 'Existing names changed or were lost'
    assert all(job['id'] in names and names[job['id']]['sha256'] == job['sha256'] for job in rows)
    assert len({item['title'].casefold() for item in names.values()}) == len(names)
    other_file = DIRECTORY / 'flux1-dev.json'
    other = json.loads(other_file.read_text()).get('names', {}) if other_file.exists() else {}
    other_titles = {item['title'].casefold() for item in other.values()}
    overlaps = sum(item['title'].casefold() in other_titles for item in names.values())
    print(json.dumps({'profile': PROFILE, 'galleryJobs': len(rows), 'namedJobs': len(names), 'uncovered': 0,
                      'preservedExisting': len(original_names), 'crossProfileSharedTitles': overlaps,
                      'maxTitleLength': max((len(item['title']) for item in names.values()), default=0), 'output': str(OUTPUT)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:48624')
    parser.add_argument('--allow-model', action='store_true', help='Authorize text-only inference to expand missing title pools.')
    args = parser.parse_args()
    run(args.base.rstrip('/'), allow_model=args.allow_model)
