@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY="

where py >nul 2>nul
if not errorlevel 1 set "PY=py"

if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
)

if not defined PY (
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)

if not defined PY (
  echo.
  echo   没有找到 Python，无法打包。
  echo   装一个 Python 后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

echo.
echo   确认 PyInstaller 已安装（第一次会装，要等一会儿）
"%PY%" -m pip install --upgrade pyinstaller
if errorlevel 1 goto fail

echo.
"%PY%" build_exe.py
if errorlevel 1 goto fail

echo.
echo   产物在 dist\莲.exe，双击即可运行。这个窗口可以关掉了。
pause
exit /b 0

:fail
echo.
echo   打包没成功，往上翻看报错信息。
pause
exit /b 1
