"""Describe one immutable existing image through the resident vision models."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
source = json.loads(args.source.read_text())
image = Path('/workspace/artwork/jobs') / source['profile'] / source['id'] / 'result.png'
raw = image.read_bytes()
if hashlib.sha256(raw).hexdigest() != source['sha256']:
    raise ValueError('Source hash mismatch')
uri = 'data:image/png;base64,' + base64.b64encode(raw).decode()
passes = {
    'spatial_inventory': """Analyze ONLY the visible source image, not its prompt. Return JSON with camera (horizon_y_0to1, vanishing_point_xy_0to1 or null, estimated field-of-view range and uncertainty), layers (foreground/middle/background and their contents), elements (12-20 distinct visible objects or coherent regions where genuinely present: id, type, bbox [x0,y0,x1,y1] normalized to the full image, silhouette, relative proportions, visible parts, estimated relative depth, occludes IDs, occluded_by IDs, confidence 0..1, observation_or_inference), negative_space, and uncertain_or_absent_features. Identify channel bends/edges, bank profiles, separate palm positions/crown/trunk shapes, field boundaries, individual building masses, rooflines, tower and mountain ridges. Do not invent 20 objects to fill a quota. Coordinates are approximate visual estimates, not segmentation or measured depth. Hidden sides and metric sizes must remain unknown.""",
    'surface_and_light': """Inspect this source image in detail for procedural rendering. Return JSON with palette (8-12 roles, approximate hex colors, screen region and confidence), materials (separate water, wet/dry mud, masonry, cultivated plants, palm trunks/fronds, rocky terrain, sky where visible: roughness cues, texture scale relative to objects, color variation, reflectance cues, edge quality), illumination (visible light direction evidence, warmth, diffuse/ambient balance, long shadow locations/directions, penumbra, atmosphere), water (visible width changes, flow/ripples, reflection color/shape, transparency evidence, bank interaction), details (small visible features that carry identity), and uncertainty. Separate image observations from shader suggestions and from inferred physical properties. Do not state exact physical roughness or dimensions as measured facts. Inspect the image rather than reciting its generation prompt.""",
    'glsl_scene_contract': """Specify a faithful pure GLSL procedural interpretation of THIS image. Describe representation choices in prose ONLY: no code, no multiline JSON strings, no pseudocode. Return JSON with recognition_constraints (at least 10 concrete image-specific targets with image locations and priorities if supported), geometry (parts, silhouette constraints, plausible GLSL SDF/heightfield/analytic representation, controllable parameters, visible versus inferred portions), spatial_relationships (channel/landmarks/vegetation/settlement/terrain alignments and overlaps), camera_constraints, safe_parameter_ranges (dimensionless estimates with uncertainty, no claimed metric scale), unseen_space_policy, exploration_viewpoints (arrival, approach, lateral, close view, return; what should remain consistent), known_limitations, and rejection_conditions. No textures/meshes/depth maps/splats/Three.js. Do not claim source depth or hidden world geometry has been reconstructed. GLSL choices are proposals, not observed image facts. Inspect the actual image; do not substitute generic oasis features.""",
}
report = {'source': source, 'startedAt': time.time(), 'analysisVersion': 2, 'reviews': {}}
def parse_json(text):
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1].rsplit('```', 1)[0]
    return json.loads(text)
for name, model, port in [('Pixtral', 'pixtral-critic', 8002), ('Gemma', 'gemma4-12b-artist', 8004)]:
    sections = {}; report['reviews'][name] = {'model': model, 'passes': sections}
    for pass_name, question in passes.items():
        body = {'model': model, 'temperature': .1, 'max_tokens': 3000, 'messages': [{'role':'user', 'content':[{'type':'image_url','image_url':{'url':uri}}, {'type':'text','text':question}]}]}
        if port == 8004:
            body['chat_template_kwargs'] = {'enable_thinking': False}
        request = urllib.request.Request(f'http://127.0.0.1:{port}/v1/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request, timeout=240) as response:
            data = json.load(response)
        choice = data['choices'][0]
        feedback = choice['message']['content']
        entry = {'feedback': feedback, 'finishReason': choice['finish_reason'], 'observedAt': time.time()}
        try:
            entry['structured'] = parse_json(feedback)
        except (ValueError, IndexError):
            entry['parseError'] = 'Model output was not complete JSON; raw feedback retained.'
        sections[pass_name] = entry
        args.output.write_text(json.dumps(report, indent=2))
        print(json.dumps({'reviewer':name, 'pass':pass_name, 'finish':entry['finishReason'], 'structured': 'structured' in entry}), flush=True)
report['finishedAt'] = time.time()
args.output.write_text(json.dumps(report, indent=2))
