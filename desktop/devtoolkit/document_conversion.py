from __future__ import annotations

import argparse
import base64
import binascii
import ctypes
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
MAX_OUTPUT_BYTES = 250 * 1024 * 1024
CONVERSION_TIMEOUT_SECONDS = 120
PDF_SIGNATURE = b"%PDF-"
DOCX_SIGNATURE = b"PK"


class DocumentConversionError(RuntimeError):
    def __init__(self, code: str, message: str, details: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


def safe_stem(file_name: str, fallback: str = "document") -> str:
    name = Path(file_name.replace("\\", "/")).name
    stem = Path(name).stem.strip().strip(".")
    cleaned = "".join(character for character in stem if character not in '<>:"/\\|?*' and ord(character) >= 32)
    return cleaned[:120] or fallback


def decode_document_payload(payload: Any, kind: str) -> tuple[str, bytes]:
    if not isinstance(payload, dict) or set(payload) != {"fileName", "dataBase64"}:
        raise DocumentConversionError("DOCUMENT_INPUT_INVALID", "文档转换请求格式无效")
    file_name = payload.get("fileName")
    encoded = payload.get("dataBase64")
    if not isinstance(file_name, str) or not isinstance(encoded, str):
        raise DocumentConversionError("DOCUMENT_INPUT_INVALID", "文档名称或内容无效")
    if len(encoded) > MAX_DOCUMENT_BYTES * 2:
        raise DocumentConversionError("DOCUMENT_TOO_LARGE", "文档不能超过 50 MiB")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DocumentConversionError("DOCUMENT_INPUT_INVALID", "文档 Base64 数据无效") from exc
    if not content or len(content) > MAX_DOCUMENT_BYTES:
        raise DocumentConversionError("DOCUMENT_TOO_LARGE", "文档不能超过 50 MiB")
    suffix = Path(file_name).suffix.lower()
    if kind == "docx-to-pdf":
        if suffix != ".docx" or not valid_docx(content):
            raise DocumentConversionError("DOCUMENT_INPUT_INVALID", "请选择有效的 DOCX 文件")
    elif kind == "pdf-to-docx":
        if suffix != ".pdf" or not content.startswith(PDF_SIGNATURE):
            raise DocumentConversionError("DOCUMENT_INPUT_INVALID", "请选择有效的 PDF 文件")
    else:
        raise DocumentConversionError("DOCUMENT_MODE_INVALID", "文档转换模式无效")
    return file_name, content


def valid_docx(content: bytes) -> bool:
    if not content.startswith(DOCX_SIGNATURE):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if any(info.flag_bits & 1 for info in archive.infolist()):
                return False
            names = {name.replace("\\", "/").lower() for name in archive.namelist()}
            return "[content_types].xml" in names and "word/document.xml" in names
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile):
        return False


