from __future__ import annotations

import sys
import threading
import time
import uuid

import pytest

import devtoolkit.single_instance as single_instance_module
from devtoolkit.single_instance import SingleInstance


@pytest.mark.skipif(sys.platform != "win32", reason="Windows named pipes and mutexes only")
def test_second_instance_notifies_first(monkeypatch) -> None:
    suffix = uuid.uuid4().hex
    monkeypatch.setattr(single_instance_module, "MUTEX_NAME", f"Local\\DevToolkit.Test.{suffix}")
    monkeypatch.setattr(single_instance_module, "PIPE_NAME", rf"\\.\pipe\DevToolkit.Test.{suffix}")
    activated = threading.Event()
    first = SingleInstance()
    second = SingleInstance()
    try:
        assert first.acquire_or_notify() is True
        first.listen(activated.set)
        time.sleep(0.1)
        assert second.acquire_or_notify() is False
        assert activated.wait(2)
    finally:
        second.close()
        first.close()
