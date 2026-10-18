#!/usr/bin/env python3
"""Shared editable controls for future paired requests, never in-flight images."""
import argparse
import fcntl
import json
from pathlib import Path
import uuid
import prompt_clarity as study
from study_controller import atomic

def validate(value):
    if not isinstance(value,dict) or set(value)!={'width','height','steps','guidance_scale','max_sequence_length'}:
        raise ValueError('Incomplete study settings')
    sizes={(s,s) for s in (512,768,1024)}|{(s*3//2,s) for s in (512,768,1024)}|{(s,s*3//2) for s in (512,768,1024)}
    if type(value['width']) is not int or type(value['height']) is not int or (value['width'],value['height']) not in sizes:
        raise ValueError('Select a supported output size and frame')
    if type(value['steps']) is not int or value['steps'] not in (16,28,36):raise ValueError('Select a FLUX1 step count')
    if type(value['guidance_scale']) not in (int,float) or value['guidance_scale'] not in (2,3.5,5):raise ValueError('Select a supported guidance')
    if type(value['max_sequence_length']) is not int or value['max_sequence_length']!=512:raise ValueError('Select a supported conditioning limit')
    return dict(value)

def read(root,fallback):
    file=Path(root)/'settings.json'
    try:return json.loads(file.read_text())
    except FileNotFoundError:return {'revision':None,'settings':dict(fallback)}

def save(root,value):
    settings=validate(value);directory=Path(root);directory.mkdir(parents=True,exist_ok=True)
    with (directory/'settings.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        result={'revision':str(uuid.uuid4()),'settings':settings,'application':'Next complete production/precision pair on each worker'}
        atomic(directory/'settings.json',result)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=study.DEFAULT_ROOT);parser.add_argument('action',choices=['set']);args=parser.parse_args()
    import sys
    print(json.dumps(save(args.root,json.load(sys.stdin))))
if __name__=='__main__':main()
