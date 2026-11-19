@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================================
echo   Jekyll Markdown Editor
echo   URL: http://127.0.0.1:5173/
echo   Press Ctrl+C to stop.
echo ====================================================
echo.
node server.js
echo.
echo [Server stopped]
pause
