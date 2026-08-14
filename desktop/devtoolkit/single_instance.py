from __future__ import annotations

import ctypes
import logging
import threading
import time
from collections.abc import Callable
from multiprocessing.connection import Client, Listener
from typing import Any

LOGGER = logging.getLogger(__name__)
MUTEX_NAME = "Local\\DevToolkit.Singleton.v1"
PIPE_NAME = r"\\.\pipe\DevToolkit.Singleton.v1"
AUTH_KEY = b"DevToolkit-activate-v1"
ERROR_ALREADY_EXISTS = 183


class SingleInstance:
    def __init__(self) -> None:
        self._mutex: int | None = None
        self._listener: Listener | None = None

    def acquire_or_notify(self) -> bool:
        kernel32 = ctypes.windll.kernel32
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
        if not handle:
            raise OSError(ctypes.get_last_error(), "无法创建单实例锁")
        self._mutex = handle
        if kernel32.GetLastError() != ERROR_ALREADY_EXISTS:
            return True
        for attempt in range(10):
            try:
                connection = Client(PIPE_NAME, family="AF_PIPE", authkey=AUTH_KEY)
                connection.send({"type": "activate"})
                connection.close()
                break
            except OSError:
                if attempt == 9:
                    LOGGER.warning("existing_instance_notification_failed")
                else:
                    time.sleep(0.05)
        return False

    def listen(self, on_activate: Callable[[], None]) -> None:
        def serve() -> None:
            try:
                self._listener = Listener(PIPE_NAME, family="AF_PIPE", authkey=AUTH_KEY)
                while True:
                    connection = self._listener.accept()
                    try:
                        message: Any = connection.recv()
                        if isinstance(message, dict) and message.get("type") == "activate":
                            on_activate()
                    finally:
                        connection.close()
            except (OSError, EOFError):
                LOGGER.info("single_instance_listener_stopped")

        threading.Thread(target=serve, name="single-instance", daemon=True).start()

    def close(self) -> None:
        if self._listener is not None:
            self._listener.close()
            self._listener = None
        if self._mutex is not None:
            ctypes.windll.kernel32.CloseHandle(self._mutex)
            self._mutex = None
