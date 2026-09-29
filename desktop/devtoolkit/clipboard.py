from __future__ import annotations

import base64
import ctypes
import os
import struct
import sys
import threading
import time
from pathlib import PureWindowsPath
from typing import Any

CF_UNICODETEXT = 13
CF_DIB = 8
CF_HDROP = 15
CF_DIBV5 = 17
GMEM_MOVEABLE = 0x0002
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_CLIPBOARD_IMAGE_BYTES = 8 * 1024 * 1024
MAX_CLIPBOARD_HISTORY_BYTES = 32 * 1024 * 1024
MAX_CLIPBOARD_FILES = 256
MAX_CLIPBOARD_FILES_BYTES = 16 * 1024

if sys.platform == "win32":
    _USER32 = ctypes.WinDLL("user32", use_last_error=True)
    _KERNEL32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _SHELL32 = ctypes.WinDLL("shell32", use_last_error=True)
    _USER32.GetClipboardSequenceNumber.restype = ctypes.c_uint
    _USER32.OpenClipboard.argtypes = [ctypes.c_void_p]
    _USER32.OpenClipboard.restype = ctypes.c_bool
    _USER32.CloseClipboard.restype = ctypes.c_bool
    _USER32.GetClipboardData.argtypes = [ctypes.c_uint]
    _USER32.GetClipboardData.restype = ctypes.c_void_p
    _USER32.EmptyClipboard.restype = ctypes.c_bool
    _USER32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    _USER32.SetClipboardData.restype = ctypes.c_void_p
    _USER32.RegisterClipboardFormatW.argtypes = [ctypes.c_wchar_p]
    _USER32.RegisterClipboardFormatW.restype = ctypes.c_uint
    _KERNEL32.GlobalLock.argtypes = [ctypes.c_void_p]
    _KERNEL32.GlobalLock.restype = ctypes.c_void_p
    _KERNEL32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    _KERNEL32.GlobalUnlock.restype = ctypes.c_bool
    _KERNEL32.GlobalSize.argtypes = [ctypes.c_void_p]
    _KERNEL32.GlobalSize.restype = ctypes.c_size_t
    _KERNEL32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    _KERNEL32.GlobalAlloc.restype = ctypes.c_void_p
    _KERNEL32.GlobalFree.argtypes = [ctypes.c_void_p]
    _KERNEL32.GlobalFree.restype = ctypes.c_void_p
    _SHELL32.DragQueryFileW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_wchar), ctypes.c_uint]
    _SHELL32.DragQueryFileW.restype = ctypes.c_uint


def _clipboard_sequence_number() -> int:
    if sys.platform != "win32":
        return 0
    return int(_USER32.GetClipboardSequenceNumber())


def read_clipboard_text() -> str | None:
    """Read CF_UNICODETEXT for callers that specifically need text."""

    if sys.platform != "win32":
        return None
    # Another desktop process may hold the clipboard momentarily; retry before
    # deciding that this sequence contains no readable text.
    for attempt in range(3):
        if not _USER32.OpenClipboard(None):
            time.sleep(0.03 * (attempt + 1))
            continue
        try:
            handle = _USER32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return None
            pointer = _KERNEL32.GlobalLock(handle)
            if not pointer:
                return None
            try:
                return ctypes.wstring_at(pointer)
            finally:
                _KERNEL32.GlobalUnlock(handle)
        finally:
            _USER32.CloseClipboard()
    return None


def _read_global_clipboard_data(format_id: int) -> bytes | None:
    handle = _USER32.GetClipboardData(format_id)
    if not handle:
        return None
    size = int(_KERNEL32.GlobalSize(handle))
    if size <= 0 or size > MAX_CLIPBOARD_IMAGE_BYTES:
        return None
    pointer = _KERNEL32.GlobalLock(handle)
    if not pointer:
        return None
    try:
        return ctypes.string_at(pointer, size)
    finally:
        _KERNEL32.GlobalUnlock(handle)


def _read_clipboard_files(handle: int) -> tuple[list[str], bool]:
    count = int(_SHELL32.DragQueryFileW(handle, 0xFFFFFFFF, None, 0))
    paths: list[str] = []
    total_bytes = 2
    truncated = count > MAX_CLIPBOARD_FILES
    for index in range(count):
        if len(paths) >= MAX_CLIPBOARD_FILES:
            truncated = True
            break
        length = int(_SHELL32.DragQueryFileW(handle, index, None, 0))
        if not length:
            continue
        path_bytes = (length + 1) * 2
        if total_bytes + path_bytes > MAX_CLIPBOARD_FILES_BYTES:
            truncated = True
            break
        buffer = ctypes.create_unicode_buffer(length + 1)
        if _SHELL32.DragQueryFileW(handle, index, buffer, len(buffer)):
            paths.append(buffer.value)
            total_bytes += path_bytes
    return paths, truncated


