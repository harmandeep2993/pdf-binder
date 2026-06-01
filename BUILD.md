# Building a standalone app (no Python needed by the recipient)

This packages PDF Binder into a single Windows executable, `PDFBinder.exe`, that
anyone can run by double-clicking - no Python, no install, no cloud. Everything
runs locally on their machine.

## Build it (on your machine, one time)

You need Python 3.12+ and [uv](https://github.com/astral-sh/uv).

**Easiest:** double-click **`build.bat`** in File Explorer.

(Double-clicking `build.ps1` just opens it in Notepad - Windows won't run a
`.ps1` on double-click. Use `build.bat`, or right-click `build.ps1` ->
"Run with PowerShell".)

Or from a terminal:

```powershell
uv run --with pyinstaller pyinstaller pdfbinder.spec --noconfirm --clean
```

The result is **`dist\PDFBinder.exe`** (~34 MB).

## Share it

Send the single file `dist\PDFBinder.exe` (USB stick, file transfer, etc.).

The recipient:

1. Double-clicks `PDFBinder.exe`.
2. A small console window opens showing `Open: http://127.0.0.1:<port>`.
3. Their default browser opens the app automatically.
4. They close the console window to quit.

Notes:
- It binds to `127.0.0.1` only - nothing is exposed to the network or internet.
- Merged PDFs and the history database are written next to the `.exe`
  (a `history.db` file and an `output/` folder appear beside it on first merge).
- Windows SmartScreen may warn about an unrecognized publisher the first time
  (the exe is unsigned); choose "More info" -> "Run anyway".
- The build is Windows-only and must be produced on Windows. To target macOS or
  Linux, run the same PyInstaller command on that OS.

## How it works

- `launch.py` is the frozen entry point: it picks a free port, starts uvicorn
  (no reload), and opens the browser.
- `pdf_binder/paths.py` resolves asset vs. data locations so bundled read-only
  files (`index.html`, `static/`) load from the PyInstaller unpack dir while
  writable files (`history.db`, `output/`) live next to the executable.
- `pdfbinder.spec` bundles those assets plus the native PDFium binary
  (pypdfium2) and uvicorn's dynamically imported modules.
