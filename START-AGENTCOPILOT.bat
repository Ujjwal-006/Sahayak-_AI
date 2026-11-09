@echo off
title AgentCopilot Master Launcher
color 0A

:: Resolve backend directory
set "BACKEND_DIR=%~dp0"
if exist "%~dp0agentcopilot-backend\START-AGENTCOPILOT.bat" (
    set "BACKEND_DIR=%~dp0agentcopilot-backend\"
)
cd /d "%BACKEND_DIR%"

cls
echo ==============================================================================
echo   AGENTCOPILOT - REAL-TIME BFSI CALL-CENTER ASSISTANT
echo   Gnani AI Great Indian AI Internship Challenge
echo ==============================================================================
echo.
echo  [1/4] Checking ports 3003 and 4000...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3003 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      Ports 3003 and 4000 are ready.
echo.

echo  [2/4] Starting SaaS Backend (port 4000)...
start "AgentCopilot - SaaS Backend (:4000)" /D "%BACKEND_DIR%saas-backend" cmd /k "title SaaS Backend :4000 & color 0B & node node_modules/tsx/dist/cli.mjs src/server.ts"
echo      SaaS Backend window opened.
echo.

echo  [3/4] Starting Call Engine (port 3003)...
start "AgentCopilot - CallEngine (:3003)" /D "%BACKEND_DIR%call-engine" cmd /k "title Call Engine :3003 & color 0E & node node_modules/tsx/dist/cli.mjs index.ts"
echo      Call Engine window opened.
echo.

echo  [4/4] Waiting 3 seconds for servers to initialize...
timeout /t 3 /nobreak >nul

echo.
echo  Opening browser to http://localhost:4000/cockpit ...
start "" "http://localhost:4000/cockpit"

echo.
echo ==============================================================================
echo   ALL SYSTEMS ONLINE AND READY!
echo ==============================================================================
echo.
echo   Application URL: http://localhost:4000/cockpit
echo.
echo   PRE-SET DEMO ACCOUNTS:
echo   - Agent (Priya):       priya@demo-bfsi.com       / password123
echo   - Compliance (Cyril):  compliance@demo-bfsi.com  / password123
echo.
echo   HOW TO TEST:
echo   1. On the Cockpit screen, click "[PLAY DEMO CALL]" or "PLAY SAMPLE"
echo   2. Or click "LIVE MIC" to speak live into your laptop microphone!
echo   3. Watch live transcript, VU meters, compliance checklist & KB suggestions!
echo   4. Click "INSERT INTO RESPONSE" or "USE REPLY" to dispatch the suggested reply
echo   5. Click "SYNTHESIS" to hear the Hinglish voice reply!
echo   6. Click "END CALL" to view the laboratory QA audit report!
echo.
echo   (Leave this window and the two server console windows open while testing)
echo ==============================================================================
echo.
pause
