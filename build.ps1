# Build the standalone PDF Binder desktop app (Windows .exe).
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"

Write-Host "Building PDFBinder.exe ..." -ForegroundColor Cyan
uv run --with pyinstaller pyinstaller pdfbinder.spec --noconfirm --clean

$exe = Join-Path $PSScriptRoot "dist\PDFBinder.exe"
if (Test-Path $exe) {
    $size = "{0:N0} MB" -f ((Get-Item $exe).Length / 1MB)
    Write-Host ""
    Write-Host "Done. -> dist\PDFBinder.exe ($size)" -ForegroundColor Green
    Write-Host "Share that single file. Double-click it to run; close the window to quit."
} else {
    Write-Error "Build finished but dist\PDFBinder.exe was not found."
}
