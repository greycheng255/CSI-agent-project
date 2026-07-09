@echo off
setlocal

set ROOT=%~dp0
set BACKEND_DIR=%ROOT%backend
set FRONTEND_DIR=%ROOT%frontend

set BACKEND_PORT=4000
set FRONTEND_PORT=5173
set VITE_API_BASE=http://127.0.0.1:%BACKEND_PORT%

echo Starting CSI local services...
echo.
echo Backend:  http://127.0.0.1:%BACKEND_PORT%
echo Frontend: http://127.0.0.1:%FRONTEND_PORT%
echo.

if /I "%~1"=="rebuild" (
  echo Rebuilding backend...
  pushd "%BACKEND_DIR%"
  call npm.cmd run build
  if errorlevel 1 (
    echo Backend build failed.
    pause
    exit /b 1
  )
  popd
)

if not exist "%BACKEND_DIR%\dist\main.js" (
  echo Backend dist not found. Building backend first...
  pushd "%BACKEND_DIR%"
  call npm.cmd run build
  if errorlevel 1 (
    echo Backend build failed.
    pause
    exit /b 1
  )
  popd
)

start "CSI Backend - localhost:%BACKEND_PORT%" /D "%BACKEND_DIR%" cmd /k "set PORT=%BACKEND_PORT%&& set AUTO_EXECUTION_ENABLED=false&& set LEGACY_RUNTIME_WEBHOOKS_ENABLED=false&& set LEGACY_TASK_WEBHOOKS_ENABLED=false&& npm.cmd run start:prod"

start "CSI Frontend - localhost:%FRONTEND_PORT%" /D "%FRONTEND_DIR%" cmd /k "set VITE_API_BASE=%VITE_API_BASE%&& npm.cmd run dev -- --host 127.0.0.1 --port %FRONTEND_PORT%"

echo Started backend and frontend windows.
echo Close those command windows to stop the services.
echo.
pause