def read_clipboard_item() -> dict[str, Any] | None:
    """Read one supported clipboard representation, preferring files and images."""

    if sys.platform != "win32":
        return None
    png_format = int(_USER32.RegisterClipboardFormatW("PNG"))
    for attempt in range(3):
        if not _USER32.OpenClipboard(None):
            time.sleep(0.03 * (attempt + 1))
            continue
        try:
            file_handle = _USER32.GetClipboardData(CF_HDROP)
            if file_handle:
                paths, truncated = _read_clipboard_files(file_handle)
                if paths:
                    return {"kind": "files", "paths": paths, "truncated": truncated}

            if png_format:
                image = _read_global_clipboard_data(png_format)
                if image and image.startswith(PNG_SIGNATURE):
                    return {"kind": "image", "format": "png", "data": image}

            for format_id, name in ((CF_DIBV5, "dibv5"), (CF_DIB, "dib")):
                image = _read_global_clipboard_data(format_id)
                if image and len(image) >= 40:
                    return {"kind": "image", "format": name, "data": image}

            text_handle = _USER32.GetClipboardData(CF_UNICODETEXT)
            if text_handle:
                pointer = _KERNEL32.GlobalLock(text_handle)
                if pointer:
                    try:
                        text = ctypes.wstring_at(pointer)
                    finally:
                        _KERNEL32.GlobalUnlock(text_handle)
                    if text:
                        return {"kind": "text", "text": text}
            return None
        finally:
            _USER32.CloseClipboard()
    return None


def write_clipboard_text(value: str) -> bool:
    if sys.platform != "win32" or not _USER32.OpenClipboard(None):
        return False
    memory = None
    try:
        if not _USER32.EmptyClipboard():
            return False
        buffer = ctypes.create_unicode_buffer(value)
        memory = _KERNEL32.GlobalAlloc(GMEM_MOVEABLE, ctypes.sizeof(buffer))
        if not memory:
            return False
        pointer = _KERNEL32.GlobalLock(memory)
        if not pointer:
            return False
        try:
            ctypes.memmove(pointer, buffer, ctypes.sizeof(buffer))
        finally:
            _KERNEL32.GlobalUnlock(memory)
        if not _USER32.SetClipboardData(CF_UNICODETEXT, memory):
            return False
        # Clipboard now owns the global-memory block.
        memory = None
        return True
    finally:
        if memory:
            _KERNEL32.GlobalFree(memory)
        _USER32.CloseClipboard()


def write_clipboard_png(value: bytes) -> bool:
    """Write a validated PNG stream under Windows' registered PNG clipboard format."""

    if sys.platform != "win32" or not value.startswith(PNG_SIGNATURE) or not _USER32.OpenClipboard(None):
        return False
    memory = None
    try:
        png_format = _USER32.RegisterClipboardFormatW("PNG")
        if not png_format or not _USER32.EmptyClipboard():
            return False
        memory = _KERNEL32.GlobalAlloc(GMEM_MOVEABLE, len(value))
        if not memory:
            return False
        pointer = _KERNEL32.GlobalLock(memory)
        if not pointer:
            return False
        try:
            ctypes.memmove(pointer, value, len(value))
        finally:
            _KERNEL32.GlobalUnlock(memory)
        if not _USER32.SetClipboardData(png_format, memory):
            return False
        # Clipboard owns the memory after SetClipboardData succeeds.
        memory = None
        return True
    finally:
        if memory:
            _KERNEL32.GlobalFree(memory)
        _USER32.CloseClipboard()


def _write_clipboard_bytes(format_id: int, value: bytes) -> bool:
    if sys.platform != "win32" or not value or not _USER32.OpenClipboard(None):
        return False
    memory = None
    try:
        if not _USER32.EmptyClipboard():
            return False
        memory = _KERNEL32.GlobalAlloc(GMEM_MOVEABLE, len(value))
        if not memory:
            return False
        pointer = _KERNEL32.GlobalLock(memory)
        if not pointer:
            return False
        try:
            ctypes.memmove(pointer, value, len(value))
        finally:
            _KERNEL32.GlobalUnlock(memory)
        if not _USER32.SetClipboardData(format_id, memory):
            return False
        memory = None
        return True
    finally:
        if memory:
            _KERNEL32.GlobalFree(memory)
        _USER32.CloseClipboard()


