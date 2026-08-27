from __future__ import annotations

import ctypes
import re
import threading
from ctypes import wintypes
from collections.abc import Callable


DEFAULT_ACTIVATION_HOTKEY = "Ctrl+Alt+K"
HOTKEY_ID = 0x4B41
WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
PM_NOREMOVE = 0x0000

MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000

_KEY_PATTERN = re.compile(r"^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$")
_MODIFIER_ORDER = (("Ctrl", MOD_CONTROL), ("Alt", MOD_ALT), ("Shift", MOD_SHIFT))


class HotkeyError(RuntimeError):
    """Raised when an activation shortcut is malformed or already reserved."""


def normalize_activation_hotkey(value: object) -> str:
    """Return the canonical shortcut representation accepted by both UI and desktop host.

    System-wide shortcuts intentionally require Ctrl or Alt. This keeps accidental
    single-key registration out of the application and avoids a keyboard hook.
    """

    if not isinstance(value, str):
        raise HotkeyError("唤起快捷键格式无效")
    tokens = [token.strip().lower() for token in value.split("+") if token.strip()]
    if len(tokens) < 2 or len(tokens) > 4:
        raise HotkeyError("唤起快捷键需要组合键，例如 Ctrl+Alt+K")

    modifiers = set(tokens[:-1])
    key = tokens[-1].upper()
    if len(modifiers) != len(tokens) - 1 or modifiers - {"ctrl", "alt", "shift"}:
        raise HotkeyError("唤起快捷键仅支持 Ctrl、Alt、Shift 与字母、数字或 F1-F12")
    if not {"ctrl", "alt"}.intersection(modifiers) or not _KEY_PATTERN.fullmatch(key):
        raise HotkeyError("唤起快捷键需要 Ctrl 或 Alt，并使用字母、数字或 F1-F12")
    return "+".join(
        [label for label, _ in _MODIFIER_ORDER if label.lower() in modifiers] + [key]
    )


def _registration_parts(hotkey: str) -> tuple[int, int]:
    modifiers = MOD_NOREPEAT
    tokens = hotkey.split("+")
    for label, flag in _MODIFIER_ORDER:
        if label in tokens[:-1]:
            modifiers |= flag
    key = tokens[-1]
    virtual_key = ord(key) if len(key) == 1 else 0x70 + int(key[1:]) - 1
    return modifiers, virtual_key


class GlobalActivationHotkey:
    """Dedicated message-loop owner for the one fixed application activation shortcut.

    RegisterHotKey delivers WM_HOTKEY to the registering thread. Keeping that loop
    here avoids a global keyboard hook and lets the webview UI thread stay focused
    solely on rendering. The callback only restores the existing native window.
    """

    def __init__(self, on_activate: Callable[[], None]) -> None:
        self._on_activate = on_activate
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._thread_id: int | None = None
        self._ready = threading.Event()
        self._error: str | None = None
        self._active_hotkey: str | None = None

    @property
    def active_hotkey(self) -> str | None:
        with self._lock:
            return self._active_hotkey

    def start(self, hotkey: object) -> str:
        normalized = normalize_activation_hotkey(hotkey)
        with self._lock:
            if self._active_hotkey == normalized:
                return normalized
            self._stop_locked()
            self._ready.clear()
            self._error = None
            self._thread = threading.Thread(
                target=self._message_loop,
                args=(normalized,),
                name="kaitools-global-hotkey",
                daemon=True,
            )
            self._thread.start()
        if not self._ready.wait(2):
            self.stop()
            raise HotkeyError("注册唤起快捷键超时")
        with self._lock:
            if self._error:
                error = self._error
                self._stop_locked()
                raise HotkeyError(error)
            self._active_hotkey = normalized
        return normalized

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        thread = self._thread
        thread_id = self._thread_id
        if thread_id:
            ctypes.windll.user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(2)
        self._thread = None
        self._thread_id = None
        self._active_hotkey = None

    def _message_loop(self, hotkey: str) -> None:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        thread_id = int(kernel32.GetCurrentThreadId())
        message = wintypes.MSG()
        # Create this thread's message queue before the main thread can request stop.
        user32.PeekMessageW(ctypes.byref(message), None, 0, 0, PM_NOREMOVE)
        with self._lock:
            self._thread_id = thread_id
        modifiers, virtual_key = _registration_parts(hotkey)
        if not user32.RegisterHotKey(None, HOTKEY_ID, modifiers, virtual_key):
            error = ctypes.get_last_error()
            with self._lock:
                self._error = "该唤起快捷键已被其他应用占用，请更换组合键" if error == 1409 else "无法注册唤起快捷键"
            self._ready.set()
            return
        self._ready.set()
        try:
            while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
                if message.message == WM_HOTKEY and message.wParam == HOTKEY_ID:
                    try:
                        self._on_activate()
                    except Exception:
                        # A failed foreground attempt must not end the registered shortcut loop.
                        pass
        finally:
            user32.UnregisterHotKey(None, HOTKEY_ID)
