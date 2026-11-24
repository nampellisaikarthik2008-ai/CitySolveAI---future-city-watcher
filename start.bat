@echo off
title UrbanVista Launcher
echo ======================================================
echo           UrbanVista Municipal Intelligence
echo ======================================================
echo Starting FastAPI Backend on Port 8000...
start "UrbanVista Backend (FastAPI)" cmd /k "python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak >nul

echo Starting Vite Frontend on Port 5173...
start "UrbanVista Frontend (Vite)" cmd /k "npm.cmd run dev"

timeout /t 3 /nobreak >nul
echo.
echo ======================================================
echo Both servers are launching!
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:8000/docs
echo ======================================================
echo Opening browser...
start http://localhost:5173
exit