def write_clipboard_dib(value: bytes, image_format: str) -> bool:
    format_id = CF_DIBV5 if image_format == "dibv5" else CF_DIB if image_format == "dib" else 0
    return bool(format_id and len(value) >= 40 and _write_clipboard_bytes(format_id, value))


def write_clipboard_files(paths: list[str]) -> bool:
    if not paths or len(paths) > MAX_CLIPBOARD_FILES or any(not path or "\0" in path for path in paths):
        return False
    payload = struct.pack("<IiiII", 20, 0, 0, 0, 1) + ("\0".join(paths) + "\0\0").encode("utf-16le")
    if len(payload) > MAX_CLIPBOARD_FILES_BYTES + 20:
        return False
    return _write_clipboard_bytes(CF_HDROP, payload)


def _dib_as_bmp(value: bytes) -> bytes | None:
    if len(value) < 40:
        return None
    header_size = int.from_bytes(value[:4], "little")
    if header_size < 40 or header_size > len(value):
        return None
    bits_per_pixel = int.from_bytes(value[14:16], "little")
    compression = int.from_bytes(value[16:20], "little")
    colors_used = int.from_bytes(value[32:36], "little")
    pixel_offset = 14 + header_size
    if header_size == 40 and compression in (3, 6):
        pixel_offset += 12 if compression == 3 else 16
    if colors_used:
        pixel_offset += colors_used * 4
    elif bits_per_pixel <= 8:
        pixel_offset += (1 << bits_per_pixel) * 4
    if pixel_offset > 14 + len(value):
        return None
    file_size = 14 + len(value)
    return b"BM" + struct.pack("<IHHI", file_size, 0, 0, pixel_offset) + value


