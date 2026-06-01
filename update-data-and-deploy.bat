@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE=%USERPROFILE%\.conda\envs\quant_stock\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=C:\ProgramData\miniconda3\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"
set "MAX_GIT_RETRIES=3"
set "GIT_RETRY_DELAY=10"

echo.
echo ========================================
echo FX Metals Forecast Data Update
echo ========================================
echo.

:run_update
echo [1/8] Checking GitHub connection...
call :git_check_with_retry
if errorlevel 1 goto network_fail

echo.
echo [2/8] Converting upload file Excel files...
"%PYTHON_EXE%" scripts\convert-data.py
if errorlevel 1 goto fail

echo.
echo [3/8] Checking generated data changes...
git status --porcelain public/data > "%TEMP%\fx_metals_data_changes.txt"
for %%A in ("%TEMP%\fx_metals_data_changes.txt") do set CHANGE_SIZE=%%~zA

if "%CHANGE_SIZE%"=="0" (
  del "%TEMP%\fx_metals_data_changes.txt" >nul 2>nul
  echo.
  echo No public/data changes found. Nothing to commit.
  echo.
  echo [4/8] Syncing latest GitHub changes...
  call :git_pull_with_retry
  if errorlevel 2 goto sync_fail
  if errorlevel 1 goto network_fail
  echo.
  echo [5/8] Checking for pending GitHub push...
  call :git_push_with_retry
  if errorlevel 1 goto push_fail
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
echo [4/8] Syncing latest GitHub changes before commit...
call :git_pull_with_retry
if errorlevel 2 goto sync_fail
if errorlevel 1 goto network_fail

echo.
echo [5/8] Staging generated data files...
git add public/data
if errorlevel 1 goto fail

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set STAMP=%%I

echo.
echo [6/8] Creating Git commit...
git commit -m "Update forecast data %STAMP%"
if errorlevel 1 goto fail

echo.
echo [7/8] Final GitHub sync check...
call :git_pull_with_retry
if errorlevel 2 goto sync_fail
if errorlevel 1 goto network_fail

echo.
echo [8/8] Pushing to GitHub for Cloudflare deploy...
call :git_push_with_retry
if errorlevel 1 goto push_fail

echo.
echo ========================================
echo Done. Cloudflare will deploy automatically.
echo ========================================
echo.
pause
exit /b 0

:git_check_with_retry
set "GIT_ATTEMPT=1"
:git_check_retry
git ls-remote --heads origin main >nul
if not errorlevel 1 exit /b 0
if %GIT_ATTEMPT% GEQ %MAX_GIT_RETRIES% exit /b 1
echo.
echo GitHub connection check failed. Retrying in %GIT_RETRY_DELAY% seconds... Attempt %GIT_ATTEMPT% of %MAX_GIT_RETRIES%.
timeout /t %GIT_RETRY_DELAY% /nobreak >nul
set /a GIT_ATTEMPT+=1
goto git_check_retry

:git_pull_with_retry
set "GIT_ATTEMPT=1"
:git_pull_retry
git pull --rebase --autostash origin main
if not errorlevel 1 exit /b 0
if exist ".git\rebase-merge" exit /b 2
if exist ".git\rebase-apply" exit /b 2
if %GIT_ATTEMPT% GEQ %MAX_GIT_RETRIES% exit /b 1
echo.
echo GitHub sync failed. Retrying in %GIT_RETRY_DELAY% seconds... Attempt %GIT_ATTEMPT% of %MAX_GIT_RETRIES%.
timeout /t %GIT_RETRY_DELAY% /nobreak >nul
set /a GIT_ATTEMPT+=1
goto git_pull_retry

:git_push_with_retry
set "GIT_ATTEMPT=1"
:git_push_retry
git push origin main
if not errorlevel 1 exit /b 0
if %GIT_ATTEMPT% GEQ %MAX_GIT_RETRIES% exit /b 1
echo.
echo GitHub push failed. Retrying in %GIT_RETRY_DELAY% seconds... Attempt %GIT_ATTEMPT% of %MAX_GIT_RETRIES%.
timeout /t %GIT_RETRY_DELAY% /nobreak >nul
set /a GIT_ATTEMPT+=1
goto git_push_retry

:network_fail
echo.
echo ========================================
echo Could not connect to GitHub after %MAX_GIT_RETRIES% attempts.
echo Local data changes or commits are kept on this computer.
echo Check the network, VPN, or proxy.
echo ========================================
echo.
choice /c RQ /n /m "Press R to retry now, or Q to quit: "
if errorlevel 2 goto fail
echo.
goto run_update

:push_fail
echo.
echo ========================================
echo GitHub push failed after %MAX_GIT_RETRIES% attempts.
echo Local data changes or commits are kept on this computer.
echo Check the network, VPN, or proxy.
echo ========================================
echo.
choice /c RQ /n /m "Press R to retry now, or Q to quit: "
if errorlevel 2 goto fail
echo.
goto run_update

:sync_fail
echo.
echo ========================================
echo GitHub sync stopped because Git needs manual conflict handling.
echo If Git reports conflicts, resolve them and run:
echo   git rebase --continue
echo Or cancel the sync with:
echo   git rebase --abort
echo ========================================
goto fail

:fail
echo.
echo ========================================
echo Failed. Please read the error above.
echo ========================================
echo.
pause
exit /b 1
