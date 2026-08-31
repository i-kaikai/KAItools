from __future__ import annotations

import base64
import hashlib
import io
import json
import subprocess
import zipfile
from pathlib import Path

import pytest

import devtoolkit.document_conversion as conversion
from devtoolkit.api import DesktopApi
from devtoolkit.document_conversion import DocumentConversionError
from devtoolkit.paths import AppPaths
from devtoolkit.storage import AppStorage


def docx_bytes(text: str = "KAITools") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", f"<document>{text}</document>")
    return output.getvalue()


def app_paths(tmp_path: Path) -> AppPaths:
    return AppPaths(tmp_path, tmp_path / "resources", tmp_path / "data")


def payload(name: str, content: bytes) -> dict[str, str]:
    return {"fileName": name, "dataBase64": base64.b64encode(content).decode("ascii")}


def test_payload_validation_accepts_only_bounded_docx_and_pdf() -> None:
    name, content = conversion.decode_document_payload(payload("report.docx", docx_bytes()), "docx-to-pdf")
    assert name == "report.docx"
    assert conversion.valid_docx(content)
    assert conversion.decode_document_payload(payload("report.pdf", b"%PDF-1.7\n"), "pdf-to-docx")[0] == "report.pdf"

    with pytest.raises(DocumentConversionError, match="DOCX"):
        conversion.decode_document_payload(payload("report.docx", b"PK-not-a-docx"), "docx-to-pdf")
    with pytest.raises(DocumentConversionError, match="PDF"):
        conversion.decode_document_payload(payload("report.pdf", b"not-pdf"), "pdf-to-docx")
    with pytest.raises(DocumentConversionError, match="请求格式"):
        conversion.decode_document_payload({"fileName": "report.pdf", "dataBase64": "", "path": "C:/secret"}, "pdf-to-docx")


def test_capabilities_prefer_word_and_limit_pdf_to_docx_to_word(tmp_path: Path) -> None:
    word = tmp_path / "WINWORD.EXE"
    libreoffice = tmp_path / "soffice.com"
    capabilities = conversion.document_conversion_capabilities(lambda: word, lambda: libreoffice)

    assert capabilities == {
        "docxToPdf": {"engines": ["microsoft-word", "libreoffice"], "preferred": "microsoft-word"},
        "pdfToDocx": {"engines": ["microsoft-word"], "preferred": "microsoft-word"},
    }
    assert conversion.document_conversion_capabilities(lambda: None, lambda: libreoffice)["pdfToDocx"]["preferred"] is None


def test_convert_document_uses_checked_request_and_atomically_saves(tmp_path: Path) -> None:
    content = docx_bytes()
    destination = tmp_path / "saved" / "report.pdf"
    request_directory: Path | None = None

    def helper(request_path: Path, digest: str, application_root: Path) -> int:
        nonlocal request_directory
        request_directory = request_path.parent
        assert application_root == tmp_path
        request_bytes = request_path.read_bytes()
        assert hashlib.sha256(request_bytes).hexdigest() == digest
        request = json.loads(request_bytes)
        assert request["inputName"] == "source.docx"
        assert request["outputName"] == "output.pdf"
        (request_path.parent / "output.pdf").write_bytes(b"%PDF-1.7\nconverted")
        (request_path.parent / "result.json").write_text(
            json.dumps({"ok": True, "engine": "microsoft-word", "outputSize": 18}),
            encoding="utf-8",
        )
        return 0

    result = conversion.convert_document("docx-to-pdf", content, destination, tmp_path, helper)

    assert result["engine"] == "microsoft-word"
    assert destination.read_bytes().startswith(b"%PDF-")
    assert request_directory is not None and not request_directory.exists()
    assert not destination.with_name(f".{destination.name}.kaitools.tmp").exists()


