@echo off
setlocal
cd /d "%~dp0"
title HCM Lite - Setup and Run

echo ==================================================
echo  HCM Lite - Saylani Hackathon Project
echo ==================================================
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS including npm.
  pause
  exit /b 1
)
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo Created backend\.env from the example.
  echo Please configure MONGODB_URI and replace JWT_SECRET before starting.
  notepad "backend\.env"
  pause
  exit /b 1
)
echo Installing project packages...
call npm install
if errorlevel 1 (
  echo Package installation failed. Check your internet connection and npm output above.
  pause
  exit /b 1
)
echo Starting API and web app...
call npm run dev
pause
