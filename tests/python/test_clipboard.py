from __future__ import annotations

import base64
import struct

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
    monkeypatch.setattr(clipboard_module, "read_clipboard_item", lambda: None)
    monkeypatch.setattr(clipboard_module, "read_clipboard_text", lambda: "copied text")

    service.poll_once()
    service.poll_once()
    service.poll_once()

    assert [item["text"] for item in service.snapshot()["items"]] == ["copied text"]


def test_clipboard_monitor_captures_the_current_text_when_started(monkeypatch) -> None:
    service = ClipboardHistoryService(poll_seconds=60)
    monkeypatch.setattr(clipboard_module, "_clipboard_sequence_number", lambda: 19)
    monkeypatch.setattr(clipboard_module, "read_clipboard_item", lambda: None)
    monkeypatch.setattr(clipboard_module, "read_clipboard_text", lambda: "copied before launch")

    service.start()
    try:
        assert [item["text"] for item in service.snapshot()["items"]] == ["copied before launch"]
    finally:
        service.stop()


def test_clipboard_history_records_images_and_file_names_without_exposing_payloads() -> None:
    service = ClipboardHistoryService()
    png = clipboard_module.PNG_SIGNATURE + b"image-payload"
    service._append({"kind": "image", "format": "png", "data": png})
    service._append({"kind": "files", "paths": [r"C:\Users\kai\Desktop\report.docx", r"D:\images\photo.png"]})

    snapshot = service.snapshot()
    assert snapshot["items"][0]["kind"] == "files"
    assert snapshot["items"][0]["files"] == ["report.docx", "photo.png"]
    assert "paths" not in snapshot["items"][0]
    assert snapshot["items"][1] == {
        "id": snapshot["items"][1]["id"],
        "kind": "image",
        "imageBytes": len(png),
        "imageFormat": "png",
        "createdAt": snapshot["items"][1]["createdAt"],
    }
    assert service.image_data_url(snapshot["items"][1]["id"]) == "data:image/png;base64,iVBORw0KGgppbWFnZS1wYXlsb2Fk"


def test_clipboard_history_enforces_image_and_file_limits() -> None:
    service = ClipboardHistoryService()
    service._max_image_bytes = 12
    service._append({"kind": "image", "format": "png", "data": clipboard_module.PNG_SIGNATURE + b"too-large"})
    service._append({"kind": "image", "format": "png", "data": b"invalid"})
    service._append({"kind": "files", "paths": ["a" * 7000, "b" * 7000]})

    items = service.snapshot()["items"]
    assert len(items) == 1
    assert items[0]["kind"] == "files"
    assert items[0]["truncated"] is True
    assert items[0]["files"] == ["a" * 7000]


def test_clipboard_history_copy_restores_each_record_type(monkeypatch) -> None:
    service = ClipboardHistoryService()
    service._append("copied text")
    service._append({"kind": "image", "format": "png", "data": clipboard_module.PNG_SIGNATURE + b"image"})
    service._append({"kind": "files", "paths": [r"C:\temp\one.txt"]})
    copied: list[tuple[str, object]] = []
    monkeypatch.setattr(clipboard_module, "write_clipboard_text", lambda value: copied.append(("text", value)) or True)
    monkeypatch.setattr(clipboard_module, "write_clipboard_png", lambda value: copied.append(("image", value)) or True)
    monkeypatch.setattr(clipboard_module, "write_clipboard_files", lambda value: copied.append(("files", value)) or True)

    entries = {item["kind"]: item["id"] for item in reversed(service.snapshot()["items"])}
    assert service.copy_item(entries["text"]) is True
    assert service.copy_item(entries["image"]) is True
    assert service.copy_item(entries["files"]) is True
    assert copied == [
        ("text", "copied text"),
        ("image", clipboard_module.PNG_SIGNATURE + b"image"),
        ("files", [r"C:\temp\one.txt"]),
    ]


def test_clipboard_monitor_records_non_text_clipboard_items(monkeypatch) -> None:
    service = ClipboardHistoryService()
    monkeypatch.setattr(clipboard_module, "_clipboard_sequence_number", lambda: 23)
    monkeypatch.setattr(clipboard_module, "read_clipboard_item", lambda: {"kind": "files", "paths": [r"C:\temp\one.txt"]})
    monkeypatch.setattr(clipboard_module, "read_clipboard_text", lambda: "should not be used")

    service.poll_once()

    item = service.snapshot()["items"][0]
    assert item["kind"] == "files"
    assert item["files"] == ["one.txt"]


def test_clipboard_dib_preview_has_a_valid_bitmap_file_header() -> None:
    dib_header = struct.pack("<IiiHHIIiiII", 40, 1, 1, 1, 24, 0, 4, 0, 0, 0, 0)
    dib = dib_header + b"\0\0\0\0"
    bitmap = clipboard_module._dib_as_bmp(dib)

    assert bitmap is not None
    assert bitmap[:2] == b"BM"
    assert int.from_bytes(bitmap[2:6], "little") == len(bitmap)
    assert int.from_bytes(bitmap[10:14], "little") == 54
    assert bitmap[14:] == dib

    service = ClipboardHistoryService()
    service._append({"kind": "image", "format": "dibv5", "data": dib})
    item_id = service.snapshot()["items"][0]["id"]
    assert service.image_data_url(item_id) == f"data:image/bmp;base64,{base64.b64encode(bitmap).decode('ascii')}"


def test_clipboard_history_records_directories_as_copyable_paths() -> None:
    service = ClipboardHistoryService()
    service._append({"kind": "files", "paths": [r"C:\Users\kai\Desktop\Project"]})

    item = service.snapshot()["items"][0]
    assert item["kind"] == "files"
    assert item["files"] == ["Project"]
