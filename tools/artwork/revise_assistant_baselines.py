#!/usr/bin/env python3
"""Revise saved assistant baselines through Qwen, never write the production corpus.

The CLI uses SSH to run tokenizers on CPU and the existing Qwen loopback service.
Each response is saved before another request. It can resume safely by baseline
hash; semantic risk flags are advisory and are not proof of equivalence.
"""
import argparse
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import shlex
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
DEFAULT=ROOT/'research/studies/art-direction-held-constant/baselines-40.json'
REMOTE=r'''
import json,sys,urllib.request
from transformers import CLIPTokenizer,AutoTokenizer
payload=json.load(sys.stdin)
clip=CLIPTokenizer.from_pretrained('/workspace/artwork/models/flux1/tokenizer',local_files_only=True)
t5=AutoTokenizer.from_pretrained('/workspace/artwork/models/flux1/tokenizer_2',local_files_only=True)
def count(text):return {'clip':len(clip(text,add_special_tokens=True,truncation=False)['input_ids']),'t5':len(t5(text,add_special_tokens=True,truncation=False)['input_ids'])}
if payload['mode']=='count':
 print(json.dumps([{'id':s['id'],'baselineTokens':count(s['baselinePrompt'])} for s in payload['scenes']]))
else:
 baseline=payload['baselinePrompt']
 instruction="""You revise image prompts written by the Imagen assistant. Rewrite the exact supplied BASELINE into a substantive visual composition. SOURCE CONTEXT grounds permitted art direction: explicitly assign foreground/middle/background, viewpoint, overlaps or how the specified light falls on the specified forms, consistently with the source. You may recover source composition omitted by baseline compression. Preserve the baseline's defining place, subjects, counts, time, style and exclusions. Do not invent new subjects, structures, decorative objects, colors, camera hardware or facts. Do not remove requested subjects. Punctuation edits, synonyms, headings and sentence fragmentation are NOT a substantive revision. Make at least two concrete compositional decisions explicit. Distinguish added placement/viewpoint direction from invented objects in your change claims. Never include image dimensions or boilerplate. Target 45-65 CLIP tokens and NEVER exceed77 including special tokens. English only. Return one JSON object with precisionPrompt (string), changes (array of concrete claims), possibleLostContent (array), possibleAddedContent (array). No baseline field; no markdown. Claims will be checked independently."""
 instruction+=' Report possibleLostContent relative to BASELINE only, not omitted source boilerplate. The revision must retain these baseline place-name words: '+', '.join(payload.get('protectedNames',[]))+'.'
 if payload.get('feedback'):instruction+=' Previous response failed validation: '+payload['feedback']
 body={'model':'qwen-precision','messages':[{'role':'system','content':instruction},{'role':'user','content':'BASELINE (assistant-authored; revise this exact text):\n'+baseline+'\n\nSOURCE CONTEXT (ground composition, preserve the baseline identity):\n'+payload.get('sourcePrompt','')}],'temperature':0.35,'max_tokens':900,'chat_template_kwargs':{'enable_thinking':False}}
 request=urllib.request.Request('http://127.0.0.1:8005/v1/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(request,timeout=180) as response:result=json.load(response)
 content=result['choices'][0]['message']['content'];clean=content.strip()
 if clean.startswith('```'):clean=clean.split('\n',1)[1].rsplit('```',1)[0]
 parsed=json.loads(clean);text=parsed['precisionPrompt']
 if not isinstance(text,str) or not text.strip():raise ValueError('Empty precision prompt')
 print(json.dumps({'response':parsed,'precisionTokens':count(text),'baselineTokens':count(baseline),'model':result.get('model'),'usage':result.get('usage'),'responseId':result.get('id'),'finishReason':result['choices'][0].get('finish_reason')}))
'''

def remote(payload,args):
 command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','-p',str(args.port),args.host,'/workspace/artwork/.venv/bin/python -c '+shlex.quote(REMOTE)]
 result=subprocess.run(command,input=json.dumps(payload),text=True,capture_output=True,timeout=210)
 if result.returncode:raise RuntimeError(result.stderr[-1800:])
 return json.loads(result.stdout)

