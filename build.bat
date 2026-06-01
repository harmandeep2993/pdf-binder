@echo off
REM Double-click this to build dist\PDFBinder.exe
cd /d "%~dp0"
echo Building PDFBinder.exe ...
echo.
uv run --with pyinstaller pyinstaller pdfbinder.spec --noconfirm --clean
echo.
if exist "dist\PDFBinder.exe" (
    echo Done.  ^>  dist\PDFBinder.exe
    echo Share that single file. Double-click it to run; close the window to quit.
) else (
    echo Build failed - PDFBinder.exe was not created. See the messages above.
)
echo.
pause
