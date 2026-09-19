@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   School Transport Platform - START
echo ============================================
echo.

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker was not found on PATH. Install/start Docker Desktop and try again.
    pause
    exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm was not found on PATH. Install pnpm and try again.
    pause
    exit /b 1
)

echo [1/4] Cleaning up any dev servers left over from a previous run...

rem A crashed session, a closed-without-stopping window, or a previous
rem start.bat run all leave a "pnpm dev" tree (and the ports it bound) behind.
rem Next.js in particular refuses to start a second dev server for the same
rem project while an old one is still alive ("Another next dev server is
rem already running"), so this MUST run before we launch anything new -
rem otherwise turbo just free-floats onto 3002/3003/... instead.
if exist "%~dp0.dev-server.pid" (
    set /p DEVPID=<"%~dp0.dev-server.pid"
    if defined DEVPID (
        echo       Stopping previous dev-server window - PID !DEVPID! and its children...
        taskkill /PID !DEVPID! /T /F >nul 2>nul
    )
    del "%~dp0.dev-server.pid" >nul 2>nul
)

for %%P in (3000 3001) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        echo       Stopping leftover process on port %%P - PID %%A
        taskkill /PID %%A /T /F >nul 2>nul
    )
)

rem Give Windows a moment to fully release the ports we just freed before
rem anything tries to bind them again.
timeout /t 2 /nobreak >nul

echo [2/4] Starting infrastructure (Postgres, Redis, MinIO)...
docker compose -f infra\docker-compose.yml --env-file .env up -d
if errorlevel 1 (
    echo [ERROR] Failed to start Docker infrastructure. Is Docker Desktop running?
    pause
    exit /b 1
)

echo       Waiting a few seconds for services to come up...
timeout /t 5 /nobreak >nul

echo [3/4] Starting API + Web dev servers in a new window...
powershell -NoProfile -Command "$p = Start-Process cmd -ArgumentList '/k','pnpm dev' -WorkingDirectory '%~dp0' -PassThru; $p.Id | Out-File -Encoding ascii '%~dp0.dev-server.pid'"

echo [4/4] Waiting for the servers to come up...
set READY=0
for /l %%N in (1,1,30) do (
    if "!READY!"=="0" (
        netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>nul
        if not errorlevel 1 (
            netstat -ano | findstr ":3001 " | findstr "LISTENING" >nul 2>nul
            if not errorlevel 1 set READY=1
        )
        if "!READY!"=="0" timeout /t 1 /nobreak >nul
    )
)

echo.
echo ============================================
if "%READY%"=="1" (
    echo   Started. Web and API are both listening.
) else (
    echo   Started, but Web/API are not both up yet.
    echo   Check the new window for errors.
)
echo     Web : http://localhost:3000
echo     API : http://localhost:3001/api/v1
echo ============================================
echo.
pause
