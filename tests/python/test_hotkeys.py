from __future__ import annotations

import pytest

from devtoolkit.hotkeys import HotkeyError, normalize_activation_hotkey


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ctrl+alt+k", "Ctrl+Alt+K"),
        ("Alt + Ctrl + Shift + f8", "Ctrl+Alt+Shift+F8"),
        ("ctrl+9", "Ctrl+9"),
    ],
)
def test_normalize_activation_hotkey(raw: str, expected: str) -> None:
    assert normalize_activation_hotkey(raw) == expected


@pytest.mark.parametrize("raw", ["K", "Shift+K", "Ctrl+Alt", "Ctrl+Alt+F13", "Meta+K", "Ctrl+Alt+Delete"])
def test_rejects_unsafe_or_unsupported_activation_hotkeys(raw: str) -> None:
    with pytest.raises(HotkeyError):
        normalize_activation_hotkey(raw)
