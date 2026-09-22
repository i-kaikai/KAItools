from pathlib import Path

import pytest

from scripts.build_update_release import managed_files


def test_managed_files_excludes_pyinstaller_requested_marker(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    portable = tmp_path / "portable"
    marker = portable / "cryptography-1.0.dist-info" / "REQUESTED"
    marker.parent.mkdir(parents=True)
    marker.touch()
    executable = portable / "KAITools.exe"
    executable.write_bytes(b"program")

    files = managed_files(portable, "objects")

    assert [item["path"] for item in files] == ["KAITools.exe"]
    assert "cryptography-1.0.dist-info/REQUESTED" in capsys.readouterr().out


def test_managed_files_rejects_unexpected_zero_size_file_with_path(tmp_path: Path) -> None:
    portable = tmp_path / "portable"
    portable.mkdir()
    empty_file = portable / "unexpected-empty.bin"
    empty_file.touch()

    with pytest.raises(SystemExit, match=r"unexpected-empty\.bin"):
        managed_files(portable, "objects")
