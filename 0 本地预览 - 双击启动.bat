@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "PREVIEW_URL=http://127.0.0.1:4173/EURUSD?view=observatory"
set "HEALTH_URL=http://127.0.0.1:4173/"
set "PYTHON_EXE=%USERPROFILE%\.conda\envs\quant_stock\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=C:\ProgramData\miniconda3\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"

title FX Metals Forecast - Local Preview Launcher

echo.
echo ========================================
echo FX Metals Forecast - Local Preview
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto node_missing

echo [1/3] Refreshing forecast, terrain and trade-signal data...
"%PYTHON_EXE%" scripts\convert-data.py
if errorlevel 1 goto data_failed

call :check_ready
if not errorlevel 1 goto open_preview

echo [2/3] Starting local preview server on port 4173...
start "FX Metals Forecast Local Server" /min cmd /k "node server.mjs"

echo [3/3] Waiting for the page to become ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(20); do { try { $r=Invoke-WebRequest -UseBasicParsing -Uri '%HEALTH_URL%' -TimeoutSec 5; if ($r.StatusCode -eq 200 -and $r.Content -match 'data-terrain-card') { exit 0 } } catch {}; Start-Sleep -Milliseconds 350 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 goto start_failed

:open_preview
echo Opening local preview...
start "" "!PREVIEW_URL!"
echo.
echo Local address:
echo !PREVIEW_URL!
echo.
echo Keep the minimized "FX Metals Forecast Local Server" window open.
echo Close that window when you want to stop the local preview server.
echo.
ping 127.0.0.1 -n 3 >nul
exit /b 0

:check_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r=Invoke-WebRequest -UseBasicParsing -Uri '%HEALTH_URL%' -TimeoutSec 5; if ($r.StatusCode -eq 200 -and $r.Content -match 'data-terrain-card') { exit 0 } } catch {}; exit 1"
exit /b %errorlevel%

:node_missing
echo ERROR: Node.js was not found.
echo Please install Node.js, or add node.exe to the Windows PATH.
echo.
pause
exit /b 1

:data_failed
echo.
echo ERROR: Forecast/Terrain data conversion failed.
echo Check that the quant_stock Python environment and strategy outputs exist.
echo.
pause
exit /b 1

:start_failed
echo.
echo ERROR: The local preview server did not become ready within 15 seconds.
echo Port 4173 may be occupied by another program.
echo Please read the "FX Metals Forecast Local Server" window for details.
echo.
pause
exit /b 1
