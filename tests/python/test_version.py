from pathlib import Path

from devtoolkit import __version__
from devtoolkit.version import APP_VERSION


def test_runtime_version_matches_authoritative_version_file() -> None:
    expected = (Path(__file__).resolve().parents[2] / "VERSION").read_text(encoding="utf-8").strip()

    assert APP_VERSION == expected
    assert __version__ == expected
