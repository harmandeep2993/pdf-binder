"""Entry point for the packaged (PyInstaller) desktop build.

Starts the PDF Binder server on localhost, opens the default browser, and keeps
running until the console window is closed. No auto-reload, no network exposure.
"""
import socket
import threading
import webbrowser

import uvicorn

from pdf_binder import app

HOST = "127.0.0.1"


def _find_port(preferred: int = 8000) -> int:
    """Return the preferred port if free, otherwise an OS-assigned free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, preferred))
            return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def main() -> None:
    port = _find_port()
    url = f"http://{HOST}:{port}"
    print("=" * 48)
    print("  PDF Binder is running.")
    print(f"  Open: {url}")
    print("  Keep this window open while using the app.")
    print("  Close this window to quit.")
    print("=" * 48)
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=HOST, port=port, log_level="warning")


if __name__ == "__main__":
    main()
