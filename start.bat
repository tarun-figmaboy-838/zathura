@echo off
rem Driftbound launcher (Windows): double-click to play.
rem Serves this folder on this PC only (127.0.0.1) and opens the game in your browser.
cd /d "%~dp0"
start "" http://127.0.0.1:8123
python serve.py 8123
if errorlevel 1 py serve.py 8123
