@echo off
cd /d "%~dp0"

if exist "%~dp0Pergamin.exe" (
  start "" "%~dp0Pergamin.exe"
  exit /b 0
)

echo [Pergamin] Pergamin.exe not found.
echo Rebuild it from desktop-launcher or restore the application files.
pause
exit /b 1
