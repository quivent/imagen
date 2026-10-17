"""Deterministic asset processing. No creative image edits or model calls."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(argv):
    result = subprocess.run(argv, capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError(f'{argv[0]} could not process the image')


def pixels(path, directory, width=None, height=None):
    webp, ppm = Path(directory) / 'probe.webp', Path(directory) / 'probe.ppm'
    args = ['cwebp', '-quiet', str(path)]
    if width:
        args += ['-resize', str(width), str(height)]
    run(args + ['-o', str(webp)])
    run(['dwebp', str(webp), '-quiet', '-ppm', '-o', str(ppm)])
    with ppm.open('rb') as stream:
        assert stream.readline().strip() == b'P6'
        line = stream.readline()
        while line.startswith(b'#'):
            line = stream.readline()
        w, h = map(int, line.split())
        if stream.readline().strip() != b'255' or w * h > 20_000_000:
            raise ValueError('Image exceeds the 20 megapixel processing limit')
        data = stream.read()
    if len(data) != w * h * 3:
        raise ValueError('Incomplete decoded image')
    return w, h, data


def fingerprint(path):
    with tempfile.TemporaryDirectory() as directory:
        _, _, data = pixels(path, directory, 9, 8)
    gray = [sum(data[i:i + 3]) / 3 for i in range(0, len(data), 3)]
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1])
    return f'{bits:016x}'


def process(source, directory, expected=None):
    source, directory = Path(source), Path(directory)
    if not source.is_file() or source.stat().st_size > 50_000_000:
        raise ValueError('Source must be an image file under 50 MB')
    directory.mkdir(parents=True, exist_ok=False)
    original = directory / ('original' + source.suffix.lower())
    shutil.copyfile(source, original)
    full, small = directory / 'full.webp', directory / 'small.webp'
    run(['cwebp', '-quiet', str(original), '-q', '82', '-m', '6', '-o', str(full)])
    with tempfile.TemporaryDirectory() as probe:
        width, height, _ = pixels(full, probe)
    if expected and (width, height) != tuple(expected):
        raise ValueError(f'Expected {expected[0]}×{expected[1]}, received {width}×{height}')
    run(['cwebp', '-quiet', str(original), '-q', '82', '-m', '6',
         '-resize', str(min(width, 640)), '0', '-o', str(small)])
    if max(full.stat().st_size, small.stat().st_size) > 3_000_000:
        raise ValueError('A WebP exceeds the 3 MB publication limit')
    return {'width': width, 'height': height, 'dhash': fingerprint(small),
            'files': {key: {'name': p.name, 'sha256': digest(p), 'bytes': p.stat().st_size}
                      for key, p in [('original', original), ('full', full), ('small', small)]}}
