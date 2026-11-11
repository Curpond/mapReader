@echo off
rem Stop the map reader started by start.bat (normally you can just close its window).
title MapReader - stop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

node scripts\stop.mjs
echo.
rem 停一会儿再关窗口，方便看清结果（ping 比 timeout 稳，不依赖 stdin）
ping -n 4 127.0.0.1 >nul
