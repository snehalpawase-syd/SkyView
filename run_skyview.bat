@echo off
title SkyView Flight Tracker Portal
echo ================================================================
echo   STARTING SKYVIEW TACTICAL FLIGHT TRACKER LOCAL PORTAL...
echo ================================================================
echo.

:: Navigate to the folder where this batch file is located
cd /d "%~dp0"

:: Launch browser after a 2-second delay to let the server bind to the port
start "" cmd /c "timeout /t 2 >nul && start http://localhost:8085"

:: Start the Node.js server
node server.js

pause
