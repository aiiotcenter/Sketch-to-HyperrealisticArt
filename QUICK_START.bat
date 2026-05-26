@echo off
title GauGAN Studio - Quick Start
color 0B

echo.
echo  ================================================================
echo   GauGAN Studio - Satellite Map Generator
echo  ================================================================
echo.

REM ── Step 1: Check Python ──────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  [ERROR] Python not found!
    echo.
    echo  Please install Python 3.9+ from:
    echo  https://python.org/downloads
    echo.
    echo  IMPORTANT: Check "Add Python to PATH" during install!
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo  [OK] %%v found
echo.

REM ── Step 2: Install backend dependencies ─────────────────────────
echo  [1/4] Installing backend dependencies...
echo  (fastapi, uvicorn, pillow, numpy, httpx - no GPU needed)
echo.
cd /d "%~dp0backend"
pip install -r requirements.txt
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERROR] pip install failed.
    echo  Try running this manually in the backend folder:
    echo    pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)
echo.
echo  [OK] Dependencies ready
echo.

REM ── Step 3: Start backend in a new window ────────────────────────
echo  [2/4] Starting backend server...
echo.
start "GauGAN Backend [DO NOT CLOSE]" cmd /k ^
    "color 0A && ^
     echo. && ^
     echo  ===================================================== && ^
     echo   GauGAN Backend - Running on http://localhost:8000 && ^
     echo   Keep this window open while using the app! && ^
     echo   Press Ctrl+C to stop. && ^
     echo  ===================================================== && ^
     echo. && ^
     cd /d "%~dp0backend" && ^
     uvicorn main:app --reload --port 8000"

REM ── Step 4: Wait for backend to actually respond ──────────────────
echo  [3/4] Waiting for backend to be ready...
echo  (This checks http://localhost:8000/health every 2 seconds)
echo.

set READY=0
set TRIES=0

:WAIT_LOOP
set /a TRIES+=1
if %TRIES% GTR 30 (
    color 0C
    echo.
    echo  [ERROR] Backend did not start after 60 seconds.
    echo.
    echo  Check the backend window for error messages.
    echo  Common fixes:
    echo    - Port 8000 already in use: close other apps using it
    echo    - Missing packages: run pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

REM Ping the health endpoint - success means backend is ready
curl -s http://localhost:8000/health >nul 2>&1
if errorlevel 1 (
    <nul set /p "=."
    timeout /t 2 /nobreak >nul
    goto WAIT_LOOP
)

echo.
echo.
echo  [OK] Backend is ready at http://localhost:8000
echo.

REM ── Step 5: Open the app ──────────────────────────────────────────
echo  [4/4] Opening the app...
echo.

REM Check if Node.js is available for the React UI
node --version >nul 2>&1
if errorlevel 1 (
    REM No Node.js — open preview.html (it calls the backend at localhost:8000)
    echo  Node.js not found - opening preview.html
    echo  (Install Node.js from https://nodejs.org for the full React UI)
    echo.
    start "" "%~dp0preview.html"
    goto DONE
)

REM Node.js found — start the React frontend
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo  [OK] Node.js %%v found
echo.

cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo  Installing React dependencies (first time only, may take a minute)...
    npm install
    if errorlevel 1 (
        echo.
        echo  [WARNING] npm install failed - falling back to preview.html
        start "" "%~dp0preview.html"
        goto DONE
    )
    echo  [OK] React dependencies installed
    echo.
)

echo  Starting React frontend at http://localhost:3000 ...
echo.
start "GauGAN Frontend [DO NOT CLOSE]" cmd /k ^
    "color 0B && ^
     echo. && ^
     echo  ===================================================== && ^
     echo   GauGAN Frontend - http://localhost:3000 && ^
     echo   Keep this window open while using the app! && ^
     echo  ===================================================== && ^
     echo. && ^
     cd /d "%~dp0frontend" && ^
     npm start"

REM Wait a moment then open browser manually in case it doesn't auto-open
timeout /t 8 /nobreak >nul
start "" "http://localhost:3000"

:DONE
echo.
echo  ================================================================
echo.
echo   GauGAN Studio is running!
echo.
echo   App URL    →  http://localhost:3000
echo   Backend    →  http://localhost:8000
echo   API Docs   →  http://localhost:8000/docs
echo   Health     →  http://localhost:8000/health
echo.
echo   IMPORTANT: Keep the backend window open the whole time.
echo   You can close THIS window now.
echo.
echo  ================================================================
echo.
pause
