@echo off
title SDC State Logic Builder - Server (Always On)
color 0A

set APP_DIR=%~dp0
set PORT=3131

echo.
echo  ============================================================
echo   SDC State Logic Builder — Always-On Server
echo  ============================================================
echo   Access the app at:
echo     Local:    http://localhost:%PORT%
echo     Network:  (see below after start)
echo   This window must stay open.
echo   Minimize it — do NOT close it.
echo  ============================================================
echo.

:restart
echo  [%TIME%] Starting server on port %PORT%...
cd /d "%APP_DIR%"
node server.js
echo.
echo  [%TIME%] Server stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto restart
