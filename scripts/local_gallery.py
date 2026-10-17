#!/usr/bin/env python3
"""Read only public artwork identity metadata from the local factory database."""
import json
import os
from pathlib import Path
import sqlite3


def main():
    state = Path(os.environ.get('ARTWORK_FACTORY_STATE',
        '/Users/jay/kinship-of-cancer/tools/artwork/.state')).resolve()
    connection = sqlite3.connect((state / 'queue.sqlite3').as_uri() + '?mode=ro', uri=True, timeout=2)
    connection.execute('PRAGMA query_only=ON')
    rows = {}
    for ident, scene, specification, scene_name in connection.execute(
        'SELECT j.id,j.scene,j.spec,s.name FROM jobs j '
        'LEFT JOIN scenes s ON s.id=j.scene LIMIT 100000'
    ):
        try:
            spec = json.loads(specification)
            rows[ident] = {'scene': scene, 'name': spec.get('name') or scene_name or '',
                           'model': spec.get('model')}
        except (ValueError, TypeError):
            continue
    connection.close()
    print(json.dumps(rows, separators=(',', ':')))


if __name__ == '__main__':
    main()
