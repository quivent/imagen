#!/usr/bin/env python3
"""Resume pinned model downloads without fetching duplicate checkpoints."""

import argparse
import fnmatch
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import time


MODELS = {
    "flux1": {
        "repo": "black-forest-labs/FLUX.1-dev",
        "revision": "3de623fc3c33e44ffbe2bad470d0f45bccf2eb21",
        "allow_patterns": [
            "model_index.json", "scheduler/*", "text_encoder/*", "text_encoder_2/*",
            "tokenizer/*", "tokenizer_2/*", "transformer/*", "vae/*",
        ],
        "bytes": 33746383552,
    },
    "flux2": {
        "repo": "black-forest-labs/FLUX.2-dev",
        "revision": "26afe3a78bb242c0a8bb181dcc8937bb16e5c66c",
        "allow_patterns": [
            "model_index.json", "scheduler/*", "tokenizer/*", "transformer/*", "vae/*",
        ],
        "bytes": 64800155761,
    },
    "flux2-nf4": {
        "repo": "diffusers/FLUX.2-dev-bnb-4bit",
        "revision": "c30ad107542e63f222f864a8de510204394fb18a",
        "allow_patterns": ["text_encoder/*"],
        "bytes": 15437854403,
    },
}


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".download-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def inventory(path, patterns):
    return {
        file.relative_to(path).as_posix(): file.stat().st_size
        for file in sorted(path.rglob("*"))
        if file.is_file()
        and any(fnmatch.fnmatch(file.relative_to(path).as_posix(), p) for p in patterns)
    }


def completed(path, model):
    try:
        receipt = json.loads((path / ".download-complete.json").read_text())
        files = inventory(path, model["allow_patterns"])
        return (
            receipt.get("model") == model
            and receipt.get("files") == files
            and sum(files.values()) == model["bytes"]
        )
    except (OSError, ValueError, TypeError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/workspace/artwork"))
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    models_root = root / "models"
    models_root.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(root / "hf")
    # Library exception messages can include signed download URLs.
    logging.getLogger("huggingface_hub").setLevel(logging.CRITICAL)
    import fcntl
    from huggingface_hub import snapshot_download

    with (models_root / ".download.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        records = {}
        for name, model in MODELS.items():
            path = models_root / name
            print(f"{name}: checking {model['bytes'] / 1e9:.3f} GB", flush=True)
            if completed(path, model):
                print(f"{name}: complete local snapshot retained", flush=True)
            else:
                snapshot_download(
                    repo_id=model["repo"], revision=model["revision"],
                    allow_patterns=model["allow_patterns"], local_dir=str(path),
                    max_workers=8,
                )
                files = inventory(path, model["allow_patterns"])
                if sum(files.values()) != model["bytes"]:
                    raise ValueError(f"{name} snapshot size does not match inventory")
                atomic_json(path / ".download-complete.json", {
                    "model": model, "files": files, "completed_at": time.time(),
                })
                print(f"{name}: download complete", flush=True)
            records[name] = {**model, "path": str(path)}
        atomic_json(models_root / "manifest.json", {
            "schema": 1, "completed_at": time.time(), "models": records,
        })
        print("All model snapshots are ready", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Download interrupted; completed files are retained", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        detail = f" HTTP {status}" if isinstance(status, int) else ""
        print(f"Download stopped: {type(exc).__name__}{detail}; rerun to resume", file=sys.stderr)
        sys.exit(1)
