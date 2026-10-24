# syntax=docker/dockerfile:1

FROM dpage/pgadmin4:9.18.0

USER root
# Patch both the system decoder and the independent Python binding.
RUN apk add --no-cache "brotli-libs>=1.2.1" \
    && /venv/bin/python3 -m pip install --no-cache-dir --no-deps --only-binary=:all: "Brotli==1.2.1" \
    && /venv/bin/python3 -c "import importlib.metadata as m; assert m.version('Brotli') == '1.2.1'"

# Preserve the upstream unprivileged runtime identity and entrypoint.
USER 5050
