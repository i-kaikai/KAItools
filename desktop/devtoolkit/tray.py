from __future__ import annotations

import ctypes
import logging
import threading
from collections.abc import Callable

LOGGER = logging.getLogger(__name__)


class TrayError(RuntimeError):
    """Raised when the Windows notification-area controller is unavailable."""


class TrayController:
    """Own the one desktop tray icon and marshal all WinForms work to its UI thread."""

    def __init__(self, window: object, icon_path: str | None) -> None:
        self._window = window
        self._icon_path = icon_path
        self._lock = threading.RLock()
        self._notify_icon: object | None = None
        self._menu: object | None = None
        self._icon: object | None = None
        self._initialized = False
        self._hidden = False
        self._disposed = False

    @property
    def is_hidden(self) -> bool:
        with self._lock:
            return self._hidden

    def initialize(self) -> None:
        if not self._icon_path:
            raise TrayError("未找到应用图标，无法创建托盘图标")
        self._invoke(self._initialize)

    def hide(self) -> None:
        self._ensure_initialized()
        self._invoke(self._hide)

    def show(self) -> None:
        self._ensure_initialized()
        self._invoke(self._show)

    def toggle_for_hotkey(self) -> None:
        """Hide only when the application already owns the foreground window."""

        if self.is_hidden:
            self.show()
            return
        hwnd = self._native_handle()
        foreground = int(ctypes.windll.user32.GetForegroundWindow() or 0)
        if hwnd and foreground == hwnd:
            self.hide()
        else:
            self.show()

    def dispose(self) -> None:
        try:
            self._invoke(self._dispose)
        except Exception:
            LOGGER.exception("tray_dispose_failed")

    def exit_application(self) -> None:
        """Tray menu exit is the only tray action that terminates the process."""

        self._invoke(self._exit_application)

    def _ensure_initialized(self) -> None:
        with self._lock:
            if not self._initialized or self._disposed:
                raise TrayError("系统托盘尚未就绪")

    def _native_handle(self) -> int:
        native = getattr(self._window, "native", None)
        handle = getattr(native, "Handle", None)
        if handle is not None and hasattr(handle, "ToInt64"):
            return int(handle.ToInt64())
        return 0

    def _invoke(self, action: Callable[[], None]) -> None:
        native = getattr(self._window, "native", None)
        if native is None:
            raise TrayError("桌面窗口尚未就绪")
        if getattr(native, "InvokeRequired", False):
            from System import Action

            native.Invoke(Action(action))
        else:
            action()

    def _initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
        import clr

        clr.AddReference("System.Drawing")
        clr.AddReference("System.Windows.Forms")
        from System.Drawing import Icon
        from System.Windows.Forms import ContextMenuStrip, NotifyIcon, ToolStripMenuItem

        menu = ContextMenuStrip()
        show_item = ToolStripMenuItem("显示 KAITools")
        exit_item = ToolStripMenuItem("退出")
        show_item.Click += lambda _sender, _event: self.show()
        exit_item.Click += lambda _sender, _event: self.exit_application()
        menu.Items.Add(show_item)
        menu.Items.Add(exit_item)

        notify_icon = NotifyIcon()
        icon = Icon(self._icon_path)
        notify_icon.Icon = icon
        notify_icon.Text = "KAITools"
        notify_icon.ContextMenuStrip = menu
        notify_icon.Visible = False
        notify_icon.DoubleClick += lambda _sender, _event: self.show()
        with self._lock:
            self._notify_icon = notify_icon
            self._menu = menu
            self._icon = icon
            self._initialized = True
            self._disposed = False

    def _hide(self) -> None:
        notify_icon = self._notify_icon
        native = getattr(self._window, "native", None)
        if notify_icon is None or native is None:
            raise TrayError("系统托盘尚未就绪")
        native.Hide()
        notify_icon.Visible = True
        with self._lock:
            self._hidden = True
        LOGGER.info("window_hidden_to_tray")

    def _show(self) -> None:
        notify_icon = self._notify_icon
        native = getattr(self._window, "native", None)
        if notify_icon is None or native is None:
            raise TrayError("系统托盘尚未就绪")
        native.Show()
        native.Activate()
        notify_icon.Visible = False
        with self._lock:
            self._hidden = False
        hwnd = self._native_handle()
        if hwnd:
            user32 = ctypes.windll.user32
            user32.ShowWindowAsync(hwnd, 9)  # SW_RESTORE
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        LOGGER.info("window_restored_from_tray")

    def _exit_application(self) -> None:
        self._dispose()
        native = getattr(self._window, "native", None)
        if native is not None:
            native.Close()

    def _dispose(self) -> None:
        with self._lock:
            if self._disposed:
                return
            notify_icon = self._notify_icon
            menu = self._menu
            icon = self._icon
            self._notify_icon = None
            self._menu = None
            self._icon = None
            self._hidden = False
            self._disposed = True
        if notify_icon is not None:
            notify_icon.Visible = False
            notify_icon.Dispose()
        if menu is not None:
            menu.Dispose()
        if icon is not None:
            icon.Dispose()
