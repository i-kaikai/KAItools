from __future__ import annotations

import ctypes
import sys
import threading
import time
from typing import Any

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

if sys.platform == "win32":
    _USER32 = ctypes.WinDLL("user32", use_last_error=True)
    _KERNEL32 = ctypes.WinDLL("kernel32", use_last_error=True)
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
    _KERNEL32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    _KERNEL32.GlobalAlloc.restype = ctypes.c_void_p
    _KERNEL32.GlobalFree.argtypes = [ctypes.c_void_p]
    _KERNEL32.GlobalFree.restype = ctypes.c_void_p


def _clipboard_sequence_number() -> int:
    if sys.platform != "win32":
        return 0
    return int(_USER32.GetClipboardSequenceNumber())


def read_clipboard_text() -> str | None:
    """Read only CF_UNICODETEXT. Images and non-text formats are deliberately ignored."""

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


class ClipboardHistoryService:
    """Low-overhead sequence polling for process-memory text clipboard history."""

    def __init__(self, max_entries: int = 100, max_bytes: int = 16 * 1024, poll_seconds: float = 0.35) -> None:
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._poll_seconds = poll_seconds
        self._lock = threading.RLock()
        self._items: list[dict[str, Any]] = []
        self._enabled = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_sequence = 0

    def start(self) -> None:
        if self._thread is not None:
            return
        # Capture the current Windows text clipboard before the UI or tray is
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
                "items": [dict(item) for item in reversed(self._items)],
            }

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def remove(self, item_id: str) -> bool:
        with self._lock:
            before = len(self._items)
            self._items = [item for item in self._items if item["id"] != item_id]
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
        value = read_clipboard_text()
        self._last_sequence = sequence
        if value:
            self._append(value)

    def _append(self, value: str) -> None:
        raw = value.encode("utf-8")
        truncated = len(raw) > self._max_bytes
        if truncated:
            value = raw[: self._max_bytes].decode("utf-8", errors="ignore")
        with self._lock:
            if self._items and self._items[-1]["text"] == value:
                return
            self._items.append(
                {
                    "id": f"clip-{time.time_ns()}",
                    "text": value,
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "truncated": truncated,
                }
            )
            if len(self._items) > self._max_entries:
                del self._items[: len(self._items) - self._max_entries]