def independent_diff(before,after):
 a,b=before.split(),after.split();matcher=difflib.SequenceMatcher(a=a,b=b,autojunk=False);operations=[]
 for kind,i,j,k,l in matcher.get_opcodes():
  if kind!='equal':operations.append({'kind':kind,'removed':' '.join(a[i:j]),'added':' '.join(b[k:l])})
 return {'method':'Python difflib word sequence; exact lexical changes, not semantic proof','operations':operations,'unchangedRatio':matcher.ratio()}

def normalized_ratio(before,after):
 synonyms={'leading':'lead','leads':'lead','toward':'to','towards':'to','beneath':'under','below':'under'}
 def words(text):return [synonyms.get(word,word) for word in re.findall(r'[a-z0-9]+',text.lower())]
 return difflib.SequenceMatcher(a=words(before),b=words(after),autojunk=False).ratio()

def dropped_exclusions(before,after):
 def negative_words(text):
  return [word for clause in re.findall(r'\b(?:no|without)\s+([^.;]+)',text.lower()) for word in re.findall(r'[a-z]+',clause) if word not in {'no','or','and','a','the'}]
 excluded=negative_words(before)
 words=set(negative_words(after))
 return [word for word in excluded if word not in words]

def protected_names(scene):
 words=re.findall(r'\b[^\W\d_]+',scene['name'],re.UNICODE)
 baseline=scene['baselinePrompt'].lower()
 return [word for word in words if word[0].isupper() and word not in {'The','An','A'} and word.lower() in baseline]

