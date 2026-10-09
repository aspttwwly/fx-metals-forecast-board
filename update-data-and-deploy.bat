@echo off
setlocal
cd /d "%~dp0"
set "PYTHON_EXE=%FX_PYTHON_EXE%"
if not defined PYTHON_EXE set "PYTHON_EXE=%USERPROFILE%\.conda\envs\quant_stock\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=C:\ProgramData\miniconda3\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"
"%PYTHON_EXE%" -B -X utf8 scripts\sync-data.py
set "RESULT=%ERRORLEVEL%"
if /I "%AUTOMATED%"=="1" exit /b %RESULT%
pause
exit /b %RESULT%
