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
 instruction="""You revise image prompts written by the Imagen assistant. The supplied BASELINE is the sole content authority. Rewrite that exact baseline as a more precise, coherent visual composition, describing concrete spatial relationships, forms, lighting or readable anatomy already present. Preserve named place, main subjects, counts, time, viewpoint and prohibitions. Do not invent objects, structures, colors, camera technology, art styles or facts. Do not remove requested subjects. Do not merely reorder phrases or add headings. Keep revision concise: target 45-65 CLIP tokens and NEVER exceed 77 CLIP tokens including special tokens. English only. Return one JSON object with precisionPrompt (string), changes (array of concrete claims), possibleLostContent (array), possibleAddedContent (array). No baseline field; no markdown. Your claims will be checked independently."""
 if payload.get('feedback'):instruction+=' Previous response failed validation: '+payload['feedback']
 body={'model':'qwen-precision','messages':[{'role':'system','content':instruction},{'role':'user','content':'BASELINE (assistant-authored; revise this exact text):\n'+baseline}],'temperature':0.25,'max_tokens':900,'chat_template_kwargs':{'enable_thinking':False}}
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

def save(path,data):
 temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');os.replace(temporary,path)

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--file',type=Path,default=DEFAULT);parser.add_argument('--host',default='root@184.186.104.194');parser.add_argument('--port',type=int,default=11012);parser.add_argument('--count-only',action='store_true');parser.add_argument('--limit',type=int,default=150);parser.add_argument('--wait-seconds',type=int,default=1800);args=parser.parse_args()
 data=json.loads(args.file.read_text())
 if args.count_only:
  counts=remote({'mode':'count','scenes':data['scenes']},args);lookup={s['id']:s for s in counts}
  for scene in data['scenes']:scene['baselineTokens']=lookup[scene['id']]['baselineTokens']
  save(args.file,data);print(json.dumps({'counted':len(counts),'overBudget':[s['id'] for s in data['scenes'] if s['baselineTokens']['clip']>40]}),flush=True);return
 done=0;deadline=time.monotonic()+args.wait_seconds
 for scene in data['scenes']:
  if done>=args.limit:break
  baseline=scene['baselinePrompt'];sha=hashlib.sha256(baseline.encode()).hexdigest()
  if scene.get('precisionPrompt') and scene.get('revisionBaselineSha256')==sha:continue
  if scene.get('baselineTokens',{}).get('clip',999)>40:raise ValueError(scene['id']+' baseline exceeds40 or has no measured CLIP count')
  feedback='';success=False
  for attempt in range(4):
   while True:
    try:receipt=remote({'mode':'revise','baselinePrompt':baseline,'feedback':feedback},args);break
    except (RuntimeError,subprocess.TimeoutExpired) as error:
     scene['revisionStatus']='awaiting-qwen';scene['lastRevisionError']=str(error)[-500:];save(args.file,data)
     print(json.dumps({'scene':scene['id'],'status':'qwen-unavailable','error':str(error)[-250:]}),flush=True)
     if time.monotonic()>deadline:raise
     time.sleep(15)
   precision=receipt['response']['precisionPrompt'].strip();diff=independent_diff(baseline,precision)
   if receipt['precisionTokens']['clip']>77:feedback='Your revision measured '+str(receipt['precisionTokens']['clip'])+' actual CLIP tokens; reduce below77.';continue
   if precision==baseline or diff['unchangedRatio']>.94:feedback='Revision too similar; make concrete composition relationships explicit without adding content.';continue
   if receipt['finishReason']!='stop':feedback='Response was truncated. Return concise complete JSON.';continue
   scene.update({'precisionPrompt':precision,'precisionAuthor':'Qwen','precisionModel':receipt['model'],'precisionTokens':receipt['precisionTokens'],'baselineTokens':receipt['baselineTokens'],'revisionBaselineSha256':sha,'precisionSha256':hashlib.sha256(precision.encode()).hexdigest(),'revisionStatus':'qwen-revised-token-verified','semanticReviewStatus':'unreviewed','changes':receipt['response'].get('changes',[]),'qwenPossibleLostContent':receipt['response'].get('possibleLostContent',[]),'qwenPossibleAddedContent':receipt['response'].get('possibleAddedContent',[]),'independentDiff':diff,'revisionReceipt':{'responseId':receipt['responseId'],'usage':receipt['usage'],'finishReason':receipt['finishReason'],'requestedModel':'qwen-precision','baselineSha256':sha}})
   scene.pop('lastRevisionError',None);save(args.file,data);done+=1;success=True
   print(json.dumps({'scene':scene['id'],'status':scene['revisionStatus'],'baselineTokens':scene['baselineTokens'],'precisionTokens':scene['precisionTokens'],'revisedTotal':sum(bool(s.get('precisionPrompt')) for s in data['scenes'])}),flush=True);break
  if not success:
   scene['revisionStatus']='revision-validation-failed';scene['lastRevisionError']=feedback;save(args.file,data)
 print(json.dumps({'revisedThisRun':done,'applied':0}),flush=True)

if __name__=='__main__':main()
