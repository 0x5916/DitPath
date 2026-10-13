#!/usr/bin/env python3
"""PGTune regression fixtures; no network, Docker daemon, or database changes."""

import importlib.util
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("operations", Path(__file__).with_name("test-operations.py"))
operations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operations)
BASH, COMPATIBILITY = operations.BASH, operations.COMPATIBILITY


class PGTune(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="opencw-pgtune-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for directory in ["bin", "cgroup", "db", "scripts/lib"]:
            (self.root/directory).mkdir(parents=True)
        for source in [*(REPO/"db").glob("*.sh"), *(REPO/"scripts").glob("*.sh"), REPO/"scripts/lib/common.sh"]:
            shutil.copy2(source, self.root/source.relative_to(REPO))
        tuner = self.root/"db/tune.sh"
        text = tuner.read_text()
        for original, target in [("/sys/fs/cgroup", "cgroup"), ("/proc/meminfo", "meminfo"), ("/dev/shm", "shm")]:
            text = text.replace(original, str(self.root/target))
        tuner.write_text(text)
        if COMPATIBILITY:
            common = self.root/"scripts/lib/common.sh"
            common.write_text(re.sub(r'if \(\( BASH_VERSINFO\[0\] < 4 \)\); then\n.*?\nfi\n', "", common.read_text(), count=1, flags=re.S))
        (self.root/"cgroup/cpu.max").write_text("800000 100000\n")
        (self.root/"cgroup/cpuset.cpus.effective").write_text("0-7\n")
        (self.root/"meminfo").write_text("MemTotal: 8388608 kB\n")
        (self.root/"docker-compose.yaml").write_text("# fixture only\n")
        (self.root/".env").write_text("POSTGRES_TUNE_MODE=pgtune\nPOSTGRES_MEMORY_LIMIT=2g\nPOSTGRES_CPU_LIMIT=2\n")
        for name, body in {
            "nproc": "printf '8\\n'",
            "docker": "printf '%s\\n' \"${OPENCW_POSTGRES_SHM_SIZE:-missing}\" > \"$DOCKER_EVENT\"",
            "docker-entrypoint.sh": "printf '%s\\n' \"$@\" > \"$ENTRY_ARGS\"",
        }.items():
            path = self.root/"bin"/name
            path.write_text("#!/bin/sh\n"+body+"\n"); path.chmod(0o755)
        self.env = dict(PATH=str(self.root/"bin")+":"+os.defpath, LC_ALL="C", ENV_FILE=str(self.root/".env"),
                        DOCKER_EVENT=str(self.root/"docker-event"), ENTRY_ARGS=str(self.root/"entry-args"))

    def run_tuner(self, *args, **values):
        return subprocess.run(["/bin/sh", str(self.root/"db/tune.sh"), *args], env=self.env|dict(
            POSTGRES_TUNE_MODE="pgtune", POSTGRES_MEMORY_LIMIT="2g", POSTGRES_CPU_LIMIT="2")|values,
            text=True, capture_output=True, timeout=5)

    def settings(self, **values):
        result = self.run_tuner("--print", **values)
        self.assertEqual(result.returncode, 0, result.stderr)
        return dict(arg.split("=", 1) for arg in shlex.split(result.stdout.splitlines()[-1]) if "=" in arg)

    def test_web_reference(self):
        settings = self.settings()
        for key, value in dict(max_connections="200", shared_buffers="512MB", effective_cache_size="1536MB",
                              maintenance_work_mem="128MB", work_mem="4096kB", wal_buffers="16MB",
                              min_wal_size="1024MB", max_wal_size="4096MB").items():
            self.assertEqual(settings[key], value, key)

    def test_profile_reference_cases(self):
        for profile, conn, buffers, cache, maintenance, work, minimum, maximum in [
            ("oltp", 300, 512, 1536, 128, 4096, 2048, 8192), ("dw", 40, 512, 1536, 256, 5461, 4096, 16384),
            ("desktop", 20, 128, 512, 128, 4096, 100, 2048), ("mixed", 100, 512, 1536, 128, 4096, 1024, 4096),
        ]:
            with self.subTest(profile=profile):
                actual = self.settings(POSTGRES_TUNE_PROFILE=profile)
                for key, value in dict(max_connections=str(conn), shared_buffers=f"{buffers}MB", effective_cache_size=f"{cache}MB",
                                      maintenance_work_mem=f"{maintenance}MB", work_mem=f"{work}kB",
                                      min_wal_size=f"{minimum}MB", max_wal_size=f"{maximum}MB").items():
                    self.assertEqual(actual[key], value, key)

    def test_optional_storage_size_and_connection_inputs(self):
        for storage, concurrency in [("hdd", "2"), ("ssd", "200"), ("san", "300"), ("nvme", "1000")]:
            with self.subTest(storage=storage):
                actual = self.settings(POSTGRES_TUNE_STORAGE=storage)
                self.assertEqual(actual["effective_io_concurrency"], concurrency)
                self.assertEqual(float(actual["random_page_cost"]), 4 if storage == "hdd" else 1.1)
        for size, work in [("less_ram", "6553kB"), ("greater_ram", "4536kB")]:
            self.assertEqual(self.settings(POSTGRES_MEMORY_LIMIT="4g", POSTGRES_TUNE_DB_SIZE=size)["work_mem"], work)
        self.assertEqual(self.settings(POSTGRES_MAX_CONNECTIONS="080")["max_connections"], "80")

    def test_invalid_inputs_fail_before_starting(self):
        for key, value in [("POSTGRES_TUNE_MODE", "unknown"), ("POSTGRES_MEMORY_LIMIT", ""), ("POSTGRES_MEMORY_LIMIT", "511m"),
                           ("POSTGRES_MEMORY_LIMIT", "99999999999999999999g"), ("POSTGRES_TUNE_PROFILE", "typo"),
                           ("POSTGRES_TUNE_STORAGE", "typo"), ("POSTGRES_TUNE_DB_SIZE", "typo"),
                           ("POSTGRES_MAX_CONNECTIONS", "3"), ("POSTGRES_MAX_CONNECTIONS", "262143"),
                           ("POSTGRES_MAX_CONNECTIONS", "two"), ("POSTGRES_TUNE_DISABLE", "1")]:
            with self.subTest(key=key, value=value):
                result = self.run_tuner("--print", **{key: value})
                self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.root/"entry-args").exists())

    def test_cpu_boundaries_and_legacy_modes(self):
        (self.root/"cgroup/cpuset.cpus.effective").write_text("0-1\n")
        actual = self.settings(POSTGRES_CPU_LIMIT="8")
        self.assertNotIn("max_worker_processes", actual)
        for mode in ["", "opencw"]:
            self.assertEqual(self.settings(POSTGRES_TUNE_MODE=mode)["max_connections"], "100")
        self.assertEqual(self.run_tuner("--print", POSTGRES_TUNE_MODE="off").stdout.splitlines()[-1], "")

    def test_ram_only_uses_detected_cpus(self):
        envfile = self.root/".env"
        envfile.write_text("POSTGRES_TUNE_MODE=pgtune\nPOSTGRES_MEMORY_LIMIT=2g\n# POSTGRES_CPU_LIMIT=2\n")
        result = subprocess.run([BASH, str(self.root/"scripts/tune.sh")], env=self.env,
                                cwd=self.root, text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("max_worker_processes=8", result.stdout)
        shutil.copy2(REPO/"Makefile", self.root/"Makefile")
        result = subprocess.run([shutil.which("make"), "tune"], env=self.env, cwd=self.root,
                                text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("max_connections=200", result.stdout); self.assertFalse((self.root/"docker-event").exists())

    def test_shm_policy_and_explicit_overrides(self):
        for values, expected in [({}, "256m"), ({"POSTGRES_MEMORY_LIMIT": "512m"}, "64m"),
                                 ({"POSTGRES_MEMORY_LIMIT": "64g"}, "2048m"), ({"POSTGRES_SHM_SIZE": "1gb"}, "1gb"),
                                 ({"POSTGRES_TUNE_MODE": "opencw"}, "2gb"), ({"POSTGRES_TUNE_MODE": "off"}, "2gb")]:
            with self.subTest(values=values):
                result = self.run_tuner("--shm", **values)
                self.assertEqual((result.returncode, result.stdout.strip()), (0, expected), result.stderr)

    def test_preview_and_compose_share_calculator_without_sourcing(self):
        envfile = self.root/".env"
        envfile.write_text(envfile.read_text()+"# POSTGRES_MAX_CONNECTIONS=40\nPOSTGRES_TUNE_STORAGE='san' # optional\nUNUSED=$(touch unsafe)\n")
        before = envfile.read_bytes()
        result = subprocess.run([BASH, str(self.root/"scripts/tune.sh"), "--env-file", str(envfile)],
                                env=self.env, cwd=self.root, text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("max_connections=200", result.stdout); self.assertIn("effective_io_concurrency=300", result.stdout)
        self.assertFalse((self.root/"unsafe").exists()); self.assertFalse((self.root/"docker-event").exists())
        self.assertEqual(envfile.read_bytes(), before)

        override = subprocess.run([BASH, str(self.root/"scripts/tune.sh"), "--env-file", str(envfile)],
                                  env=self.env|{"POSTGRES_MAX_CONNECTIONS": "40"}, cwd=self.root,
                                  text=True, capture_output=True, timeout=5)
        self.assertEqual(override.returncode, 0, override.stderr); self.assertIn("max_connections=40", override.stdout)
        result = subprocess.run([BASH, "-c", 'source "$1"; compose config', "fixture", str(self.root/"scripts/lib/common.sh")],
                                env=self.env, cwd=self.root, text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root/"docker-event").read_text().strip(), "256m")
        subprocess.run([BASH, "-c", 'source "$1"; compose config', "fixture", str(self.root/"scripts/lib/common.sh")],
                       env=self.env|{"POSTGRES_SHM_SIZE": "768m"}, cwd=self.root, capture_output=True, check=True)
        self.assertEqual((self.root/"docker-event").read_text().strip(), "768m")
        (self.root/"docker-event").unlink()
        envfile.write_text(before.decode().replace("POSTGRES_MEMORY_LIMIT=2g", "POSTGRES_MEMORY_LIMIT=${RAM:-2g}"))
        before = envfile.read_bytes()
        invalid = subprocess.run([BASH, str(self.root/"scripts/tune.sh")], env=self.env,
                                 cwd=self.root, text=True, capture_output=True, timeout=5)
        self.assertNotEqual(invalid.returncode, 0); self.assertFalse((self.root/"docker-event").exists())
        self.assertEqual(envfile.read_bytes(), before)

    def test_compose_survives_checkout_of_pre_tuning_revision(self):
        tuner = self.root/"db/tune.sh"
        tuner.write_text('#!/bin/sh\nif [ "$1" = --help ]; then echo "usage: tune.sh [--print]"; exit 0; fi\nexit 42\n')
        for missing, override, expected in [(False, "", "2gb"), (False, "768m", "768m"), (True, "1gb", "1gb")]:
            with self.subTest(missing=missing, override=override):
                if missing: tuner.unlink()
                result = subprocess.run([BASH, "-c", 'source "$1"; compose config', "fixture", str(self.root/"scripts/lib/common.sh")],
                                        env=self.env|{"POSTGRES_SHM_SIZE": override}, cwd=self.root,
                                        text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((self.root/"docker-event").read_text().strip(), expected)

    def test_runtime_args_and_last_override(self):
        result = self.run_tuner("postgres", "-c", "port=5544", POSTGRES_TUNE_EXTRA="-c work_mem=8MB")
        self.assertEqual(result.returncode, 0, result.stderr)
        args = (self.root/"entry-args").read_text().splitlines()
        self.assertEqual(args[:3], ["postgres", "-c", "port=5544"])
        self.assertIn("work_mem=4096kB", args); self.assertEqual(args[-2:], ["-c", "work_mem=8MB"])

    def test_real_validator_uses_selected_mode(self):
        credentials = dict(POSTGRES_USER="fixture", POSTGRES_PASSWORD="synthetic-password-long", POSTGRES_DB="fixture",
                           JWT_SECRET="YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=", RESEND_API_KEY="synthetic-key",
                           RESEND_FROM_EMAIL="fixture@example.com", CORS_ORIGINS="https://fixture.example",
                           PUBLIC_API_BASE="https://api.fixture.example/v1", PGADMIN_DEFAULT_EMAIL="fixture@example.com",
                           PGADMIN_DEFAULT_PASSWORD="synthetic-password-long")
        for values, code in [({}, 0), ({"POSTGRES_MEMORY_LIMIT": ""}, 1), ({"POSTGRES_TUNE_PROFILE": "typo"}, 1),
                             ({"POSTGRES_MAX_CONNECTIONS": "3"}, 1), ({"POSTGRES_TUNE_MODE": "off", "POSTGRES_MEMORY_LIMIT": "256m"}, 0)]:
            with self.subTest(values=values):
                result = subprocess.run([BASH, str(self.root/"scripts/check-env.sh"), "--quiet"],
                                        env=self.env|credentials|values, text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, code, result.stderr)


if __name__ == "__main__":
    print("Runtime: "+BASH+("; Bash3 compatibility copy (version guard removed)" if COMPATIBILITY else "; native Bash4+"), flush=True)
    unittest.main()
