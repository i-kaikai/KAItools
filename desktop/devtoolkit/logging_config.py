from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from .paths import AppPaths


def configure_logging(paths: AppPaths) -> None:
    paths.logs_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        paths.logs_dir / "devtoolkit.log",
        maxBytes=2 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(handler)

