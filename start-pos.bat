@echo off
title Lake City POS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing the POS parts. This needs internet once and takes about a minute...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)
echo POS is running. Close this window to stop the register.
node launch.mjs
pause
