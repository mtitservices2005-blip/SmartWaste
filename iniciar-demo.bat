@echo off
cd /d "%~dp0"
echo Iniciando servidor local de la demo SmartWaste...
start "SmartWaste Demo Server" cmd /k node scripts\serve-demo.mjs
timeout /t 2 >nul
start "" http://localhost:8080/
