@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   个人笔记 - 一键启动
echo ============================================

python --version >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Python，请先安装 Python 3.10 及以上版本并加入 PATH。
  pause
  exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [1/5] Python !PYVER!

echo [2/5] 检查并安装依赖（清华源）...
python -m pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

set PORT=5000
:findport
netstat -ano | findstr /r /c:":!PORT! .*LISTENING" >nul
if not errorlevel 1 (
  set /a PORT=!PORT!+1
  if !PORT! gtr 5010 (
    echo [错误] 5000-5010 端口均被占用，请释放端口后重试。
    pause
    exit /b 1
  )
  goto findport
)
echo [3/5] 使用端口 !PORT!

set NOTEBOOK_PORT=!PORT!
echo [4/5] 启动服务...
start "个人笔记服务" cmd /k python app.py

echo [5/5] 等待服务就绪...
where curl >nul 2>&1
if errorlevel 1 goto wait_ps
:wait_curl
set CODE=
for /f %%c in ('curl -s -o nul -w "%%{http_code}" --max-time 2 http://127.0.0.1:!PORT!/ 2^>nul') do set CODE=%%c
if "!CODE!"=="200" goto ready
goto wait_next
:wait_ps
set CODE=
for /f %%c in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:!PORT!/).StatusCode}catch{''}" 2^>nul') do set CODE=%%c
if "!CODE!"=="200" goto ready
:wait_next
set /a TRIES=!TRIES!+1
if !TRIES! gtr 25 (
  echo [警告] 服务启动超时，请查看「个人笔记服务」窗口的输出。
  pause
  exit /b 1
)
timeout /t 1 >nul
where curl >nul 2>&1
if errorlevel 1 goto wait_ps
goto wait_curl

:ready
echo.
echo 服务已就绪，正在打开浏览器...
start "" http://127.0.0.1:!PORT!/
echo 关闭「个人笔记服务」窗口即可停止服务。
timeout /t 3 >nul
endlocal
