#!/usr/bin/env python3
"""Local artwork factory. Run --help for operator and agent commands."""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import threading

from store import Store
from workers import builtin_packet, run_workers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', default=os.environ.get('ARTWORK_STATE', os.environ.get('ARTWORK_FACTORY_STATE', str(Path(__file__).parent / '.state'))))
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status')
    p = commands.add_parser('import-atlas')
    p.add_argument('manifest')
    p.add_argument('--repo', default=str(Path(__file__).resolve().parents[2]))
    p = commands.add_parser('enqueue')
    p.add_argument('file', help='JSON request or list of requests; - reads stdin')
    p = commands.add_parser('next', help='Claim built-in jobs and emit tool handoff packets')
    p.add_argument('--count', type=int, default=1)
    p.add_argument('--worker', default='codex')
    p = commands.add_parser('complete')
    p.add_argument('job'); p.add_argument('token'); p.add_argument('source')
    p.add_argument('--cost', type=float); p.add_argument('--currency')
    p.add_argument('--receipt-json', help='Generation provenance as JSON, without image data or credentials')
    p = commands.add_parser('beat')
    p.add_argument('job'); p.add_argument('token')
    p = commands.add_parser('remote', help='Recover a known remote request without resubmission')
    p.add_argument('job'); p.add_argument('token'); p.add_argument('request_id')
    p = commands.add_parser('retry')
    p.add_argument('job'); p.add_argument('--reason', required=True)
    p = commands.add_parser('cancel')
    p.add_argument('job'); p.add_argument('--reason', required=True)
    p = commands.add_parser('review')
    p.add_argument('version'); p.add_argument('decision', choices=['accepted', 'rejected'])
    p.add_argument('--note', required=True); p.add_argument('--reviewer', default='operator')
    p.add_argument('--replace', help='Current selected version, acknowledged explicitly')
    p = commands.add_parser('similar')
    p.add_argument('version')
    p = commands.add_parser('export')
    p.add_argument('name'); p.add_argument('--pending', action='store_true')
    p = commands.add_parser('backup')
    p.add_argument('name')
    p = commands.add_parser('worker')
    p.add_argument('--backend', choices=['bfl', 'command'], required=True)
    p.add_argument('--concurrency', type=int, default=6)
    p.add_argument('--once', action='store_true')
    p.add_argument('--argv', help='JSON file containing a command argument array; no shell evaluation')
    p.add_argument('--model', help='Claim only requests for this model')
    p = commands.add_parser('serve')
    p.add_argument('--port', type=int, default=48620)
    args = parser.parse_args()
    store = Store(args.state)
    result = None
    if args.command == 'status':
        result = store.snapshot()
    elif args.command == 'import-atlas':
        result = {'imported': store.import_atlas(args.manifest, args.repo)}
    elif args.command == 'enqueue':
        data = json.loads(sys.stdin.read() if args.file == '-' else Path(args.file).read_text())
        result = [store.enqueue(r) for r in (data if isinstance(data, list) else [data])]
    elif args.command == 'next':
        if not 1 <= args.count <= 16:
            raise ValueError('Count must be between 1 and 16')
        result = []
        for _ in range(args.count):
            row = store.claim('builtin', args.worker)
            if not row:
                break
            packet = builtin_packet(row)
            directory = store.root / 'handoffs'
            directory.mkdir(exist_ok=True)
            path = directory / (row['id'] + '-' + row['attempt'] + '.json')
            path.write_text(json.dumps(packet, ensure_ascii=False, indent=2) + '\n')
            packet['receiptFile'] = str(path)
            result.append(packet)
    elif args.command == 'complete':
        result = {'version': store.complete(args.job, args.token, args.source, args.cost, args.currency,
                                           json.loads(args.receipt_json) if args.receipt_json else None)}
    elif args.command == 'beat':
        store.beat(args.job, args.token)
    elif args.command == 'remote':
        store.submitted(args.job, args.token, {'id': args.request_id})
        store.defer(args.job, args.token, 'Recovered remote receipt', 0)
    elif args.command == 'retry':
        store.retry(args.job, args.reason)
    elif args.command == 'cancel':
        store.cancel(args.job, args.reason)
    elif args.command == 'review':
        store.review(args.version, args.decision, args.note, args.reviewer, args.replace)
    elif args.command == 'similar':
        result = store.similar(args.version)
    elif args.command == 'export':
        result = {'directory': store.export(args.name, args.pending)}
    elif args.command == 'backup':
        result = {'directory': store.backup(args.name)}
    elif args.command == 'worker':
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())
        run_workers(store, args.backend, args.concurrency, args.once,
                    json.loads(Path(args.argv).read_text()) if args.argv else None, stop, args.model)
    elif args.command == 'serve':
        from service import serve
        serve(store, args.port)
    print(json.dumps(result if result is not None else {'ok': True}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError) as exc:
        print(json.dumps({'problem': str(exc)}), file=sys.stderr)
        sys.exit(1)
