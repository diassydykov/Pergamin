@echo off
rem ============================================================
rem  PERGAMIN - "Живая книга" (launcher)
rem  Запускает локальный сервер и открывает книгу в окне-приложении.
rem  Всё приложение лежит на этом диске (D:\pergamin).
rem ============================================================
cd /d "%~dp0"

set PORT=8321
set APPDATA_DIR=%~dp0pergamin-data
set LEGACY_DATA=%USERPROFILE%\AppData\Local\pergamin

rem --- 0. Разовый перенос библиотеки из старого места (C:) на этот диск ---
if exist "%LEGACY_DATA%" if not exist "%APPDATA_DIR%\Default\IndexedDB" (
  echo  [Pergamin] Moving your library to this drive...
  xcopy /E /I /Q /Y "%LEGACY_DATA%" "%APPDATA_DIR%" >nul
  echo  [Pergamin] Library is now in: %APPDATA_DIR%
)

rem --- 1. Локальный сервер (виден и на телефоне в одной Wi-Fi) ---
where py >nul 2>nul
if not errorlevel 1 (
  start "Pergamin server" py -3 -m http.server %PORT% --bind 0.0.0.0
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    start "Pergamin server" python -m http.server %PORT% --bind 0.0.0.0
  ) else (
    echo [Pergamin] Python 3 not found.
    echo Install Python 3 and check "Add Python to PATH" during setup.
    pause
    exit /b 1
  )
)

rem --- 2. Показываем адрес для телефона (одна Wi-Fi сеть) ---
for /f "tokens=2 delims=:" %%b in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.*'} | Select-Object -First 1).IPAddress" 2^>nul') do set IP=%%b
echo.
echo  [Pergamin] Computer:  http://127.0.0.1:%PORT%
echo  [Pergamin] Phone (same Wi-Fi): http://%IP%:%PORT%
echo            On the phone open this URL and choose "Install app".
echo.

timeout /t 2 /nobreak >nul

rem --- 3. "Приложение": окно без адресной строки, данные на этом же диске ---
start "" chrome.exe --user-data-dir="%APPDATA_DIR%" --app=http://127.0.0.1:%PORT% 2>nul
if not errorlevel 1 exit /b 0
start "" msedge.exe --user-data-dir="%APPDATA_DIR%" --app=http://127.0.0.1:%PORT% 2>nul
if not errorlevel 1 exit /b 0
start "" "http://127.0.0.1:%PORT%"
exit /b 0
