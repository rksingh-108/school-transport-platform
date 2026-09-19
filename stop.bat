@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   School Transport Platform - STOP
echo ============================================
echo.

echo [1/2] Stopping API (port 3001) and Web (port 3000) dev servers...

rem Primary path: start.bat saves the PID of the "pnpm dev" window it opened.
rem Killing that PID with /T takes down its whole tree (cmd, pnpm, turbo,
rem next, nest) in one shot - this is more reliable than matching on window
rem title, which doesn't work the same way on every terminal host.
if exist "%~dp0.dev-server.pid" (
    set /p DEVPID=<"%~dp0.dev-server.pid"
    if defined DEVPID (
        echo       Stopping dev-server window - PID !DEVPID! and its children...
        taskkill /PID !DEVPID! /T /F >nul 2>nul
    )
    del "%~dp0.dev-server.pid" >nul 2>nul
)

rem Belt-and-suspenders: also kill by port, in case dev servers were started
rem some other way (e.g. "pnpm dev" run directly in an existing terminal),
rem or the PID file is stale.
for %%P in (3000 3001) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        echo       Killing process on port %%P - PID %%A
        taskkill /PID %%A /T /F >nul 2>nul
    )
)

timeout /t 2 /nobreak >nul

set STILL_UP=0
for %%P in (3000 3001) do (
    netstat -ano | findstr ":%%P " | findstr "LISTENING" >nul 2>nul
    if not errorlevel 1 set STILL_UP=1
)
if "!STILL_UP!"=="1" (
    echo       WARNING: something is still listening on 3000/3001 - run this again or check Task Manager.
) else (
    echo       Confirmed: ports 3000 and 3001 are free.
)

echo [2/2] Stopping infrastructure containers (Postgres, Redis, MinIO)...
where docker >nul 2>nul
if errorlevel 1 (
    echo       Docker not found on PATH - skipping.
) else (
    docker compose -f infra\docker-compose.yml --env-file .env down
)

echo.
echo ============================================
echo   Stopped. Your database/storage data is
echo   preserved (volumes were not removed).
echo ============================================
echo.
pause
