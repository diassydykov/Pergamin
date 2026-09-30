@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul || (
  echo uv is required to rebuild Pergamin.exe
  exit /b 1
)
uv tool run --from pyinstaller==6.22.3 pyinstaller --noconfirm --clean --onefile --windowed --name Pergamin --icon pergamin.ico pergamin_launcher.py || exit /b 1
copy /Y "%~dp0dist\Pergamin.exe" "%~dp0..\Pergamin.exe" >nul
 echo Built: %~dp0..\Pergamin.exe
endlocal
