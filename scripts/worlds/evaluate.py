"""Record attributed candidate feedback without an agent viewing image content."""
import base64
import hashlib
import json
from pathlib import Path
import time
import urllib.request

root = Path('/workspace/artwork/judges/world-draa-trial')
brief = json.loads((root/'brief.json').read_text())
source = brief['source']
source_raw = (Path('/workspace/artwork/jobs')/source['profile']/source['id']/'result.png').read_bytes()
render_raw = (root/'arrival.png').read_bytes()
def uri(raw): return 'data:image/png;base64,'+base64.b64encode(raw).decode()
def post(port, path, body):
    request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.load(response)
report = {'sourceSha256':hashlib.sha256(source_raw).hexdigest(), 'candidateSha256':hashlib.sha256(render_raw).hexdigest(), 'startedAt':time.time(), 'comparisonMode':'Candidate image assessed against attributed textual source brief; DINO compares both image bytes.', 'reviews':{}}
report['dino'] = post(8003,'/v1/compare',{'image_a':uri(source_raw),'image_b':uri(render_raw)})
for name, model, port in [('Pixtral','pixtral-critic',8002),('Gemma','gemma4-12b-artist',8004)]:
    prompt = 'This image is an initial pure GLSL procedural interpretation of a Draa Valley source artwork. You are seeing the CANDIDATE ONLY, not the source image in this request. Compare its visible features against your attributed source brief below, without pretending to have compared both images. Assess channel, palms, cultivated plots, mud-brick settlement/tower, foothills, light, scale and depth. Identify the strongest mismatch and propose at most two small uniform/parameter changes (sun elevation, canal width, camera position/look) if appropriate. Do not invent success, fidelity, traversal or acceptance. Be candid if the procedural forms are too crude. Source brief: '+brief['reviews'][name]['feedback']
    body={'model':model,'temperature':.1,'max_tokens':1100,'messages':[{'role':'user','content':[{'type':'image_url','image_url':{'url':uri(render_raw)}},{'type':'text','text':prompt}]}]}
    if port==8004:body['chat_template_kwargs']={'enable_thinking':False}
    data=post(port,'/v1/chat/completions',body)
    report['reviews'][name]={'model':model,'feedback':data['choices'][0]['message']['content'],'finishReason':data['choices'][0]['finish_reason'],'observedAt':time.time()}
    (root/'evaluation.json').write_text(json.dumps(report,indent=2));print(json.dumps({'reviewer':name,'complete':True}),flush=True)
report['finishedAt']=time.time();(root/'evaluation.json').write_text(json.dumps(report,indent=2))