def test_execute_request_falls_back_from_word_to_libreoffice(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "source.docx"
    source.write_bytes(docx_bytes())
    request = {
        "kind": "docx-to-pdf",
        "inputName": "source.docx",
        "inputSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "outputName": "output.pdf",
        "resultName": "result.json",
    }
    request_path = tmp_path / "request.json"
    request_bytes = json.dumps(request).encode("utf-8")
    request_path.write_bytes(request_bytes)
    monkeypatch.setattr(conversion, "resolve_word", lambda: tmp_path / "WINWORD.EXE")
    monkeypatch.setattr(conversion, "resolve_libreoffice", lambda: tmp_path / "soffice.com")

    def failed_word(*_args) -> None:
        raise DocumentConversionError("WORD_CONVERSION_FAILED", "Word failed")

    def successful_libreoffice(_source: Path, target: Path, _directory: Path, _executable: Path) -> None:
        target.write_bytes(b"%PDF-1.7\nlibreoffice")

    monkeypatch.setattr(conversion, "convert_with_word", failed_word)
    monkeypatch.setattr(conversion, "convert_with_libreoffice", successful_libreoffice)

    exit_code = conversion.execute_conversion_request(request_path, hashlib.sha256(request_bytes).hexdigest())
    result = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert exit_code == 0
    assert result["engine"] == "libreoffice"


def test_helper_timeout_kills_only_recorded_process(tmp_path: Path, monkeypatch) -> None:
    request = tmp_path / "request.json"
    request.write_text("{}", encoding="utf-8")
    (tmp_path / "office.pid").write_text("43210", encoding="ascii")
    terminated: list[int] = []

    class Process:
        def wait(self, timeout=None):
            if timeout is not None:
                raise subprocess.TimeoutExpired("helper", timeout)
            return 1

        def kill(self) -> None:
            return None

    monkeypatch.setattr(conversion.subprocess, "Popen", lambda *_args, **_kwargs: Process())
    monkeypatch.setattr(conversion, "_terminate_process", terminated.append)

    with pytest.raises(DocumentConversionError, match="120 秒"):
        conversion.run_conversion_helper(request, "digest", tmp_path)
    assert terminated == [43210]


class SaveWindow:
    def __init__(self, selection: Path | None) -> None:
        self.selection = selection

    def create_file_dialog(self, *_args, **_kwargs):
        return (str(self.selection),) if self.selection else None


def test_desktop_api_saves_without_exposing_path(tmp_path: Path) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    destination = tmp_path / "chosen" / "report"
    calls: list[tuple[str, Path]] = []

    def convert(kind: str, _content: bytes, output: Path, _root: Path) -> dict[str, object]:
        calls.append((kind, output))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"%PDF-1.7\n")
        return {"engine": "microsoft-word", "outputSize": output.stat().st_size}

    api = DesktopApi(
        paths,
        storage,
        document_capabilities=lambda: {
            "docxToPdf": {"engines": ["microsoft-word"], "preferred": "microsoft-word"},
            "pdfToDocx": {"engines": ["microsoft-word"], "preferred": "microsoft-word"},
        },
        document_converter=convert,
    )
    api.bind_window(SaveWindow(destination))

    result = api.convert_docx_to_pdf(payload("../report.docx", docx_bytes()))
    assert result["ok"] is True
    assert result["data"] == {
        "cancelled": False,
        "engine": "microsoft-word",
        "outputName": "report.pdf",
        "outputSize": 9,
    }
    assert calls == [("docx-to-pdf", destination.with_suffix(".pdf"))]
    assert "path" not in result["data"]


def test_desktop_api_handles_save_cancel_and_missing_engine(tmp_path: Path) -> None:
    paths = app_paths(tmp_path)
    storage = AppStorage(paths)
    storage.ensure_directories()
    capabilities = {
        "docxToPdf": {"engines": ["libreoffice"], "preferred": "libreoffice"},
        "pdfToDocx": {"engines": [], "preferred": None},
    }
    api = DesktopApi(paths, storage, document_capabilities=lambda: capabilities)
    api.bind_window(SaveWindow(None))

    cancelled = api.convert_docx_to_pdf(payload("report.docx", docx_bytes()))
    unavailable = api.convert_pdf_to_docx(payload("report.pdf", b"%PDF-1.7\n"))
    assert cancelled["data"]["cancelled"] is True
    assert cancelled["data"]["engine"] == "libreoffice"
    assert unavailable["error"]["code"] == "DOCUMENT_ENGINE_UNAVAILABLE"