def save(path,data):
 # A concurrent independent text audit may approve a completed row while Qwen
 # revises later scenes. Preserve that audit when the exact hashes still match.
 if path.exists():
  existing={s['id']:s for s in json.loads(path.read_text()).get('scenes',[])}
  for scene in data['scenes']:
   old=existing.get(scene['id'],{})
   if scene.get('precisionSha256') and old.get('precisionSha256')==scene['precisionSha256'] and old.get('baselineSha256')==scene.get('baselineSha256'):
    for key in ('semanticReviewStatus','semanticReview','semanticReviewer','revisionFeedback'):
     if key in old:scene[key]=old[key]
 temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');os.replace(temporary,path)

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--file',type=Path,default=DEFAULT);parser.add_argument('--host',default='root@184.186.104.194');parser.add_argument('--port',type=int,default=11012);parser.add_argument('--count-only',action='store_true');parser.add_argument('--limit',type=int,default=150);parser.add_argument('--wait-seconds',type=int,default=1800);args=parser.parse_args()
 data=json.loads(args.file.read_text())
 if args.count_only:
  counts=remote({'mode':'count','scenes':data['scenes']},args);lookup={s['id']:s for s in counts}
  for scene in data['scenes']:scene['baselineTokens']=lookup[scene['id']]['baselineTokens']
  save(args.file,data);print(json.dumps({'counted':len(counts),'maxClip':max(s['baselineTokens']['clip'] for s in data['scenes']),'overBudget':[s['id'] for s in data['scenes'] if s['baselineTokens']['clip']>data.get('baselineClipBudget',45)]}),flush=True);return
 done=0;deadline=time.monotonic()+args.wait_seconds
 for scene in data['scenes']:
  if done>=args.limit:break
  baseline=scene['baselinePrompt'];sha=hashlib.sha256(baseline.encode()).hexdigest()
  if scene.get('precisionPrompt') and scene.get('revisionBaselineSha256')==sha and scene.get('semanticReviewStatus')!='rejected':continue
  if (scene.get('baselineTokens') or {}).get('clip',999)>data.get('baselineClipBudget',45):raise ValueError(scene['id']+' baseline exceeds recorded approximate40 budget or has no measured CLIP count')
  feedback=scene.get('revisionFeedback','');success=False
  for attempt in range(4):
   while True:
    try:receipt=remote({'mode':'revise','baselinePrompt':baseline,'sourcePrompt':scene['sourcePrompt'],'protectedNames':protected_names(scene),'feedback':feedback},args);break
    except (RuntimeError,subprocess.TimeoutExpired) as error:
     scene['revisionStatus']='awaiting-qwen';scene['lastRevisionError']=str(error)[-500:];save(args.file,data)
     print(json.dumps({'scene':scene['id'],'status':'qwen-unavailable','error':str(error)[-250:]}),flush=True)
     if time.monotonic()>deadline:raise
     time.sleep(15)
   precision=receipt['response']['precisionPrompt'].strip();diff=independent_diff(baseline,precision)
   if receipt['precisionTokens']['clip']>77:feedback='Your revision measured '+str(receipt['precisionTokens']['clip'])+' actual CLIP tokens; reduce below77.';continue
   if 'painterly realism' in baseline.lower() and 'painterly realism' not in precision.lower():feedback='You dropped the required baseline style painterly realism. Include the exact phrase Painterly realism and retain every baseline scene detail while adding concrete source-grounded composition.';continue
   missing_names=[word for word in protected_names(scene) if word.lower() not in precision.lower()]
   if missing_names:feedback='You dropped required baseline location identity: '+', '.join(missing_names)+'. Restore these exact names as well as all baseline subjects and exclusions.';continue
   missing=dropped_exclusions(baseline,precision)
   if missing:feedback='You dropped baseline exclusions: '+', '.join(missing)+'. Preserve the baseline no/exclusion clauses explicitly, with those exact subject words.';continue
   if receipt['precisionTokens']['clip']<.9*receipt['baselineTokens']['clip']:feedback='You destructively compressed the baseline rather than adding concrete art direction. Retain ALL baseline details and exclusions, then add clear source-grounded placement and light relationships. Target45–65 actual CLIP tokens, maximum77.';continue
   if precision==baseline or normalized_ratio(baseline,precision)>.86:feedback='Your previous revision only changed punctuation, synonyms or reordered phrases. Make actual concrete spatial relationships explicit: foreground versus distance, placement of existing subjects or how specified light falls on specified forms. Preserve the same scene and style. Do not claim clarifications absent from the revised text.';continue
   if receipt['finishReason']!='stop':feedback='Response was truncated. Return concise complete JSON.';continue
   scene.pop('semanticReview',None);scene.pop('semanticReviewer',None)
   scene.update({'precisionPrompt':precision,'precisionAuthor':'Qwen','precisionModel':receipt['model'],'precisionTokens':receipt['precisionTokens'],'baselineTokens':receipt['baselineTokens'],'revisionBaselineSha256':sha,'precisionSha256':hashlib.sha256(precision.encode()).hexdigest(),'revisionStatus':'qwen-revised-token-verified','semanticReviewStatus':'unreviewed','changes':receipt['response'].get('changes',[]),'qwenPossibleLostContent':receipt['response'].get('possibleLostContent',[]),'qwenPossibleAddedContent':receipt['response'].get('possibleAddedContent',[]),'independentDiff':diff,'revisionReceipt':{'responseId':receipt['responseId'],'usage':receipt['usage'],'finishReason':receipt['finishReason'],'requestedModel':'qwen-precision','baselineSha256':sha}})
   scene.pop('lastRevisionError',None);save(args.file,data);done+=1;success=True
   print(json.dumps({'scene':scene['id'],'status':scene['revisionStatus'],'baselineTokens':scene['baselineTokens'],'precisionTokens':scene['precisionTokens'],'revisedTotal':sum(bool(s.get('precisionPrompt')) for s in data['scenes'])}),flush=True);break
  if not success:
   scene['revisionStatus']='revision-validation-failed';scene['lastRevisionError']=feedback;save(args.file,data)
 print(json.dumps({'revisedThisRun':done,'applied':0}),flush=True)

if __name__=='__main__':main()
