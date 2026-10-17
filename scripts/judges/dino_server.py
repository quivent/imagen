#!/usr/bin/env python3
"""Resident DINOv2 embeddings for the Imagen feedback loop, loopback only."""
import base64
import binascii
from contextlib import asynccontextmanager
from io import BytesIO
import os
from pathlib import Path
import threading

from fastapi import FastAPI, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
import torch
from transformers import AutoImageProcessor, AutoModel

MODEL = "dinov2-giant"
REVISION = "611a9d42f2335e0f921f1e313ad3c1b7178d206d"
MODEL_PATH = Path(os.environ.get("DINO_MODEL_PATH", "/workspace/artwork/judges/models/dinov2"))
MAX_ENCODED = 16 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_777_216
state = {}
inference_lock = threading.Lock()


def decode_image(value):
    if not isinstance(value, str) or len(value) > MAX_ENCODED:
        raise HTTPException(422, "Expected an image data URI of at most 16 MiB")
    if not value.startswith("data:image/") or ";base64," not in value:
        raise HTTPException(422, "Only base64 image data URIs are accepted")
    try:
        raw = base64.b64decode(value.split(",", 1)[1], validate=True)
        with Image.open(BytesIO(raw)) as image:
            if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                raise HTTPException(422, "Image exceeds 16 megapixels")
            return image.convert("RGB")
    except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, "Invalid or oversized image") from None


def embeddings(images):
    with inference_lock, torch.inference_mode():
        batch = state["processor"](images=images, return_tensors="pt").to("cuda:0")
        batch["pixel_values"] = batch["pixel_values"].to(torch.float16)
        output = state["model"](**batch).last_hidden_state[:, 0, :].float()
        output = torch.nn.functional.normalize(output, dim=-1)
        if not torch.isfinite(output).all():
            raise RuntimeError("DINO returned non-finite embeddings")
        return output.cpu()


@asynccontextmanager
async def lifespan(app):
    torch.set_num_threads(4)
    state["processor"] = AutoImageProcessor.from_pretrained(MODEL_PATH, local_files_only=True)
    state["model"] = AutoModel.from_pretrained(
        MODEL_PATH, local_files_only=True, dtype=torch.float16,
    ).to("cuda:0").eval()
    embeddings([Image.new("RGB", (224, 224), "gray")])
    yield
    state.clear()


app = FastAPI(title="Imagen DINO feedback", lifespan=lifespan)
from seer_observer import SeerObserver
app.add_middleware(SeerObserver, model_id="dinov2")


class EmbeddingRequest(BaseModel):
    model: str = MODEL
    input: str | list[str]
    encoding_format: str = "float"


class CompareRequest(BaseModel):
    image_a: str = Field(max_length=MAX_ENCODED)
    image_b: str = Field(max_length=MAX_ENCODED)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "revision": REVISION,
            "physical_gpu": os.environ.get("CUDA_VISIBLE_DEVICES"),
            "device": str(next(state["model"].parameters()).device),
            "dimensions": state["model"].config.hidden_size,
            "meaning": "Normalized CLS visual features; similarity is not an aesthetic score"}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "facebook"}]}


@app.post("/v1/embeddings")
def embed(request: EmbeddingRequest):
    if request.model != MODEL or request.encoding_format != "float":
        raise HTTPException(422, "Use model dinov2-giant and float encoding")
    values = [request.input] if isinstance(request.input, str) else request.input
    if not 1 <= len(values) <= 2:
        raise HTTPException(422, "Supply one or two image data URIs")
    vectors = embeddings([decode_image(value) for value in values]).tolist()
    return {"object": "list", "model": MODEL, "revision": REVISION,
            "data": [{"object": "embedding", "index": i, "embedding": vector}
                     for i, vector in enumerate(vectors)]}


@app.post("/v1/compare")
def compare(request: CompareRequest):
    vectors = embeddings([decode_image(request.image_a), decode_image(request.image_b)])
    similarity = max(-1.0, min(1.0, float(torch.dot(vectors[0], vectors[1]))))
    return {"model": MODEL, "revision": REVISION, "cosine_similarity": similarity,
            "cosine_distance": 1.0 - similarity,
            "meaning": "Visual feature distance, not an aesthetic or quality score"}
