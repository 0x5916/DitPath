# HTTP2Shell remediation contract

Status: approved by the owner on 2026-10-25 for the dependency-only fix and guarded rollout.

Production inspection on 2026-10-25 found Google Brotli 1.2.0 in the frontend OS image and pgAdmin OS/Python packages. CVE-2026-111497 affects that version. OpenCW serves static Nginx assets and a CGO-disabled Go API; no public app decoder path was found. pgAdmin urllib3 has Brotli response decoding enabled. Local Node is already 26.12.1/Brotli 1.2.1.

Upstream fixes: [Google Brotli 1.2.1](https://github.com/google/brotli/releases/tag/v1.2.1) and [Node 26.12.1](https://nodejs.org/en/blog/release/v26.12.1). The [runtime verifier](../scripts/tests/test-brotli-runtime.py) checks native patch presence and the HTTP client's actual decoder selection without attempting code execution against a service.

The official Node 26.12.1 image backports the fix while reporting Brotli 1.2.0. Verify the patched Node release and its `BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH` constant rather than treating that version banner alone as evidence of vulnerability.

## Approved scope

- Require native Brotli >=1.2.1 in the [frontend image](../frontend/Dockerfile).
- Pin the Node build stage to patched Node 26.12.1, preserving Node 26.
- Derive an OpenCW pgAdmin image from the same pgAdmin 9.18.0 base. Update only its existing system Brotli library and Python Brotli binding (1.2.1), with no dependency resolution or runtime user/entrypoint change.
- Use the [patched pgAdmin image](../pgadmin/Dockerfile) for pgAdmin and its configuration renderer in [production](../docker-compose.yaml) and [development](../backend/docker-compose.yaml) Compose.
- Preserve API schemas/endpoints, authentication semantics, database schema/data, secrets, ports, proxy trust, mounts, and volume names.

## Acceptance and rollout

- Check patched native and Python versions, valid/streaming Brotli decoding and urllib3 HTTP decoding; reject malformed/truncated streams in isolated, non-networked containers.
- Require frontend verify/lint/build and operations/renderer regressions to pass. Validate both Compose files without exposing resolved secrets.
- Review the final diff independently for bypasses and regressions.
- Commit the narrow patch separately from the existing lesson-layout commit. Push the exact tested revision.
- Preserve production Compose customizations. Take pinned database/globals, pgAdmin metadata, image and release-state recovery snapshots. Build before interruption; replace only frontend, pgAdmin and its one-shot renderer. Verify backend/database/tunnel identities remain unchanged, then verify local/public health and patched running versions. Roll back affected images on failure without automatic database restore.
