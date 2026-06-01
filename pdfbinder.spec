# -*- mode: python ; coding: utf-8 -*-
# Build with:  uv run --with pyinstaller pyinstaller pdfbinder.spec
from PyInstaller.utils.hooks import collect_all, collect_submodules

# Bundled read-only assets (served by the app at runtime via sys._MEIPASS).
datas = [("index.html", "."), ("static", "static")]
binaries = []
hiddenimports = []

# Packages with native binaries / data files / dynamic imports that PyInstaller
# does not pick up automatically.
for pkg in ("pypdfium2", "pypdfium2_raw", "uvicorn", "fastapi", "starlette",
            "anyio", "pypdf"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# uvicorn loads its protocol/loop/lifespan implementations by string at runtime.
hiddenimports += collect_submodules("uvicorn")

a = Analysis(
    ["launch.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="PDFBinder",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,          # show the "running at ..." window; closing it quits
    icon="static/favicon.ico",
)
