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
  echo   没有找到 Python，无法启动本地服务。
  echo   three.js 需要 http 协议才能加载模块和贴图，file:// 会被浏览器拦下。
  echo   装一个 Python 后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

"%PY%" serve.py
pause
