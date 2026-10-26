#!/usr/bin/env python3
"""Exercise the approved disposable API only; never print credentials or tokens."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "http://127.0.0.1:8081/v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="Private acceptance runtime directory (outside the checkout)")
    args = parser.parse_args()
    output = args.output_dir.expanduser().resolve()
    if Path(__file__).resolve().parents[2] in (output, *output.parents):
        parser.error("Keep acceptance credentials outside the source checkout")
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    credential_file = output / "accounts.json"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    evidence = {"base": BASE, "run_id": str(uuid.uuid4()), "checks": [], "passed": 0}

    def check(name, condition):
        evidence["checks"].append({"name": name, "passed": bool(condition)})
        print(json.dumps(evidence["checks"][-1]), flush=True)
        if not condition:
            raise AssertionError(name)
        evidence["passed"] += 1

    def request(method, route, body=None, token=None, status=200):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(BASE + route, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        for attempt in range(2):
            try:
                response = opener.open(req, timeout=20)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                code = response.code
                result = json.loads(response.read())
                retry = response.headers.get("Retry-After", "60")
            if code != 429 or attempt:
                break
            time.sleep(min(60, max(1, int(retry))) + 0.1)
        if status is not None and code != status:
            raise AssertionError(f"{method} {route.split('?')[0]}: HTTP {code}, expected {status}")
        return result if status is not None else (code, result)

    def login(account):
        return request("POST", "/auth/login", {"identifier": account["username"],
                                               "password": account["password"]})

    def drain(token, cursor="", limit=100):
        changes = []
        for _ in range(1000):
            query = urllib.parse.urlencode({"limit": limit, **({"cursor": cursor} if cursor else {})})
            page = request("GET", "/training/changes?" + query, token=token)
            changes.extend(page["changes"])
            cursor = page["next_cursor"]
            if not isinstance(cursor, str) or not cursor:
                raise AssertionError("Missing changes checkpoint")
            if not page["has_more"]:
                return changes, cursor
        raise AssertionError("Changes feed did not drain")

    try:
        check("health", request("GET", "/health")["status"] == "healthy")
        request("GET", "/training/changes", status=401)
        check("training route requires authentication", True)
        if credential_file.is_symlink():
            raise AssertionError("Acceptance credential file must not be a symlink")
        if credential_file.exists():
            os.chmod(credential_file, 0o600)
            accounts = json.loads(credential_file.read_text())
        else:
            accounts = {}
            for label in ("A", "B"):
                name = "ditpath" + label.lower() + secrets.token_hex(3)
                accounts[label] = {"username": name, "email": name + "@example.invalid",
                                   "password": secrets.token_urlsafe(24)}
            with os.fdopen(os.open(credential_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
                json.dump(accounts, file)
        if set(accounts) != {"A", "B"}:
            raise AssertionError("Expected exactly two reusable acceptance accounts")
        tokens = {}
        for label, account in accounts.items():
            code, pair = request("POST", "/auth/login", {"identifier": account["username"],
                                 "password": account["password"]}, status=None)
            if code == 401:
                pair = request("POST", "/auth/register", account)
            elif code != 200:
                raise AssertionError(f"Account {label} login HTTP {code}")
            tokens[label] = pair["access_token"]
            check(f"account {label} identity", request("GET", "/user/me", token=tokens[label])["username"] == account["username"])
            cw = {"char_wpm": 24 if label == "A" else 18, "eff_wpm": 12, "freq": 650 if label == "A" else 550, "start_delay": 0.5}
            page = {"language": "en", "cur_lesson": 2 if label == "A" else 3}
            request("POST", "/settings/cw", cw, tokens[label])
            request("POST", "/settings/page", page, tokens[label])
            tokens[label] = login(account)["access_token"]
            settings = request("GET", "/settings/all", token=tokens[label])
            check(f"account {label} settings survive new login", all(settings["cw_settings"][k] == v for k, v in cw.items()) and all(settings["page_settings"][k] == v for k, v in page.items()))
        a, b = tokens["A"], tokens["B"]
        _, checkpoint = drain(a)
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        practice_id, guided_id, event_id = (str(uuid.uuid4()) for _ in range(3))
        common = {"curriculum_version": "koch-39-v1", "lesson": 1, "status": "completed", "started_at": (now - dt.timedelta(minutes=1)).isoformat(), "ended_at": now.isoformat(), "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600}
        practice = {**common, "session_id": practice_id, "mode": "practice", "prompt_count": 1, "attempt_count": 1, "event_ids": [], "accuracy": 0.92, "scoring_version": "practice-copy-v1"}

        def sessions(records, token=a):
            return request("POST", "/training/sessions/batch", {"schema_version": 1, "client_id": str(uuid.uuid4()), "sessions": records}, token)

        before = request("GET", "/training/snapshot", token=a)
        result = sessions([practice, practice])
        check("practice duplicate IDs collapse", result["acknowledged_ids"] == [practice_id] and not result["rejected_sessions"])
        result = sessions([practice])
        check("identical practice retry acknowledged", result["acknowledged_ids"] == [practice_id] and not result["rejected_sessions"])
        after = request("GET", "/training/snapshot", token=a)
        # First history upload may seed course position from existing page settings.
        check("practice does not change mastery", before["character_masteries"] == after["character_masteries"])
        conflict = sessions([{**practice, "accuracy": 0.5}])
        rejected = conflict["rejected_sessions"]
        check("changed practice rejected permanently", not conflict["acknowledged_ids"] and len(rejected) == 1 and rejected[0]["error_code"] == "ID_CONFLICT" and rejected[0]["retryable"] is False)
        guided = {**common, "session_id": guided_id, "mode": "guided", "prompt_count": 2, "attempt_count": 1, "event_ids": [event_id]}
        missing = sessions([guided])
        check("missing evidence is retryable", not missing["acknowledged_ids"] and len(missing["rejected_sessions"]) == 1 and missing["rejected_sessions"][0]["error_code"] == "MISSING_SESSION_EVENTS" and missing["rejected_sessions"][0]["retryable"] is True)
        event = {"id": event_id, "session_id": guided_id, "prompt_id": str(uuid.uuid4()), "prompt_kind": "recall", "target_character": "K", "entered_text": "K", "is_correct": True, "classification": "automatic", "latency_ms": 1000, "replay_count": 0, "input_mode": "keyboard", "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600, "created_at": now.isoformat()}
        result = request("POST", "/training/events/batch", {"schema_version": 2, "client_id": str(uuid.uuid4()), "events": [event]}, a)
        check("strict guided event acknowledged", result["acknowledged_ids"] == [event_id] and not result["rejected_events"])
        result = sessions([guided])
        check("guided retry succeeds after evidence", result["acknowledged_ids"] == [guided_id] and not result["rejected_sessions"])
        second = login(accounts["A"])["access_token"]
        changes, checkpoint = drain(second, checkpoint, 1)
        identities = {(c["kind"], c["record"].get("session_id") if c["kind"] == "session" else c["record"]["id"]) for c in changes}
        check("second HTTP client receives exactly three unique changes", len(changes) == 3 and identities == {("session", practice_id), ("session", guided_id), ("attempt", event_id)} and all(isinstance(c["revision"], str) for c in changes) and len({c["revision"] for c in changes}) == 3)
        check("drained checkpoint has no duplicate changes", not drain(second, checkpoint)[0])
        request("GET", "/training/changes?" + urllib.parse.urlencode({"cursor": checkpoint}), token=b, status=400)
        check("cross-account cursor rejected", True)
        history_b = request("GET", "/training/sessions?limit=100&status=all", token=b)["sessions"]
        check("B cannot see A history", all(s["session_id"] not in (practice_id, guided_id) for s in history_b))
        check("same ID belongs independently to B", sessions([{**practice, "accuracy": 0.5}], b)["acknowledged_ids"] == [practice_id])
        history_a = request("GET", "/training/sessions?limit=100&status=all", token=a)["sessions"]
        matches = [s for s in history_a if s["session_id"] == practice_id]
        check("A has one immutable practice record", len(matches) == 1 and matches[0]["accuracy"] == 0.92)
        check("guided score derived from evidence", next(s for s in history_a if s["session_id"] == guided_id)["accuracy"] == 1)
        pair = login(accounts["B"])
        request("POST", "/auth/logout", {"refresh_token": pair["refresh_token"]})
        request("POST", "/auth/refresh", {"refresh_token": pair["refresh_token"]}, status=401)
        check("logout revokes refresh token", True)
        evidence["record_ids"] = {"practice": practice_id, "guided": guided_id, "attempt": event_id}
        evidence["complete"] = True
    except Exception as error:
        evidence["complete"] = False
        evidence["failure"] = str(error) if isinstance(error, AssertionError) else type(error).__name__
    (output / "api-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"passed": evidence["passed"], "complete": evidence["complete"], "evidence": str(output / "api-evidence.json")}))
    return 0 if evidence["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