def _registry_app_path(executable: str) -> Path | None:
    try:
        import winreg
    except ImportError:
        return None
    subkey = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{executable}"
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for flags in (winreg.KEY_READ | winreg.KEY_WOW64_64KEY, winreg.KEY_READ | winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(root, subkey, 0, flags) as key:
                    value = winreg.QueryValue(key, None)
                path = Path(value).resolve()
                if path.is_file():
                    return path
            except OSError:
                continue
    return None


def resolve_word() -> Path | None:
    path = _registry_app_path("WINWORD.EXE")
    try:
        win32com_available = importlib.util.find_spec("win32com.client") is not None
    except ModuleNotFoundError:
        win32com_available = False
    if path and win32com_available:
        return path
    return None


def resolve_libreoffice() -> Path | None:
    candidates: list[Path] = []
    registered = _registry_app_path("soffice.exe") or _registry_app_path("soffice.com")
    if registered:
        candidates.append(registered)
    found = shutil.which("soffice.com") or shutil.which("soffice.exe")
    if found:
        candidates.append(Path(found))
    for variable in ("ProgramFiles", "ProgramFiles(x86)"):
        root = os.environ.get(variable)
        if root:
            candidates.extend((Path(root) / "LibreOffice" / "program" / name for name in ("soffice.com", "soffice.exe")))
    return next((path.resolve() for path in candidates if path.is_file()), None)


def document_conversion_capabilities(
    word_resolver: Callable[[], Path | None] = resolve_word,
    libreoffice_resolver: Callable[[], Path | None] = resolve_libreoffice,
) -> dict[str, Any]:
    word = word_resolver()
    libreoffice = libreoffice_resolver()
    docx_engines = [engine for engine, available in (("microsoft-word", word), ("libreoffice", libreoffice)) if available]
    pdf_engines = ["microsoft-word"] if word else []
    return {
        "docxToPdf": {"engines": docx_engines, "preferred": docx_engines[0] if docx_engines else None},
        "pdfToDocx": {"engines": pdf_engines, "preferred": pdf_engines[0] if pdf_engines else None},
    }


def _write_process_id(directory: Path, process_id: int) -> None:
    (directory / "office.pid").write_text(str(process_id), encoding="ascii")


def _word_process_id(word: Any) -> int:
    process_id = ctypes.c_ulong()
    ctypes.windll.user32.GetWindowThreadProcessId(int(word.Hwnd), ctypes.byref(process_id))
    return int(process_id.value)


def convert_with_word(kind: str, source: Path, target: Path, request_directory: Path) -> None:
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        raise DocumentConversionError("WORD_UNAVAILABLE", "Microsoft Word 转换组件不可用") from exc

    pythoncom.CoInitialize()
    word: Any = None
    document: Any = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        _write_process_id(request_directory, _word_process_id(word))
        word.Visible = False
        word.DisplayAlerts = 0
        word.AutomationSecurity = 3
        document = word.Documents.Open(
            str(source),
            ConfirmConversions=False,
            ReadOnly=True,
            AddToRecentFiles=False,
            OpenAndRepair=True,
            NoEncodingDialog=True,
        )
        if kind == "docx-to-pdf":
            document.ExportAsFixedFormat(
                OutputFileName=str(target),
                ExportFormat=17,
                OpenAfterExport=False,
                OptimizeFor=0,
                Range=0,
                Item=0,
                IncludeDocProps=True,
                KeepIRM=True,
                CreateBookmarks=1,
                DocStructureTags=True,
                BitmapMissingFonts=True,
                UseISO19005_1=False,
            )
        else:
            document.SaveAs2(FileName=str(target), FileFormat=16, AddToRecentFiles=False)
    except DocumentConversionError:
        raise
    except Exception as exc:
        raise DocumentConversionError("WORD_CONVERSION_FAILED", "Microsoft Word 转换失败", str(exc)) from exc
    finally:
        if document is not None:
            try:
                document.Close(SaveChanges=False)
            except Exception:
                pass
        if word is not None:
            try:
                word.Quit(SaveChanges=False)
            except Exception:
                pass
        pythoncom.CoUninitialize()


def convert_with_libreoffice(source: Path, target: Path, request_directory: Path, executable: Path) -> None:
    profile = request_directory / "libreoffice-profile"
    profile.mkdir()
    profile_uri = profile.resolve().as_uri()
    command = [
        str(executable),
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        f"-env:UserInstallation={profile_uri}",
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        str(request_directory),
        str(source),
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    _write_process_id(request_directory, process.pid)
    try:
        stdout, stderr = process.communicate(timeout=CONVERSION_TIMEOUT_SECONDS - 5)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.communicate()
        raise DocumentConversionError("DOCUMENT_CONVERSION_TIMEOUT", "LibreOffice 转换超时") from exc
    generated = request_directory / f"{source.stem}.pdf"
    if process.returncode != 0 or not generated.is_file():
        details = (stderr or stdout).strip()[:2000]
        raise DocumentConversionError("LIBREOFFICE_CONVERSION_FAILED", "LibreOffice 转换失败", details)
    if generated.resolve() != target.resolve():
        generated.replace(target)


def validate_output(kind: str, target: Path) -> int:
    try:
        size = target.stat().st_size
        prefix = target.read_bytes()[:5]
    except OSError as exc:
        raise DocumentConversionError("DOCUMENT_OUTPUT_INVALID", "转换引擎没有生成有效文件") from exc
    if not 0 < size <= MAX_OUTPUT_BYTES:
        raise DocumentConversionError("DOCUMENT_OUTPUT_INVALID", "转换结果为空或超过 250 MiB")
    if kind == "docx-to-pdf" and prefix != PDF_SIGNATURE:
        raise DocumentConversionError("DOCUMENT_OUTPUT_INVALID", "转换结果不是有效 PDF")
    if kind == "pdf-to-docx" and not valid_docx(target.read_bytes()):
        raise DocumentConversionError("DOCUMENT_OUTPUT_INVALID", "转换结果不是有效 DOCX")
    return size


def _write_result(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def execute_conversion_request(request_path: Path, expected_sha256: str) -> int:
    request_path = request_path.resolve()
    directory = request_path.parent
    try:
        content = request_path.read_bytes()
        if hashlib.sha256(content).hexdigest() != expected_sha256:
            raise DocumentConversionError("DOCUMENT_REQUEST_INVALID", "文档转换请求摘要不匹配")
        request = json.loads(content.decode("utf-8"))
        if not isinstance(request, dict) or set(request) != {"kind", "inputName", "inputSha256", "outputName", "resultName"}:
            raise DocumentConversionError("DOCUMENT_REQUEST_INVALID", "文档转换请求无效")
        kind = request["kind"]
        expected_names = {
            "inputName": "source.docx" if kind == "docx-to-pdf" else "source.pdf",
            "outputName": "output.pdf" if kind == "docx-to-pdf" else "output.docx",
            "resultName": "result.json",
        }
        if kind not in {"docx-to-pdf", "pdf-to-docx"} or any(request[key] != value for key, value in expected_names.items()):
            raise DocumentConversionError("DOCUMENT_REQUEST_INVALID", "文档转换请求路径无效")
        source = directory / expected_names["inputName"]
        target = directory / expected_names["outputName"]
        result = directory / expected_names["resultName"]
        if hashlib.sha256(source.read_bytes()).hexdigest() != request["inputSha256"]:
            raise DocumentConversionError("DOCUMENT_REQUEST_INVALID", "文档输入摘要不匹配")

        failures: list[DocumentConversionError] = []
        engines: list[tuple[str, Callable[[], None]]] = []
        if resolve_word():
            engines.append(("microsoft-word", lambda: convert_with_word(kind, source, target, directory)))
        libreoffice = resolve_libreoffice()
        if kind == "docx-to-pdf" and libreoffice:
            engines.append(("libreoffice", lambda: convert_with_libreoffice(source, target, directory, libreoffice)))
        if not engines:
            raise DocumentConversionError("DOCUMENT_ENGINE_UNAVAILABLE", "未检测到可用的 Microsoft Word 或 LibreOffice")
        for engine, convert in engines:
            try:
                convert()
                size = validate_output(kind, target)
                _write_result(result, {"ok": True, "engine": engine, "outputSize": size})
                return 0
            except DocumentConversionError as exc:
                failures.append(exc)
                target.unlink(missing_ok=True)
        last = failures[-1]
        raise DocumentConversionError(last.code, str(last), last.details)
    except DocumentConversionError as exc:
        result_path = directory / "result.json"
        _write_result(result_path, {"ok": False, "code": exc.code, "message": str(exc), "details": exc.details})
        return 2
    except Exception as exc:
        result_path = directory / "result.json"
        _write_result(result_path, {"ok": False, "code": "DOCUMENT_CONVERSION_FAILED", "message": "文档转换失败", "details": str(exc)})
        return 2


def _helper_command(request_path: Path, digest: str, application_root: Path) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--document-conversion-request", str(request_path), digest]
    return [sys.executable, str(application_root / "desktop" / "main.py"), "--document-conversion-request", str(request_path), digest]


def _terminate_process(process_id: int) -> None:
    if process_id <= 0 or os.name != "nt":
        return
    completed = subprocess.run(
        ["taskkill", "/PID", str(process_id), "/T", "/F"],
        check=False,
        capture_output=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode == 0:
        return
    process_handle = ctypes.windll.kernel32.OpenProcess(0x0001, False, process_id)
    if process_handle:
        try:
            ctypes.windll.kernel32.TerminateProcess(process_handle, 1)
        finally:
            ctypes.windll.kernel32.CloseHandle(process_handle)


def run_conversion_helper(request_path: Path, digest: str, application_root: Path) -> int:
    process = subprocess.Popen(
        _helper_command(request_path, digest, application_root),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        return process.wait(timeout=CONVERSION_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.wait()
        pid_file = request_path.parent / "office.pid"
        try:
            _terminate_process(int(pid_file.read_text(encoding="ascii")))
        except (OSError, ValueError):
            pass
        raise DocumentConversionError("DOCUMENT_CONVERSION_TIMEOUT", "文档转换超过 120 秒，已停止本次任务") from exc


def convert_document(
    kind: str,
    content: bytes,
    destination: Path,
    application_root: Path,
    helper: Callable[[Path, str, Path], int] = run_conversion_helper,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="kaitools-document-") as temporary_directory:
        directory = Path(temporary_directory)
        input_name = "source.docx" if kind == "docx-to-pdf" else "source.pdf"
        output_name = "output.pdf" if kind == "docx-to-pdf" else "output.docx"
        source = directory / input_name
        output = directory / output_name
        result_path = directory / "result.json"
        source.write_bytes(content)
        request = {
            "kind": kind,
            "inputName": input_name,
            "inputSha256": hashlib.sha256(content).hexdigest(),
            "outputName": output_name,
            "resultName": result_path.name,
        }
        request_path = directory / "request.json"
        request_bytes = json.dumps(request, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        request_path.write_bytes(request_bytes)
        exit_code = helper(request_path, hashlib.sha256(request_bytes).hexdigest(), application_root)
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise DocumentConversionError("DOCUMENT_CONVERSION_FAILED", "转换辅助进程没有返回结果") from exc
        if exit_code != 0 or result.get("ok") is not True:
            raise DocumentConversionError(
                str(result.get("code") or "DOCUMENT_CONVERSION_FAILED"),
                str(result.get("message") or "文档转换失败"),
                str(result.get("details")) if result.get("details") else None,
            )
        size = validate_output(kind, output)
        destination.parent.mkdir(parents=True, exist_ok=True)
        sibling = destination.with_name(f".{destination.name}.kaitools.tmp")
        try:
            shutil.copyfile(output, sibling)
            os.replace(sibling, destination)
        finally:
            sibling.unlink(missing_ok=True)
        return {"engine": result["engine"], "outputSize": size}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", nargs=2, metavar=("PATH", "SHA256"), required=True)
    arguments = parser.parse_args()
    request_path, digest = arguments.request
    return execute_conversion_request(Path(request_path), digest)


if __name__ == "__main__":
    raise SystemExit(main())
