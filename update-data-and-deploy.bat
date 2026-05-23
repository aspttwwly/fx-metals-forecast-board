@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE=%USERPROFILE%\.conda\envs\quant_stock\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=C:\ProgramData\miniconda3\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"

echo.
echo ========================================
echo FX Metals Forecast Data Update
echo ========================================
echo.

echo [1/5] Converting upload file Excel files...
"%PYTHON_EXE%" scripts\convert-data.py
if errorlevel 1 goto fail

echo.
echo [2/5] Checking generated data changes...
git status --porcelain public/data > "%TEMP%\fx_metals_data_changes.txt"
for %%A in ("%TEMP%\fx_metals_data_changes.txt") do set CHANGE_SIZE=%%~zA

if "%CHANGE_SIZE%"=="0" (
  del "%TEMP%\fx_metals_data_changes.txt" >nul 2>nul
  echo.
  echo No public/data changes found. Nothing to commit.
  echo Checking for pending GitHub push...
  git push
  if errorlevel 1 goto fail
  echo.
  echo ========================================
  echo Done. Cloudflare will deploy automatically if anything was pushed.
  echo ========================================
  echo.
  pause
  exit /b 0
)

del "%TEMP%\fx_metals_data_changes.txt" >nul 2>nul

echo.
echo [3/5] Staging generated data files...
git add public/data
if errorlevel 1 goto fail

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set STAMP=%%I

echo.
echo [4/5] Creating Git commit...
git commit -m "Update forecast data %STAMP%"
if errorlevel 1 goto fail

echo.
echo [5/5] Pushing to GitHub for Cloudflare deploy...
git push
if errorlevel 1 goto fail

echo.
echo ========================================
echo Done. Cloudflare will deploy automatically.
echo ========================================
echo.
pause
exit /b 0

:fail
echo.
echo ========================================
echo Failed. Please read the error above.
echo ========================================
echo.
pause
exit /b 1
