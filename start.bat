@echo off
rem Serves the app over http so the browser allows the camera and the model files.
rem Double-click this file, then keep the window open while you play.
cd /d "%~dp0"
echo Starting Gestura at http://localhost:8000  (close this window to stop)
rem Open the browser after a short delay so the server is ready.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"
python -m http.server 8000 || py -m http.server 8000
pause
