#!/usr/bin/env python3
"""Imagen's isolated artwork research CLI, backed by the captured factory core."""
import os
from pathlib import Path
import runpy
import sys


def main():
    repo = Path(__file__).resolve().parents[2]
    core = repo/'deployment/controller/tools/artwork'
    arguments = sys.argv[1:]
    # Never inherit the production factory's state through ARTWORK_FACTORY_STATE
    # or ARTWORK_STATE. An explicit --state remains available for planned work.
    if not any(value == '--state' or value.startswith('--state=') for value in arguments):
        state = os.environ.get('ARTWORK_RESEARCH_STATE', str(repo/'.runtime/artwork-research'))
        arguments = ['--state', state, *arguments]
    sys.path.insert(0, str(core))
    sys.argv = [str(core/'artwork.py'), *arguments]
    runpy.run_path(str(core/'artwork.py'), run_name='__main__')


if __name__ == '__main__':
    main()
