#!/usr/bin/env python3
"""Isolated regression checks: copied scripts, synthetic env/SQL, no live Docker."""

import gzip
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True


def select_bash():
    candidates = [os.environ.get("BASH_BIN"), shutil.which("bash"),
                  "/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/bin/bash"]
    available = []
    for path in dict.fromkeys(filter(None, candidates)):
        if Path(path).is_file():
            result = subprocess.run([path, "-c", 'echo "$BASH_VERSION"'],
                                    capture_output=True, text=True, check=True)
            if int(result.stdout.split(".")[0]) >= 4:
                return path, False
            available.append(path)
    if not available:
        raise RuntimeError("Bash is required to test the operational scripts")
    return available[0], True


BASH, COMPATIBILITY = select_bash()
STUB = r'''
from pathlib import Path
import json, os, sys, time
name, args = Path(sys.argv[0]).name, sys.argv[1:]
root = Path(os.environ["FIXTURE_ROOT"])
def event(kind, **extra):
    with (root/"events").open("a") as out:
        out.write(json.dumps(dict(kind=kind, args=args, **extra))+"\n")
def block(kind):
    if os.environ.get("BLOCK_"+kind):
        (root/("ready-"+kind)).touch()
        deadline = time.monotonic()+8
        while not (root/("release-"+kind)).exists():
            if time.monotonic()>deadline: sys.exit(9)
            time.sleep(.01)
if name == "bash": os.execv(os.environ["TEST_BASH"], [os.environ["TEST_BASH"]]+args)
elif name == "nproc": print("8")
elif name == "sleep": pass
elif name == "date":
    if args[-1] == "+%s":
        clock=root/"clock"; value=int(clock.read_text())+9 if clock.exists() else 0
        clock.write_text(str(value)); print(value)
    else: print(os.environ.get("STAMP", "20261006T000000Z"))
elif name == "find":
    for path in Path(args[0]).glob("opencw_*.sql.gz"):
        if path.is_file(): print(str(path.stat().st_mtime)+" "+str(path))
elif name == "stat":
    value=Path(args[-1]).stat(); print(value.st_size if "%s" in args else int(value.st_mtime))
elif name in ["curl", "wget"]: event(name); sys.exit(int(os.environ.get("HTTP_FAIL", "0")))
elif name == "gzip":
    if os.environ.get("GZIP_FAIL") and "-c" in args:
        sys.stdout.write("invalid prefix"); sys.exit(7)
    os.execv("/usr/bin/gzip", ["/usr/bin/gzip"]+args)
elif name == "git":
    event("git"); head=root/"head"; current=head.read_text() if head.exists() else "a"*40
    if args[0] == "rev-parse":
        if args[1:] == ["HEAD"]: print(current)
        elif "--abbrev-ref" in args: print("origin/main" if args[-1] != "HEAD" else "main")
        elif "--git-dir" in args: print(".git")
        elif "--verify" in args:
            ref=args[-1].replace("^{commit}", "")
            if ref not in ["main", "origin/main", "next", "a"*40, "b"*40]: sys.exit(1)
            print("b"*40 if ref in ["origin/main", "next", "b"*40] else current)
        else: print(current[:12])
    elif args[0] == "show-ref": sys.exit(0 if args[-1] in ["refs/heads/main", "refs/remotes/origin/main"] else 1)
    elif args[0] in ["merge", "pull"]: head.write_text("b"*40)
    elif args[0] == "checkout" and len(args[-1]) == 40: head.write_text(args[-1])
elif name == "docker":
    event("docker")
    if args[:1] == ["inspect"]:
        fmt, cid=args[2], args[-1]
        if ".State.Status" in fmt: print("exited" if cid.endswith("pgadmin-config") else "running")
        elif ".State.Health" in fmt:
            if os.environ.get("HEALTH_FAIL"): sys.exit(3)
            print("starting" if os.environ.get("STARTING") else "healthy")
        elif ".RestartCount" in fmt: print("2")
        elif ".Config.Image" in fmt: print("fixture-backend:latest" if cid.endswith("backend") else cid)
        elif ".Image" in fmt: print("sha256:new" if os.environ.get("IMAGE_MISMATCH") else "sha256:old")
    elif args[:2] == ["image", "inspect"]:
        if ".Id" in " ".join(args): print("sha256:old")
        elif ".RepoDigests" in " ".join(args): print(os.environ.get("IMAGE_DIGESTS", ""))
    elif args[:1] == ["tag"]:
        if os.environ.get("TAG_FAIL") and ":pre-" in args[1]: sys.exit(4)
    elif args[:1] == ["compose"]:
        cmd=args[1:]
        while cmd and cmd[0] in ["-f", "--env-file"]: cmd=cmd[2:]
        if cmd[:1] == ["config"]:
            if os.environ.get("COMPOSE_CONFIG_FAIL"): sys.exit(6)
            if "--environment" in cmd: print(os.environ.get("COMPOSE_ENV", ""))
            elif "--images" in cmd:
                images=json.loads(os.environ.get("COMPOSE_IMAGES", '{"backend":"fixture-backend:latest","db":"postgres:18"}'))
                selected=[arg for arg in cmd[1:] if not arg.startswith("--")]
                if selected and "backend" in selected and "db" not in selected: selected.append("db")
                print("\n".join(images[service] for service in selected) if selected else "\n".join(images.values()))
            else:
                print(os.environ.get("COMPOSE_CONFIG", "name: fixture\nservices:\n  backend:\n    build:\n      context: ./backend\n  db:\n    image: postgres:18\n"))
        elif cmd[:2] == ["ps", "-aq"]:
            print("fixture-"+cmd[2] if len(cmd)>2 else "fixture-db\nfixture-backend\nfixture-frontend\nfixture-pgadmin")
        elif cmd[:1] == ["up"] and "--build" in cmd and os.environ.get("BUILD_FAIL"): sys.exit(5)
        elif cmd[:1] == ["exec"]:
            shell=cmd[-1]
            if "pg_dumpall" in shell: event("globals-dump"); print("CREATE ROLE fixture_role;")
            elif "pg_dump" in shell:
                event("data-dump"); block("dump")
                if os.environ.get("DUMP_FAIL"): sys.exit(7)
                if not os.environ.get("EMPTY_DUMP"): print("CREATE TABLE fixture_table(id integer);")
            elif "dropdb" in shell: event("drop-create")
            elif "count(*)" in shell: print("0" if os.environ.get("RESTORE_ZERO") else "1")
            elif "printf" in shell and "POSTGRES_DB" in shell: print("fixture")
            elif "psql" in shell:
                sql=sys.stdin.read(); kind="globals-load" if "-d postgres" in shell else "data-load"
                event(kind, sql=sql); block("restore" if kind=="data-load" else "globals")
                if kind=="globals-load": (root/"roles-loaded").touch()
                if kind=="data-load" and (os.environ.get("RESTORE_FAIL") or
                    ("OWNER TO fixture_role" in sql and not (root/"roles-loaded").exists())): sys.exit(3)
else: sys.exit(2)
'''


