@echo off
title video-review
cd /d "%~dp0"
if not exist node_modules ( echo Instalando dependencias... && call npm install )
if not exist .env ( copy .env.example .env >nul && echo Creado .env: revisa DATA_REPO antes de seguir. && pause )
start "" http://localhost:5180
node server/index.js
pause
