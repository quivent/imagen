"""FP8 Mistral conditioning with verified, text-only pruning for FLUX.2."""
import gc
import hashlib
import json


def load_encoder(root, verify_prompt=None):
    import torch
    from diffusers import Flux2Pipeline
    from transformers import AutoConfig, AutoProcessor, CompressedTensorsConfig, Mistral3ForConditionalGeneration

    path = root / 'models/flux2-fp8'
    if not (path / '.download-complete.json').exists():
        raise RuntimeError('The pinned FP8 encoder download has not been verified')
    config = AutoConfig.from_pretrained(path, local_files_only=True)
    quantization = CompressedTensorsConfig.from_dict(config.quantization_config)
    quantization.use_optimized_inference = True
    quantization.dequantize = False
    quantization.post_init()
    encoder = Mistral3ForConditionalGeneration.from_pretrained(
        path, config=config, quantization_config=quantization,
        torch_dtype=torch.bfloat16, device_map={'': 'cuda:0'},
        attn_implementation='sdpa', local_files_only=True).eval()
    encoder.config.use_cache = False
    encoder.config.text_config.use_cache = False
    if encoder.generation_config is not None:
        encoder.generation_config.use_cache = False
    processor = AutoProcessor.from_pretrained(root / 'models/flux2/tokenizer', local_files_only=True)

    def conditioning():
        with torch.inference_mode():
            return Flux2Pipeline._get_mistral_3_small_prompt_embeds(
                text_encoder=encoder, tokenizer=processor, prompt=verify_prompt,
                device='cuda:0', max_sequence_length=512).detach()

    original = conditioning() if verify_prompt else None
    before = sum(parameter.numel() * parameter.element_size() for parameter in encoder.parameters())
    layers_before = len(encoder.model.language_model.layers)
    # Hidden-state 30 must remain an intermediate, unnormalized output. Keeping
    # layer 30 (31 layers total) avoids replacing it with the final layer norm.
    encoder.model.language_model.layers = torch.nn.ModuleList(list(encoder.model.language_model.layers[:31]))
    encoder.model.language_model.config.num_hidden_layers = 31
    encoder.config.text_config.num_hidden_layers = 31
    encoder.model.vision_tower = None
    encoder.model.multi_modal_projector = None
    encoder.lm_head = torch.nn.Identity()
    gc.collect()
    torch.cuda.empty_cache()
    verification = None
    if original is not None:
        pruned = conditioning()
        identical = torch.equal(original, pruned)
        verification = {'bitwise_identical': identical, 'shape': list(pruned.shape),
                        'conditioning_sha256': hashlib.sha256(pruned.cpu().view(torch.uint8).numpy().tobytes()).hexdigest()}
        if not identical:
            raise RuntimeError('Pruning changed FLUX.2 prompt conditioning')
        del original, pruned
    after = sum(parameter.numel() * parameter.element_size() for parameter in encoder.parameters())
    fp8_modules = sum(type(module).__name__ == 'CompressedTensorsFP8Linear' for module in encoder.modules())
    if not fp8_modules:
        raise RuntimeError('The text encoder did not retain optimized FP8 linear modules')
    gc.collect()
    torch.cuda.empty_cache()
    details = {'kind': 'fp8', 'optimized_fp8': True, 'fp8_linear_modules': fp8_modules,
               'kv_cache': False, 'max_sequence_length': 512,
               'decoder_layers_before': layers_before, 'decoder_layers_retained': 31,
               'vision_removed': True, 'vocabulary_head_removed': True,
               'parameter_bytes_before': before, 'parameter_bytes_after': after,
               'pruning_verification': verification,
               'checkpoint': json.loads((root / 'models/flux2-fp8.pins.json').read_text())['revision']}
    print(json.dumps({'event': 'fp8_encoder_ready', **details}), flush=True)
    return encoder, details
