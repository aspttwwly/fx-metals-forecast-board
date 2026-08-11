@echo off
setlocal

cd /d "%~dp0"

set "PYTHON_EXE=%FX_PYTHON_EXE%"
if not defined PYTHON_EXE set "PYTHON_EXE=%USERPROFILE%\.conda\envs\quant_stock\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=C:\ProgramData\miniconda3\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"
set "MAX_GIT_RETRIES=3"
set "GIT_RETRY_DELAY=10"
set "GITHUB_FALLBACK_IP=140.82.113.3"
set "GIT_HTTP_ROUTE="

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
echo [2/8] Preparing generated data and syncing latest GitHub changes...
call :prepare_generated_data
if errorlevel 1 goto sync_fail
call :git_pull_with_retry
if errorlevel 2 goto sync_fail
if errorlevel 1 goto network_fail

echo.
echo [3/8] Converting upload file Excel files...
"%PYTHON_EXE%" scripts\convert-data.py
if errorlevel 1 goto fail

echo.
echo [4/8] Checking generated data changes...
git status --porcelain public/data > "%TEMP%\fx_metals_data_changes.txt"
for %%A in ("%TEMP%\fx_metals_data_changes.txt") do set CHANGE_SIZE=%%~zA

if "%CHANGE_SIZE%"=="0" (
  del "%TEMP%\fx_metals_data_changes.txt" >nul 2>nul
  echo.
  echo No public/data changes found. Nothing to commit.
  echo.
  echo [5/8] Checking for pending GitHub push...
  call :git_push_with_retry
  if errorlevel 1 goto push_fail
  echo.
  echo ========================================
  echo Done. Cloudflare will deploy automatically if anything was pushed.
  echo ========================================
  echo.
  if /I "%AUTOMATED%"=="1" exit /b 0
  pause
  exit /b 0
)

del "%TEMP%\fx_metals_data_changes.txt" >nul 2>nul

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
if /I "%AUTOMATED%"=="1" exit /b 0
pause
exit /b 0

:git_check_with_retry
set "GIT_ATTEMPT=1"
:git_check_retry
git ls-remote --heads origin main >nul
if not errorlevel 1 exit /b 0
git -c http.curloptResolve=github.com:443:%GITHUB_FALLBACK_IP% ls-remote --heads origin main >nul
if not errorlevel 1 (
  set "GIT_HTTP_ROUTE=-c http.curloptResolve=github.com:443:%GITHUB_FALLBACK_IP%"
  echo Using alternate GitHub HTTPS route %GITHUB_FALLBACK_IP%.
  exit /b 0
)
if %GIT_ATTEMPT% GEQ %MAX_GIT_RETRIES% exit /b 1
echo.
echo GitHub connection check failed. Retrying in %GIT_RETRY_DELAY% seconds... Attempt %GIT_ATTEMPT% of %MAX_GIT_RETRIES%.
powershell -NoProfile -Command "Start-Sleep -Seconds %GIT_RETRY_DELAY%"
set /a GIT_ATTEMPT+=1
goto git_check_retry

:prepare_generated_data
git diff --name-only --diff-filter=U | findstr /V /B /C:"public/data/" > "%TEMP%\fx_metals_non_data_conflicts.txt"
for %%A in ("%TEMP%\fx_metals_non_data_conflicts.txt") do set NON_DATA_CONFLICT_SIZE=%%~zA
del "%TEMP%\fx_metals_non_data_conflicts.txt" >nul 2>nul
if not "%NON_DATA_CONFLICT_SIZE%"=="0" exit /b 1
git restore --source=HEAD --staged --worktree -- public/data
if errorlevel 1 exit /b 1
exit /b 0

:git_pull_with_retry
set "GIT_ATTEMPT=1"
:git_pull_retry
git %GIT_HTTP_ROUTE% pull --rebase --autostash origin main
if not errorlevel 1 exit /b 0
if exist ".git\rebase-merge" exit /b 2
if exist ".git\rebase-apply" exit /b 2
if %GIT_ATTEMPT% GEQ %MAX_GIT_RETRIES% exit /b 1
echo.
echo GitHub sync failed. Retrying in %GIT_RETRY_DELAY% seconds... Attempt %GIT_ATTEMPT% of %MAX_GIT_RETRIES%.
powershell -NoProfile -Command "Start-Sleep -Seconds %GIT_RETRY_DELAY%"
set /a GIT_ATTEMPT+=1
goto git_pull_retry

:git_push_with_retry
set "GIT_ATTEMPT=1"
:git_push_retry
git %GIT_HTTP_ROUTE% push origin main
if not errorlevel 1 exit /b 0
if %GIT_ATTEMPT% GEQ %MAX_GIT_RETRIES% exit /b 1
echo.
echo GitHub push failed. Retrying in %GIT_RETRY_DELAY% seconds... Attempt %GIT_ATTEMPT% of %MAX_GIT_RETRIES%.
powershell -NoProfile -Command "Start-Sleep -Seconds %GIT_RETRY_DELAY%"
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
if /I "%AUTOMATED%"=="1" goto fail
set "RETRY_CHOICE="
set /p "RETRY_CHOICE=Press R to retry now, or press Enter/Q to quit: "
if /I not "%RETRY_CHOICE%"=="R" goto fail
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
if /I "%AUTOMATED%"=="1" goto fail
set "RETRY_CHOICE="
set /p "RETRY_CHOICE=Press R to retry now, or press Enter/Q to quit: "
if /I not "%RETRY_CHOICE%"=="R" goto fail
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
if /I "%AUTOMATED%"=="1" exit /b 1
pause
exit /b 1
