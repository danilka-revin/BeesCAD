@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8080
if "%HOST%"=="" set HOST=127.0.0.1
set URL=http://127.0.0.1:%PORT%

where node >nul 2>nul || (
  echo [Ошибка] Node.js не найден. Установите Node.js 18+ с https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\.package-lock.json" (
  echo ==^> Установка зависимостей...
  if exist "package-lock.json" (
    call npm ci --no-audit --no-fund --no-update-notifier
  ) else (
    call npm install --no-audit --no-fund --no-update-notifier
  )
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist "dist\index.html" (
  echo ==^> Сборка приложения...
  call npm run build --no-update-notifier
  if errorlevel 1 ( pause & exit /b 1 )
)

echo ==^> Запуск BeesCAD на %URL%
start "" "%URL%"
node scripts\server.mjs %PORT% --host %HOST%
