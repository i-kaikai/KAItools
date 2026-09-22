from __future__ import annotations

import threading
import time

import scripts.verify_update_release as verifier
from devtoolkit.update_security import sha256_bytes


def test_verify_remote_objects_checks_every_object_with_bounded_workers(monkeypatch) -> None:
    workers = 2
    files = [
        {"path": f"file-{index}", "object": f"objects/{index}", "size": 1, "sha256": sha256_bytes(bytes([index]))}
        for index in range(8)
    ]
    payloads = {f"https://updates.example/downloads/kaitools/objects/{index}": bytes([index]) for index in range(8)}
    active = 0
    peak_active = 0
    fetched: list[str] = []
    lock = threading.Lock()

    def fake_fetch(url: str) -> bytes:
        nonlocal active, peak_active
        with lock:
            active += 1
            peak_active = max(peak_active, active)
            fetched.append(url)
        time.sleep(0.01)
        with lock:
            active -= 1
        return payloads[url]

    monkeypatch.setattr(verifier, "REMOTE_VERIFY_WORKERS", workers)
    monkeypatch.setattr(verifier, "fetch", fake_fetch)

    verifier.verify_remote_objects("https://updates.example/downloads/kaitools/latest.json", files)

    assert sorted(fetched) == sorted(payloads)
    assert peak_active == workers
