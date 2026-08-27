from __future__ import annotations

import devtoolkit.clipboard as clipboard_module
from devtoolkit.clipboard import ClipboardHistoryService


def test_clipboard_history_keeps_latest_unique_text_within_memory_limit() -> None:
    service = ClipboardHistoryService(max_entries=2, max_bytes=8)

    service._append("first")
    service._append("first")
    service._append("second")
    service._append("third")

    snapshot = service.snapshot()
    assert [item["text"] for item in snapshot["items"]] == ["third", "second"]
    assert snapshot["enabled"] is True


def test_clipboard_history_truncates_large_text_and_supports_pause_clear_remove() -> None:
    service = ClipboardHistoryService(max_entries=3, max_bytes=8)
    service._append("0123456789")
    item_id = service.snapshot()["items"][0]["id"]

    snapshot = service.snapshot()
    assert snapshot["items"][0]["truncated"] is True
    assert len(snapshot["items"][0]["text"].encode("utf-8")) <= 8
    assert service.remove(item_id) is True
    assert service.remove(item_id) is False
    service._append("again")
    service.set_enabled(False)
    assert service.status()["enabled"] is False
    service.clear()
    assert service.snapshot()["items"] == []


def test_clipboard_monitor_records_each_new_sequence_once(monkeypatch) -> None:
    service = ClipboardHistoryService()
    sequences = iter([11, 11, 12])
    monkeypatch.setattr(clipboard_module, "_clipboard_sequence_number", lambda: next(sequences))
    monkeypatch.setattr(clipboard_module, "read_clipboard_text", lambda: "copied text")

    service.poll_once()
    service.poll_once()
    service.poll_once()

    assert [item["text"] for item in service.snapshot()["items"]] == ["copied text"]


def test_clipboard_monitor_captures_the_current_text_when_started(monkeypatch) -> None:
    service = ClipboardHistoryService(poll_seconds=60)
    monkeypatch.setattr(clipboard_module, "_clipboard_sequence_number", lambda: 19)
    monkeypatch.setattr(clipboard_module, "read_clipboard_text", lambda: "copied before launch")

    service.start()
    try:
        assert [item["text"] for item in service.snapshot()["items"]] == ["copied before launch"]
    finally:
        service.stop()
