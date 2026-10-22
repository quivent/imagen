#!/usr/bin/env python3
"""Restore Jay's pinned Qwen snapshot from R2, without loading a GPU model."""
import concurrent.futures
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import struct
import boto3

ROOT = Path('/workspace/artwork/judges/models/qwen3.8-27b-nvfp4')
PREFIX = 'hf-cache/hub/models--RadixArk--Qwen3.8-27B-NVFP4/'
REVISION = '319f741cce68d7914884900c138a1fbb70a42f30'

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / '.download.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        credentials = json.loads(Path('/workspace/artwork/r2/credentials.json').read_text())
        client = boto3.client('s3', endpoint_url=credentials['R2_ENDPOINT'],
            aws_access_key_id=credentials['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=credentials['R2_SECRET_ACCESS_KEY'], region_name='auto')
        bucket = credentials['R2_BUCKET']
        files = json.loads(client.get_object(Bucket=bucket, Key=PREFIX+'trees/'+REVISION+'.json')['Body'].read())['files']
        available = {o['Key'] for p in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=PREFIX+'blobs/') for o in p.get('Contents', [])}
        selected = [(name, meta) for name, meta in files.items() if PREFIX+'blobs/'+meta.get('lfs_sha256', meta['blob_id']) in available]
        required = {'config.json', 'tokenizer.json', 'tokenizer_config.json', 'model.safetensors.index.json'}
        required.update(name for name in files if name.endswith('.safetensors'))
        assert required <= {name for name, _ in selected}, 'R2 snapshot is incomplete'
        assert shutil.disk_usage(ROOT).free > sum(m['size'] for n,m in selected if not (ROOT/n).exists()) + 5*1024**3, 'Insufficient volume space'
        def download(item):
            name, meta = item
            target = ROOT / name
            assert target.parent == ROOT
            digest = meta.get('lfs_sha256', meta['blob_id'])
            def verified(path):
                if not path.exists() or path.stat().st_size != meta['size']: return False
                h = hashlib.sha256() if len(digest)==64 else hashlib.sha1()
                if len(digest)==40: h.update(('blob '+str(meta['size'])+'\0').encode())
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(8*1024*1024), b''): h.update(chunk)
                return h.hexdigest()==digest
            if not verified(target):
                temporary = target.with_suffix(target.suffix+'.partial')
                client.download_file(bucket, PREFIX+'blobs/'+digest, str(temporary))
                assert verified(temporary), 'Hash mismatch: '+name
                temporary.replace(target)
            print('Verified '+name, flush=True)
        print('Downloading pinned R2 snapshot: '+str(sum(m['size'] for _,m in selected))+' bytes', flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(download, selected))
        index = json.loads((ROOT/'model.safetensors.index.json').read_text())['weight_map']
        mtp = [k for k in index if 'mtp' in k.lower() or 'nextn' in k.lower()]
        assert mtp, 'No MTP tensors in checkpoint'
        for shard in set(index.values()):
            with (ROOT/shard).open('rb') as stream:
                header = json.loads(stream.read(struct.unpack('<Q',stream.read(8))[0]))
            assert all(k in header for k,v in index.items() if v==shard), 'Missing indexed tensor'
        print('Complete: all checkpoint files verified; '+str(len(mtp))+' MTP tensors present. No inference started.', flush=True)

if __name__ == '__main__':
    main()
