@echo off
rem Driftbound launcher (Windows): double-click to play.
rem Serves this folder on this PC only (127.0.0.1) and opens the game in your browser.
cd /d "%~dp0"
echo Driftbound is running at http://127.0.0.1:8123  (close this window to stop it)
start "" http://127.0.0.1:8123
python -m http.server 8123 --bind 127.0.0.1
if errorlevel 1 py -m http.server 8123 --bind 127.0.0.1
