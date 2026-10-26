"""Prepare the explicitly approved, separate test stack; never source an env file."""
import base64
import os
from pathlib import Path
import secrets
import sys

root = Path(sys.argv[1]).resolve()
if root != Path('/opt/ditpath-ui-acceptance'):
    raise SystemExit('Only the approved acceptance directory is supported')
if (root / 'source/REVISION').read_text().strip() != 'ac25e57':
    raise SystemExit('Source must be the approved revision ac25e57')
runtime = root / 'runtime'
runtime.mkdir(mode=0o700, exist_ok=True)
env = runtime / 'stack.env'
if not env.exists():
    # Exclusive creation preserves credentials and the test database on reruns.
    with open(env, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as f:
        f.write('SOURCE_REVISION=ac25e57\n')
        f.write(f'POSTGRES_PASSWORD={secrets.token_urlsafe(32)}\n')
        f.write(f'JWT_SECRET={base64.b64encode(secrets.token_bytes(48)).decode()}\n')
source = (root / 'source/frontend/nginx.conf').read_text()
anchor = '    location / {\n'
if source.count(anchor) != 1:
    raise SystemExit('Review changed nginx source before adding the test API proxy')
proxy = '''    # Acceptance only: same-origin API through the SSH-forwarded frontend.
    location /v1/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
    }

'''
target = runtime / 'nginx.conf'
rendered = source.replace(anchor, proxy + anchor)
if target.exists() and target.read_text() != rendered:
    raise SystemExit('Existing acceptance proxy differs; review before replacing it')
target.write_text(rendered)
print('Prepared isolated secrets and same-origin proxy; no services started.')
