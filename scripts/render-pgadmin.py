#!/usr/bin/env python3
"""Render pgAdmin's server and libpq credentials with the image's Python runtime."""

import argparse
import json
import os
from pathlib import Path
import tempfile


def publish(path: Path, content: str) -> None:
    """Publish a private, complete file on the destination filesystem."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=".opencw-", delete=False,
        ) as output:
            temporary = Path(output.name)
            output.write(content)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def render(root: Path) -> None:
    keys = ("DB_USER", "DB_PASSWORD", "DB_NAME", "PGADMIN_DEFAULT_EMAIL")
    values = {key: os.environ.get(key, "") for key in keys}
    for key, value in values.items():
        if not value or any(char in value for char in "\n\r\x00"):
            raise ValueError(f"{key} must be nonempty and contain no line breaks or NUL")
    login = (
        values["PGADMIN_DEFAULT_EMAIL"]
        .replace("@", "_").replace("/", "slash").replace("\\", "slash")
    )
    if login in (".", ".."):
        raise ValueError("PGADMIN_DEFAULT_EMAIL must identify a login directory")
    if login[0].isdigit():
        login = "pga_user_" + login
    storage = root / "storage" / login
    storage.mkdir(mode=0o700, parents=True, exist_ok=True)

    def pgpass(value: str) -> str:
        return value.replace("\\", "\\\\").replace(":", "\\:").replace("*", "\\*")

    credentials = ":".join(
        pgpass(values[key]) for key in ("DB_NAME", "DB_USER", "DB_PASSWORD")
    )
    publish(storage / ".pgpass", f"db:5432:{credentials}\n")
    server = {
        "Name": "DitPath", "Group": "Servers", "Host": "db", "Port": 5432,
        "Username": values["DB_USER"], "MaintenanceDB": values["DB_NAME"],
        "ConnectionParameters": {"sslmode": "prefer", "passfile": ".pgpass"},
    }
    publish(root / "servers.json", json.dumps({"Servers": {"1": server}}, indent=2) + "\n")


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        render(Path("/var/lib/pgadmin"))
    except (OSError, ValueError) as error:
        raise SystemExit(f"pgadmin-config: {error}") from error
    print("pgadmin-config: rendered servers.json and private .pgpass")
