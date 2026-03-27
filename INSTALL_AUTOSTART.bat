@echo off
:: Registers SDC State Logic Builder to start automatically at Windows login
:: Run this ONCE as Administrator

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set TASK_NAME=SDC-StateLogic-Server

echo.
echo  Installing auto-start task for SDC State Logic Builder...
echo.

:: Delete old task if exists
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create scheduled task: run at logon, hidden, keep restarting
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd /c cd /d \"%APP_DIR%\" && node server.js" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f ^
  /delay 0000:10 ^
  /it

if %ERRORLEVEL%==0 (
  echo  [OK] Auto-start task installed successfully.
  echo.
  echo  The server will now start automatically every time you log in to Windows.
  echo  Access the app at: http://localhost:3131
  echo.
  echo  To remove auto-start, run:
  echo    schtasks /delete /tn "%TASK_NAME%" /f
) else (
  echo  [ERROR] Failed to install. Try running this file as Administrator.
)

pause