class ClipboardHistoryService:
    """Low-overhead sequence polling for process-memory clipboard history."""

    def __init__(self, max_entries: int = 100, max_bytes: int = 16 * 1024, poll_seconds: float = 0.35) -> None:
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._max_history_bytes = MAX_CLIPBOARD_HISTORY_BYTES
        self._max_image_bytes = MAX_CLIPBOARD_IMAGE_BYTES
        self._poll_seconds = poll_seconds
        self._lock = threading.RLock()
        self._items: list[dict[str, Any]] = []
        self._total_bytes = 0
        self._enabled = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_sequence = 0

    def start(self) -> None:
        if self._thread is not None:
            return
        # Capture the current Windows clipboard before the UI or tray is
        # visible so a value copied before launching KAITools is not missed.
        self.poll_once()
        self._thread = threading.Thread(target=self._run, name="kaitools-clipboard", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(2)
        self._thread = None
        with self._lock:
            self._items.clear()
            self._total_bytes = 0

    def set_enabled(self, enabled: bool) -> None:
        with self._lock:
            self._enabled = enabled
            if not enabled:
                self._last_sequence = _clipboard_sequence_number()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": self._enabled,
                "maxEntries": self._max_entries,
                "maxBytes": self._max_bytes,
                "items": [self._public_item(item) for item in reversed(self._items)],
            }

    def image_data_url(self, item_id: str) -> str | None:
        with self._lock:
            item = next((entry for entry in self._items if entry["id"] == item_id), None)
            if item is None or item["kind"] != "image":
                return None
            image_format = item["format"]
            data = item["data"]
        mime = "image/png"
        if image_format in ("dib", "dibv5"):
            data = _dib_as_bmp(data)
            mime = "image/bmp"
            if data is None:
                return None
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

    def copy_item(self, item_id: str) -> bool:
        with self._lock:
            item = next((dict(entry) for entry in self._items if entry["id"] == item_id), None)
        if item is None:
            return False
        if item["kind"] == "text":
            return write_clipboard_text(item["text"])
        if item["kind"] == "image":
            if item["format"] == "png":
                return write_clipboard_png(item["data"])
            return write_clipboard_dib(item["data"], item["format"])
        return write_clipboard_files(item["paths"])

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._total_bytes = 0

    def remove(self, item_id: str) -> bool:
        with self._lock:
            before = len(self._items)
            self._items = [item for item in self._items if item["id"] != item_id]
            self._recount_bytes()
            return len(self._items) != before

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {"enabled": self._enabled, "count": len(self._items), "maxEntries": self._max_entries}

    def _run(self) -> None:
        while not self._stop.wait(self._poll_seconds):
            self.poll_once()

    def poll_once(self) -> None:
        """Process one clipboard sequence; exposed for deterministic service tests."""

        with self._lock:
            enabled = self._enabled
        if not enabled:
            return
        sequence = _clipboard_sequence_number()
        if not sequence or sequence == self._last_sequence:
            return
        value = read_clipboard_item()
        if value is None:
            value = read_clipboard_text()
        self._last_sequence = sequence
        if value:
            self._append(value)

    def _append(self, value: str | dict[str, Any]) -> None:
        if isinstance(value, str):
            payload: dict[str, Any] = {"kind": "text", "text": value}
        elif isinstance(value, dict):
            payload = dict(value)
        else:
            return

        kind = payload.get("kind")
        if kind == "text":
            raw = str(payload.get("text", "")).encode("utf-8")
            truncated = len(raw) > self._max_bytes
            text = raw[: self._max_bytes].decode("utf-8", errors="ignore") if truncated else raw.decode("utf-8")
            payload = {"kind": "text", "text": text, "truncated": truncated}
        elif kind == "image":
            data = payload.get("data")
            image_format = payload.get("format")
            if not isinstance(data, bytes) or not isinstance(image_format, str) or image_format not in {"png", "dib", "dibv5"}:
                return
            invalid_image = not data.startswith(PNG_SIGNATURE) if image_format == "png" else len(data) < 40
            if invalid_image:
                return
            if len(data) > self._max_image_bytes:
                return
            payload = {"kind": "image", "format": image_format, "data": data}
        elif kind == "files":
            raw_paths = payload.get("paths")
            if not isinstance(raw_paths, list):
                return
            paths: list[str] = []
            byte_count = 2
            truncated = bool(payload.get("truncated", False))
            for path in raw_paths:
                if not isinstance(path, str) or not path or "\0" in path:
                    continue
                size = len(path.encode("utf-16le")) + 2
                if len(paths) >= MAX_CLIPBOARD_FILES or byte_count + size > MAX_CLIPBOARD_FILES_BYTES:
                    truncated = True
                    break
                paths.append(path)
                byte_count += size
            if not paths:
                return
            truncated = truncated or len(paths) < len(raw_paths)
            payload = {"kind": "files", "paths": paths, "truncated": truncated}
        else:
            return

        size = self._item_size(payload)
        with self._lock:
            if self._items and self._same_payload(self._items[-1], payload):
                return
            item = {
                **payload,
                "id": f"clip-{time.time_ns()}",
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self._items.append(item)
            self._total_bytes += size
            while len(self._items) > 1 and (
                len(self._items) > self._max_entries or self._total_bytes > self._max_history_bytes
            ):
                removed = self._items.pop(0)
                self._total_bytes -= self._item_size(removed)

    @staticmethod
    def _item_size(item: dict[str, Any]) -> int:
        if item["kind"] == "text":
            return len(item["text"].encode("utf-8"))
        if item["kind"] == "image":
            return len(item["data"])
        return sum(len(path.encode("utf-16le")) for path in item["paths"])

    @staticmethod
    def _same_payload(item: dict[str, Any], payload: dict[str, Any]) -> bool:
        kind = payload["kind"]
        if item["kind"] != kind:
            return False
        if kind == "text":
            return item["text"] == payload["text"]
        if kind == "image":
            return item["format"] == payload["format"] and item["data"] == payload["data"]
        return item["paths"] == payload["paths"]

    @staticmethod
    def _public_item(item: dict[str, Any]) -> dict[str, Any]:
        common = {"id": item["id"], "kind": item["kind"], "createdAt": item["createdAt"]}
        if item["kind"] == "text":
            return {**common, "text": item["text"], "truncated": item["truncated"]}
        if item["kind"] == "image":
            return {**common, "imageBytes": len(item["data"]), "imageFormat": item["format"]}
        names = [PureWindowsPath(path).name or os.path.basename(path) for path in item["paths"]]
        return {**common, "files": names, "truncated": item["truncated"]}

    def _recount_bytes(self) -> None:
        self._total_bytes = sum(self._item_size(item) for item in self._items)
