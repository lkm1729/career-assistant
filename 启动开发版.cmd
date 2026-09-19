@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are not installed. See README.md for setup instructions.
  pause
  exit /b 1
)
if not exist "dist-electron\main.cjs" (
  call npm.cmd run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call node scripts\start.mjs
if errorlevel 1 pause
