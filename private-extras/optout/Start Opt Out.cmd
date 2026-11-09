@echo off
rem Double-click to run Opt Out on this computer. See start-optout.mjs.
title Opt Out
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Opt Out needs Node.js 24 or newer. Install it from https://nodejs.org, then double-click this file again.
  pause
  exit /b 1
)
node start-optout.mjs
pause
