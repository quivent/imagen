# Captured current worker configuration

Sanitized supervisor configuration and launchers captured2026-10-18. Provide credentials privately; redacted values are placeholders, never working credentials.

Current production uses FLUX1 on both GPUs. Qwen uses TP2 with MTP. Pixtral, Gemma and DINO remain resident. Preserve current manual service selection: the historical artwork-flux2 service is stopped while GPU1 serves FLUX1. Do not indiscriminately autostart every captured historical job or installer. Apply only the intended runtime services after provisioning dependencies and restoring the persistent volume.
