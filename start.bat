@echo off
rem Double-click this file to launch the map reader.
rem Closing the console window stops the server.
title MapReader
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found. Please install it first: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node scripts\start.mjs %*
if errorlevel 1 (
    echo.
    echo Startup failed. See the messages above.
    echo.
    pause
)