class Operations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="morsestep-operations-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ["bin", "backups", "tmp", "scripts/lib", "cgroup"]:
            (self.root/directory).mkdir(parents=True)
        for source in [*(REPO/"scripts").rglob("*.sh"), *(REPO/"scripts/lib").glob("*.awk"), *(REPO/"db").glob("*.sh")]:
            target = self.root/source.relative_to(REPO)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        if COMPATIBILITY:
            common = self.root/"scripts/lib/common.sh"
            text, count = re.subn(r'if \(\( BASH_VERSINFO\[0\] < 4 \)\); then\n.*?\nfi\n',
                                 "", common.read_text(), count=1, flags=re.S)
            self.assertEqual(count, 1)
            common.write_text(text)
        # Operation fixtures inject validation; test the real Bash4 validator separately.
        validator = self.root/"scripts/check-env.sh"
        validator.write_text('#!/usr/bin/env bash\nexit "$VALIDATION_FAIL"\n')
        validator.chmod(0o755)
        (self.root/"docker-compose.yaml").write_text("# synthetic stack\n")
        (self.root/".env").write_text("POSTGRES_DB=fixture\nPGADMIN_PORT=5051 # UI\n")
        stub = self.root/"bin/stub"
        stub.write_text("#!"+sys.executable+"\n"+STUB)
        stub.chmod(0o755)
        for name in ["bash", "docker", "git", "curl", "wget", "find", "stat", "date", "sleep", "gzip", "nproc"]:
            (self.root/"bin"/name).symlink_to("stub")
        self.env = dict(PATH=str(self.root/"bin")+":"+os.defpath, LC_ALL="C",
                        FIXTURE_ROOT=str(self.root), TEST_BASH=BASH, TMPDIR=str(self.root/"tmp"),
                        ENV_FILE=str(self.root/".env"), BACKUP_DIR=str(self.root/"backups"),
                        VALIDATION_FAIL="0")

    def run_script(self, name, *args, **env):
        return subprocess.run([BASH, str(self.root/"scripts"/name), *map(str, args)],
                              cwd=self.root, env=self.env|env, text=True, capture_output=True, timeout=12)

    def shell(self, command, **env):
        return subprocess.run([BASH, "-c", 'set -euo pipefail; source "$1"; '+command,
                               "fixture", str(self.root/"scripts/lib/common.sh")],
                              cwd=self.root, env=self.env|env, text=True, capture_output=True, timeout=12)

    def events(self, kind=None):
        path = self.root/"events"
        rows = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        return [row for row in rows if kind is None or row["kind"] == kind]

    def dump(self, path=None, sql="CREATE TABLE old_table(id integer);\n"):
        path = path or self.root/"backups/opencw_old.sql.gz"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(sql.encode()))
        os.utime(path, (1000000000, 1000000000))
        return path

    def background(self, script, args, **env):
        proc = subprocess.Popen([BASH, str(self.root/"scripts"/script), *map(str, args)],
                                cwd=self.root, env=self.env|env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        def cleanup():
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.communicate(timeout=2)
        self.addCleanup(cleanup)
        return proc

    def ready(self, kind):
        deadline = time.monotonic()+5
        while not (self.root/("ready-"+kind)).exists():
            self.assertLess(time.monotonic(), deadline, "fixture never reached "+kind)
            time.sleep(.01)

    def test_backup_keep_zero_preserves_dumps(self):
        old = self.dump()
        result = self.run_script("backup.sh", "--keep", "00", "--print-path")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(old.exists())
        self.assertTrue(Path(result.stdout.strip()).exists())

    def test_failed_backup_never_publishes(self):
        for variable in ["GZIP_FAIL", "DUMP_FAIL", "EMPTY_DUMP"]:
            with self.subTest(variable=variable):
                result = self.run_script("backup.sh", "--no-globals", **{variable: "1"})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(list((self.root/"backups").iterdir()), [])

    def test_backup_lock_protects_running_job(self):
        proc = self.background("backup.sh", ["--no-globals", "--print-path"], BLOCK_dump="1")
        self.ready("dump")
        loser = self.run_script("backup.sh", "--no-globals")
        self.assertNotEqual(loser.returncode, 0)
        (self.root/"release-dump").touch()
        stdout, stderr = proc.communicate(timeout=10)
        self.assertEqual(proc.returncode, 0, stderr)
        self.assertTrue(Path(stdout.strip()).exists())
        self.assertEqual(len(self.events("data-dump")), 1)

    def test_backup_publishes_even_when_old_dump_has_future_mtime(self):
        old = self.dump()
        os.utime(old, (time.time()+86400, time.time()+86400))
        result = self.run_script("backup.sh", "--keep", "1", "--print-path")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(Path(result.stdout.strip()).exists())
        self.assertFalse(list((self.root/"backups").glob("*.restore-pin")))

    def test_restore_stages_before_retention(self):
        selected = self.dump()
        result = self.run_script("restore.sh", selected, "--keep", "1", "--no-globals", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("old_table", self.events("data-load")[0]["sql"])
        self.assertEqual(len(list((self.root/"backups").glob("*.sql.gz"))), 1)

    def test_corrupt_restore_stops_before_mutation(self):
        for kind in ["CRC", "empty", "invalid", "missing"]:
            with self.subTest(kind=kind):
                selected = self.dump()
                if kind == "CRC":
                    data = bytearray(selected.read_bytes()); data[-8] ^= 1; selected.write_bytes(data)
                elif kind == "empty": selected.write_bytes(gzip.compress(b""))
                elif kind == "invalid": selected.write_bytes(b"not gzip")
                else: selected.unlink()
                result = self.run_script("restore.sh", selected, "--yes")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(self.events(event) for event in ["data-dump", "drop-create", "data-load"]))

    def test_globals_precede_data_and_preserve_role_sql(self):
        external = self.dump(self.root/"external/opencw_roles.sql.gz",
                             "ALTER TABLE old_table OWNER TO fixture_role;\n")
        self.dump(external.parent/"globals/opencw_roles.globals.sql.gz", "CREATE ROLE fixture_role;\n")
        result = self.run_script("restore.sh", external, "--no-backup", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        kinds = [row["kind"] for row in self.events()]
        self.assertLess(kinds.index("globals-load"), kinds.index("drop-create"))
        self.assertIn("EXCEPTION WHEN duplicate_object", self.events("globals-load")[0]["sql"])

    def test_globals_preparation_preserves_comments_and_wraps_multiline_roles(self):
        selected = self.dump()
        globals_sql = ("COMMENT ON ROLE fixture_role IS 'owner notes\nCREATE ROLE harmless;\n';\n"
                       "-- CREATE ROLE example;\n/* CREATE ROLE example; */\n"
                       'CREATE ROLE "name\nwith a line";\n')
        self.dump(selected.parent/"globals/opencw_old.globals.sql.gz", globals_sql)
        result = self.run_script("restore.sh", selected, "--no-backup", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        prepared = self.events("globals-load")[0]["sql"]
        self.assertIn(globals_sql[:globals_sql.index('CREATE ROLE "name')], prepared)
        self.assertEqual(prepared.count("EXCEPTION WHEN duplicate_object"), 1)
        self.assertRegex(prepared, 'BEGIN\\s+CREATE ROLE "name\nwith a line";')

    def test_failed_restore_keeps_pinned_recovery(self):
        for index, variable in enumerate(["RESTORE_FAIL", "RESTORE_ZERO"]):
            with self.subTest(variable=variable):
                result = self.run_script("restore.sh", self.dump(), "--keep", "1", "--yes",
                                         STAMP=f"20261006T00000{index}Z", **{variable: "1"})
                self.assertNotEqual(result.returncode, 0)
                pins = list((self.root/"backups").glob("*.restore-pin"))
                self.assertEqual(len(pins), index+1)
                self.assertTrue(all(Path(str(pin).removesuffix(".restore-pin")).exists() for pin in pins))

    def test_unrelated_pruning_preserves_active_recovery(self):
        proc = self.background("restore.sh", [self.dump(), "--keep", "1", "--yes"], BLOCK_restore="1")
        self.ready("restore")
        pin = next((self.root/"backups").glob("*.restore-pin"))
        result = self.run_script("backup.sh", "--keep", "1", STAMP="20261006T000001Z")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(Path(str(pin).removesuffix(".restore-pin")).exists())
        (self.root/"release-restore").touch()
        _, stderr = proc.communicate(timeout=10)
        self.assertEqual(proc.returncode, 0, stderr)

    def test_globals_pruned_with_data(self):
        for index in range(3):
            result = self.run_script("backup.sh", "--keep", "1", STAMP=f"20261006T00000{index}Z")
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list((self.root/"backups").glob("*.sql.gz"))), 1)
        self.assertEqual(len(list((self.root/"backups/globals").glob("*.sql.gz"))), 1)

    def test_status_rejects_unknown_health(self):
        result = self.run_script("status.sh", "--skip-disk", HEALTH_FAIL="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("unknown", result.stdout+result.stderr)

    def test_healthy_historical_restarts_are_accepted(self):
        result = self.shell('wait_service_healthy db 08')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_decimal_timeout_expires(self):
        result = self.shell('wait_service_healthy db 08', STARTING="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("after 8s", result.stderr)
        self.assertNotIn("value too great for base", result.stderr)

    def test_wget_probe_discards_response_and_limits_attempts(self):
        result = self.shell('command() { if [[ "$*" == "-v curl" ]]; then return 1; fi; builtin command "$@"; }; http_ok https://fixture.invalid 5')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.events("wget")[0]["args"]
        self.assertIn("--tries=1", args)
        self.assertEqual(args[args.index("-O")+1], "/dev/null")
        self.assertFalse(self.events("curl"))

    def test_environment_and_compose_use_same_file(self):
        result = self.shell('printf "%s\\n" "$(env_get PGADMIN_PORT)"; compose config')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[0], "5051")
        args = self.events("docker")[-1]["args"]
        self.assertIn("--env-file", args)
        self.assertEqual(args[args.index("--env-file")+1], self.env["ENV_FILE"])
        result = self.shell('env_get POSTGRES_DB', POSTGRES_DB="process-value")
        self.assertEqual(result.stdout, "process-value")

    def test_numeric_options_reject_overflow(self):
        for value in ["9999999999", "-1", "1.5"]:
            with self.subTest(value=value):
                self.assertNotEqual(self.shell('parse_nonnegative_integer "$VALUE" fixture', VALUE=value).returncode, 0)

    def test_update_ref_cannot_name_a_file(self):
        (self.root/"version").write_text("tracked path\n")
        result = self.run_script("update.sh", "--ref", "version", "--no-backup", "--yes")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(row["args"][0] == "checkout" for row in self.events("git")))

    def test_update_advances_existing_branch(self):
        result = self.run_script("update.sh", "--ref", "main", "--no-backup", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root/"head").read_text(), "b"*40)

    def test_built_images_with_repository_digests_exclude_pulled_services(self):
        config = ("name: fixture\nservices:\n  backend:\n    build:\n      context: ./backend\n"
                  "    image: registry.example.test/backend:release\n    depends_on:\n      db:\n"
                  "        condition: service_healthy\n  frontend:\n"
                  "    build:\n      context: ./frontend\n  db:\n    image: postgres:18\n"
                  "  pgadmin:\n    image: dpage/pgadmin4:9\nnetworks:\n  default:\n    name: fixture_default\n")
        for default_image in ["fixture-frontend", "fixture-frontend:latest", "fixture_frontend:latest"]:
            with self.subTest(default_image=default_image):
                images = dict(backend="registry.example.test/backend:release", frontend=default_image,
                              db="postgres:18", pgadmin="dpage/pgadmin4:9")
                result = self.shell('built_stack_images', COMPOSE_CONFIG=config,
                                    COMPOSE_IMAGES=json.dumps(images), IMAGE_DIGESTS="fixture@sha256:old")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines(), [images["backend"], images["frontend"]])

    def test_digest_present_built_image_is_snapshotted_for_rollback(self):
        result = self.run_script("update.sh", "--ref", "next", "--no-backup", "--auto-rollback",
                                 "--yes", BUILD_FAIL="1", IMAGE_DIGESTS="fixture-backend@sha256:old")
        self.assertEqual(result.returncode, 1, result.stderr)
        tags = [row["args"][1:] for row in self.events("docker") if row["args"][0] == "tag"]
        self.assertEqual(tags, [["fixture-backend:latest", "fixture-backend:pre-20261006T000000Z"],
                                ["fixture-backend:pre-20261006T000000Z", "fixture-backend:latest"]])
        self.assertIn("previous images are running and healthy", result.stdout)

    def test_built_image_selection_propagates_config_failure(self):
        result = self.shell('built_stack_images', COMPOSE_CONFIG_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_rollback_stops_on_retag_failure(self):
        result = self.run_script("update.sh", "--ref", "next", "--no-backup", "--auto-rollback",
                                 "--yes", BUILD_FAIL="1", TAG_FAIL="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(any("--no-build" in row["args"] for row in self.events("docker")))
        self.assertNotIn("previous images are running and healthy", result.stdout)

    def test_rollback_verifies_image_identity(self):
        result = self.run_script("update.sh", "--ref", "next", "--no-backup", "--auto-rollback",
                                 "--yes", BUILD_FAIL="1", IMAGE_MISMATCH="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("not running the restored image", result.stderr)
        self.assertNotIn("previous images are running and healthy", result.stdout)

    def test_update_validation_precedes_mutations(self):
        result = self.run_script("update.sh", "--ref", "next", "--no-backup", VALIDATION_FAIL="1")
        self.assertEqual(result.returncode, 1)
        self.assertTrue(all(row["args"] == ["rev-parse", "--git-dir"] for row in self.events("git")))
        self.assertFalse(any("up" in row["args"] or "tag" in row["args"] for row in self.events("docker")))

    def test_rollback_success_verifies_old_images_and_head(self):
        result = self.run_script("update.sh", "--ref", "next", "--no-backup", "--auto-rollback",
                                 "--yes", BUILD_FAIL="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("previous images are running and healthy", result.stdout)
        self.assertEqual((self.root/"head").read_text(), "a"*40)
        self.assertTrue(any("{{.Image}}" in row["args"] for row in self.events("docker")))

    def test_env_quotes_literals_interpolation_and_relative_path(self):
        (self.root/".env").write_text("BARE=#literal\r\nQUOTED='value # literal' # comment\r\n"
                                     "LITERAL='$VALUE'\r\nEXPAND=$VALUE\r\n")
        for key, expected in [("BARE", "#literal"), ("QUOTED", "value # literal"),
                              ("LITERAL", "$VALUE"), ("EXPAND", "expanded")]:
            with self.subTest(key=key):
                result = self.shell('env_get "$KEY"', KEY=key, ENV_FILE=".env", COMPOSE_ENV="EXPAND=expanded")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, expected)
        self.assertEqual(Path(self.events("docker")[-1]["args"][2]).resolve(), (self.root/".env").resolve())

    @unittest.skipIf(COMPATIBILITY, "native Bash4 runtime unavailable; other operation/validator tests use guard-only compatibility copies")
    def test_native_bash4_runtime(self):
        result = subprocess.run([BASH, "-c", 'echo "$BASH_VERSION"'], capture_output=True, text=True, check=True)
        self.assertGreaterEqual(int(result.stdout.split(".")[0]), 4)

    def test_check_env_validates_normalized_and_bounded_numbers(self):
        shutil.copy2(REPO/"scripts/check-env.sh", self.root/"scripts/check-env.sh")
        values = dict(POSTGRES_USER="fixture", POSTGRES_PASSWORD="synthetic-password-long",
                      POSTGRES_DB="fixture", JWT_SECRET="YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=",
                      RESEND_API_KEY="synthetic-key", RESEND_FROM_EMAIL="fixture@example.com",
                      CORS_ORIGINS="https://fixture.example", PUBLIC_API_BASE="https://api.fixture.example/v1",
                      PGADMIN_DEFAULT_EMAIL="fixture@example.com", PGADMIN_DEFAULT_PASSWORD="synthetic-password",
                      POSTGRES_MEMORY_LIMIT="01024m", POSTGRES_MAX_CONNECTIONS="080", POSTGRES_HOST_MEMORY_SHARE="08")
        for extra, code in [({}, 0), ({"POSTGRES_MEMORY_LIMIT": "64m"}, 1),
                            ({"POSTGRES_MEMORY_LIMIT": "999999999999999999999999g"}, 1),
                            ({"POSTGRES_MAX_CONNECTIONS": "999999999999999999999999"}, 1)]:
            with self.subTest(extra=extra):
                result = self.run_script("check-env.sh", "--quiet", **(values|extra))
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertNotIn("value too great for base", result.stderr)

    def test_make_preserves_literal_arguments(self):
        shutil.copy2(REPO/"Makefile", self.root/"Makefile")
        marker = self.root/"should-not-exist"
        cases = [("restore", "FILE", "space and 'quote.sql.gz", "--file"),
                 ("restore", "FILE", "$(touch "+str(marker)+")", "--file"),
                 ("restore", "FILE", "$(shell touch "+str(marker)+")", "--file"),
                 ("update", "REF", "branch'; touch "+str(marker)+"; echo '", "--ref")]
        for target, key, value, flag in cases:
            with self.subTest(value=value):
                script = self.root/"scripts"/(target+".sh")
                script.write_text("#!"+sys.executable+"\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n")
                script.chmod(0o755)
                result = subprocess.run([shutil.which("make"), target, key+"="+value], cwd=self.root,
                                        env=self.env, capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), [flag, value])
                self.assertFalse(marker.exists())

    def test_pgadmin_renderer_escapes_credentials_and_private_files(self):
        spec = importlib.util.spec_from_file_location("renderer", REPO/"scripts/render-pgadmin.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        values = dict(DB_USER='user:*"\\quoted', DB_NAME='db:*"\\quoted', DB_PASSWORD='pass:*"\\quoted',
                      PGADMIN_DEFAULT_EMAIL='123:*"/\\quoted@example.com')
        destination = self.root/"pgadmin"; destination.mkdir()
        with patch.dict(os.environ, values, clear=True):
            module.render(destination)
        server = json.loads((destination/"servers.json").read_text())["Servers"]["1"]
        self.assertEqual(server["Username"], values["DB_USER"])
        self.assertEqual(server["MaintenanceDB"], values["DB_NAME"])
        self.assertEqual(server["ConnectionParameters"]["passfile"], ".pgpass")
        passfile = destination/"storage"/'pga_user_123:*"slashslashquoted_example.com'/".pgpass"
        escaped = [values[key].replace("\\", "\\\\").replace(":", "\\:").replace("*", "\\*")
                   for key in ["DB_NAME", "DB_USER", "DB_PASSWORD"]]
        self.assertEqual(passfile.read_text(), "db:5432:"+":".join(escaped)+"\n")
        for path in [passfile, destination/"servers.json"]:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        for key in values:
            for bad in ["", "bad\nvalue", "bad\rvalue"]:
                with self.subTest(key=key, bad=repr(bad)), patch.dict(os.environ, values|{key: bad}, clear=True):
                    with self.assertRaises(ValueError): module.render(destination)
        for login in [".", ".."]:
            with self.subTest(login=login), patch.dict(os.environ, values|{"PGADMIN_DEFAULT_EMAIL": login}, clear=True):
                with self.assertRaises(ValueError): module.render(destination)

    def test_tuner_limits_and_decimal_inputs(self):
        text = (REPO/"db/tune.sh").read_text()
        for original, replacement in [("/sys/fs/cgroup", self.root/"cgroup"),
                                      ("/proc/meminfo", self.root/"meminfo"),
                                      ("/dev/shm", self.root/"shm")]:
            text = text.replace(original, str(replacement))
        script = self.root/"tune.sh"; script.write_text(text)
        (self.root/"meminfo").write_text("MemTotal: 8388608 kB\n")
        cases = [
            ({"POSTGRES_MEMORY_LIMIT": "01024m", "POSTGRES_CPU_LIMIT": "08", "POSTGRES_MAX_CONNECTIONS": "080"}, 0, "1024 MiB"),
            ({"POSTGRES_MEMORY_LIMIT": "64m"}, 1, "supported 512 MiB minimum"),
            ({"POSTGRES_MEMORY_LIMIT": "512m"}, 0, "shared_buffers                   = 128MB"),
            ({"POSTGRES_MEMORY_LIMIT": "1g", "POSTGRES_CPU_LIMIT": "8"}, 0, "and 2 CPU(s)"),
            ({"POSTGRES_MEMORY_LIMIT": "1g", "POSTGRES_CPU_LIMIT": "1.000000000000000000000001"}, 0, "and 2 CPU(s)"),
            ({"POSTGRES_MEMORY_LIMIT": "99999999999999999999999g", "POSTGRES_MAX_CONNECTIONS": "99999999999999999999999"}, 0, "max_connections                  = 1000"),
        ]
        for variables, code, expected in cases:
            with self.subTest(variables=variables):
                (self.root/"cgroup/cpu.max").write_text("800000 100000\n")
                cpuset = self.root/"cgroup/cpuset.cpus.effective"
                cpuset.write_text("0-1\n" if variables.get("POSTGRES_MEMORY_LIMIT") == "1g" else "0-7\n")
                result = subprocess.run(["/bin/sh", str(script), "--print"], env=self.env|variables,
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(expected, result.stdout+result.stderr)


if __name__ == "__main__":
    print("Runtime: "+BASH+("; Bash3 compatibility copies: only version guard removed; "
          "native Bash4 unavailable (real validator tested in compatibility copy)" if COMPATIBILITY else "; native Bash4+"), flush=True)
    unittest.main()
