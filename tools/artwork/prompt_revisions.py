"""Select an audited assistant baseline and Qwen revision without changing sources."""
import hashlib
import json
from pathlib import Path

DEFAULT=Path(__file__).resolve().parents[2]/'research/studies/art-direction-held-constant/baselines-40.json'

def ready_revision(scene,path=DEFAULT,data=None):
    if data is None:
        try:data=json.loads(Path(path).read_text())
        except (OSError,ValueError):return None
    if not isinstance(data,dict) or not isinstance(data.get('scenes'),list) or not isinstance(data.get('id'),str):return None
    row=next((r for r in data['scenes'] if isinstance(r,dict) and r.get('id')==scene['id']),None)
    if not row or row.get('semanticReviewStatus')!='approved':return None
    digest=lambda text:hashlib.sha256(text.encode()).hexdigest()
    if row.get('sourcePrompt')!=scene['prompt'] or row.get('sourcePromptSha256')!=scene['productionPromptSha256']:return None
    a,b=row.get('baselinePrompt'),row.get('precisionPrompt')
    if not isinstance(a,str) or not isinstance(b,str) or not a.strip() or not b.strip() or a==b:return None
    if row.get('baselineAuthor')!='Imagen assistant' or row.get('precisionAuthor')!='Qwen':return None
    if row.get('baselineSha256')!=digest(a) or row.get('revisionBaselineSha256')!=digest(a) or row.get('precisionSha256')!=digest(b):return None
    if row.get('revisionStatus')!='qwen-revised-token-verified':return None
    for key,limit in [('baselineTokens',48),('precisionTokens',77)]:
        counts=row.get(key,{})
        if not isinstance(counts,dict):return None
        if type(counts.get('clip')) is not int or not 20<=counts['clip']<=limit:return None
        if type(counts.get('t5')) is not int or not 1<=counts['t5']<=512:return None
    return {**row,'promptRevision':data['id']}

def approved_indices(corpus,path=DEFAULT):
    try:data=json.loads(Path(path).read_text())
    except (OSError,ValueError):return []
    return [i for i,scene in enumerate(corpus['scenes']) if ready_revision(scene,data=data)]
