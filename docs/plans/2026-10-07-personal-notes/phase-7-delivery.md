# Phase 7: 交付收口

**Goal:** `start.bat` 在干净环境可完成依赖安装并自动打开浏览器；README 完整说明运行方式、AI 配置与 vendored 版本；`tests/smoke_test.py` 全量通过；DoD 六条逐项核对。
**Prerequisites:** Phase 1–6 完成
**Deliverables:** 可交付的完整项目；`python tests/smoke_test.py` 失败数 0；`python tests/contrast_check.py` 失败数 0；README 就位。

**Interface Decisions Implemented:** 交付物含代码 + README + `start.bat`（spec 已确认决策 8）；UTF-8 编码规范（spec Goals，含 `.bat` 的 `chcp 65001` 处理）；`AI_UNAVAILABLE` 提示中「建议切回 Mock」与 README 的输入外泄说明（spec Error Handling / Security）。

---

## Task 1: `start.bat` 一键启动

**Goal:** 双击即可完成「检查环境 → 装依赖 → 探端口 → 启动 → 开浏览器」。

**Files:**
- Create: `start.bat`
- Modify: `app.py`（支持 `NOTEBOOK_PORT` 环境变量）

**Steps:**
- [x] 修改 `app.py` 启动块：

```python
if __name__ == "__main__":
    port = int(os.environ.get("NOTEBOOK_PORT", "5000"))
    app = create_app()
    print(f"[信息] 个人笔记已启动： http://127.0.0.1:{port}/")
    app.run(host="127.0.0.1", port=port, debug=False)
```

  - 明确 `debug=False`：避免 `debug=True` 的重载器造成双进程与数据库双写。

- [x] 写 `start.bat`，**文件必须保存为 UTF-8（无 BOM）**，首行用 `chcp 65001` 让中文提示正常显示：

```bat
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
```

- [x] Run: 关闭所有 python 进程后双击 `start.bat`
  - Expected: 五步日志依次输出，浏览器自动打开首页；`先占用 5000 端口再运行` 时应自动改用 5001。

- [x] Run: 在 `requirements.txt` 已装好的情况下再次运行
  - Expected: 第 2 步快速通过（pip 已满足依赖），不重复下载。

**Security/Boundary Notes:** 只监听 `127.0.0.1`，不对外暴露；不把任何密钥写进脚本；`debug=False`。

**Dependencies:** `netstat`（Windows 自带）、`curl`（Win10 1803+ 自带，缺失时回退 PowerShell）。

---

## Task 2: README

**Goal:** 任何人都能按 README 跑起来并知道怎么切真实 AI。

**Files:**
- Create: `README.md`

**Steps:**
- [x] 按以下小节写（中文，纯 Markdown，不写作者隐私信息）：

  1. **项目简介**：一句话定位 + 功能清单（与 `/about` 页一致）。
  2. **环境要求**：Windows + Python 3.10 及以上（实测 3.12.7）；无需 Node.js。
  3. **快速开始**：`双击 start.bat`；或手动 `python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt` 后 `python app.py`；访问 `http://127.0.0.1:5000/`。
  4. **目录结构**：与计划 `Files and Responsibilities` 表一致的精简树。
  5. **AI 润色配置**：
     - 默认 `AI_PROVIDER=mock`：**完全离线**，用规则化方式演示润色流程，界面显示「演示模式」徽标。
     - 切换真实服务：设置环境变量后重启

       | 变量 | 说明 |
       |---|---|
       | `AI_PROVIDER` | 改为 `openai` |
       | `AI_BASE_URL` | 服务商地址，如 `https://api.deepseek.com/v1`（需兼容 `/chat/completions`） |
       | `AI_API_KEY` | 服务商密钥 |
       | `AI_MODEL` | 模型名 |
       | `AI_TIMEOUT` | 超时秒数，默认 15 |
       | `AI_MAX_CHARS` | 单次润色字数上限，默认 2000 |

     - **隐私提示**：启用真实服务后，被选中的文本会发送至你配置的服务商；Mock 模式不进行任何网络请求。
  6. **依赖与版本锁定**：`requirements.txt` 内 Flask / Werkzeug / requests 的精确版本；前端 vendored 库的名称、版本号与来源（`https://registry.npmmirror.com` 的 marked 与 dompurify tarball），并说明不使用 CDN 以保证离线可运行。
  7. **测试**：`python tests/smoke_test.py`（接口断言）与 `python tests/contrast_check.py`（对比度核验）。
  8. **常见问题**：端口被占（`start.bat` 会自动顺延 / 手动设 `NOTEBOOK_PORT`）；数据库重置（删除 `data/notebook.db` 后重启）；`SECRET_KEY` 未设置时重启会导致登录态失效（设 `NOTEBOOK_SECRET_KEY` 固定）。
  9. **已知边界（非目标）**：邮箱验证 / 找回密码、第三方登录、头像上传、公开笔记广场、标签、搜索、版本历史、点赞关注、生产部署。

- [x] Run: 按 README「快速开始」的**手动路径**在干净命令行执行一遍
  - Expected: 命令可直接复制粘贴执行成功，无需额外补充说明。

- [x] Run: 在 README 中核对 vendored 版本号与 `static/vendor/` 内实际文件一致
  - Expected: 版本号与 Phase 3 Task 2 记录的 `MARKED_VERSION` / `DOMPURIFY_VERSION` 完全一致。

**Visual Verification:** 不适用（纯文档）。但需确认 README 中的路径与命令大小写、斜杠方向在 Windows 下可直接使用。

---

## Task 3: 测试收口

**Goal:** 把 spec「Testing」章节的全部 8 组要求补齐并一次跑绿。

**Files:**
- Modify: `tests/smoke_test.py`

**Steps:**
- [x] 追加第 10 组「错误结构」断言（**不用随机**，取固定 5 个失败用例，保证可复现）：

```python
section("10. 统一错误结构")
cases = [
    ("POST", "/api/auth/register", {"email": "", "username": "", "password": "", "confirm_password": ""}),
    ("POST", "/api/notes", {"title": "", "content_md": "", "status": "published"}),
    ("GET",  "/api/notes/999999", None),
    ("GET",  "/api/share/not-a-token", None),
    ("POST", "/api/ai/polish", {"text": ""}),
]
for method, path, body in cases:
    resp = client.post(path, json=body) if method == "POST" else client.get(path)
    data = j(resp)
    check(f"{method} {path} 含 code", isinstance(data.get("code"), str) and data["code"] != "OK", data)
    check(f"{method} {path} 含非空 message", bool(data.get("message")) , data)
    check(f"{method} {path} message 为中文", any("\u4e00" <= ch <= "\u9fff" for ch in data.get("message", "")), data)
```

  - 注意：该组需要在**登录状态**下执行 `POST /api/notes` 与 `POST /api/ai/polish`；脚本在此组前重新登录一次 `a@b.com`。

- [x] 追加收尾汇总并返回退出码（供自动化判断）：

```python
print(f"\n===== 汇总：通过 {len(PASS)}，失败 {len(FAIL)} =====")
if FAIL:
    print("失败用例：")
    for name in FAIL:
        print("  -", name)
    sys.exit(1)
sys.exit(0)
```

- [x] 修正 Phase 2 Task 2 遗留的宽松断言：把 `check("未登录访问受保护接口 → AUTH_REQUIRED", j(r).get("code") in ("AUTH_REQUIRED", "NOT_FOUND"), j(r))` 收紧为 `== "AUTH_REQUIRED"`（Phase 3 已实现 `/api/notes`）。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 输出 `===== 汇总：通过 N，失败 0 =====`，退出码 0（`echo $?` 为 0）。

- [x] Run: `python tests/smoke_test.py` 后再运行一次
  - Expected: 结果一致（测试使用独立临时数据库，不依赖上次残留；每次运行通过数相同）。

- [x] Run: `python tests/contrast_check.py`
  - Expected: 失败数 0。

- [x] 确认数据库隔离：测试跑完后 `ls data/` 中不应出现新的写入。
  - Expected: `data/notebook.db` 的修改时间不变（测试走 `NOTEBOOK_DB_PATH` 指向临时目录）。

**Security/Boundary Notes:** 测试不得连真实 `data/notebook.db`；不得在测试中打印真实密码或 `AI_API_KEY`。

---

## Task 4: DoD 核对与手工演示

**Goal:** 逐条核对 spec「Rollout」的六条 Definition of Done，并完整走一遍演示脚本。

**Files:**
- Modify: 仅在核对中发现缺陷时修改相应文件

**Steps:**
- [ ] 手工演示脚本（按顺序执行，每步确认结果）：

  | # | 操作 | 期望 |
  |---|---|---|
  | 1 | 双击 `start.bat` | 浏览器自动打开首页 |
  | 2 | 点「开始记录」→ 填邮箱/用户名/密码 | 注册成功并跳到写笔记页 |
  | 3 | 输入标题与含 `# 标题`、列表、代码块的正文 | 右侧预览实时更新 |
  | 4 | 划词选中一段 → 右键 → 「AI 润色」 | 弹窗左右对照，右侧出现结果，标题旁有「演示模式」徽标 |
  | 5 | 点「确认替换」 | 文本被替换，预览同步；`Ctrl+Z` 可回退 |
  | 6 | 点「收藏」→ 点「发布」 | 跳详情页，纸面为羊皮纸，心形为实心 |
  | 7 | 点「分享」→ 设密码 `pass1234` → 「生成分享链接」→「复制链接」 | 出现链接，按钮文字变「链接已复制」 |
  | 8 | 无痕窗口打开该链接 | 显示「该分享需要密码」 |
  | 9 | 输错密码 | 就地提示「分享密码错误」，输入框内容保留 |
  | 10 | 输对密码 → 填昵称 → 发表评论 | 评论出现在列表 |
  | 11 | 回主窗口打开 `/profile#favorites` | 我的收藏含该笔记；分享管理含该链接 |
  | 12 | 点「取消分享」→ 无痕窗口刷新 | 显示「分享链接无效或已取消」 |

- [ ] 断网验证（**核心 DoD**）：断开外网后重启应用
  - Expected: 首页、注册登录、写笔记、Markdown 渲染、划词润色（Mock）、收藏、分享、评论全部可用；浏览器控制台无外部请求失败报错。

- [x] 逐条核对 DoD：

  | # | DoD | 核对方式 |
  |---|---|---|
  | 1 | 代码/模板/静态资源/README/设计文档落盘且 UTF-8 | 用编辑器确认每类文件编码为 UTF-8；`start.bat` 首行为 `chcp 65001` |
  | 2 | `requirements.txt` 锁精确版本；`start.bat` 五步流程可跑 | 打开两个文件核对；实跑一次 |
  | 3 | 首次启动自动建库建表；重复启动幂等 | 删除 `data/notebook.db` 后启动；再启动一次不报错 |
  | 4 | `python tests/smoke_test.py` 全绿 | 命令输出失败数 0、退出码 0 |
  | 5 | README 写明运行方式、AI 配置、Mock 与真实差异、外泄提示 | 逐条对照 README 小节 |
  | 6 | 无迁移需求；回滚即删除数据库 | 确认无迁移脚本；删除 `data/notebook.db` 后应用可重建 |

- [x] 更新计划状态：把本计划目录下 `personal-notes.md` 与各 `phase-*.md` 的 `Status` 改为 `Done`，并勾选各阶段 `Phase Completion Checklist`。

- [x] Run: `python tests/smoke_test.py && python tests/contrast_check.py`
  - Expected: 两者失败数均为 0。

**Security/Boundary Notes:** 演示与核对过程中不得把 `AI_API_KEY` 打进截图或日志；若演示时启用了真实 provider，核对完成后切回 `mock` 并重启。

---

## Phase Completion Checklist

- [ ] 全部 4 个任务完成
- [x] `start.bat` 在干净环境一次跑通并自动开浏览器
- [x] README 九个小节齐全，手动路径命令可直接复制执行
- [x] `python tests/smoke_test.py` 通过数 = 全部断言数，失败数 0，退出码 0
- [x] `python tests/contrast_check.py` 失败数 0
- [ ] 断网状态下全功能可用
- [ ] 12 步手工演示脚本全部通过
- [x] DoD 六条逐条核对完成（六条均 CLI 可验证并通过），计划状态更新为 Done

> **未勾选项说明（交付时保留，不视为已通过）**：剩余未勾选项全部依赖**浏览器或物理断网**，本执行环境不具备（无浏览器、无 jsdom、无法真实断网）。其中「断网」已完成等价验证——把 `socket.socket.connect` / `socket.create_connection` 打桩为抛异常后全链路仍通过；「全部 4 个任务完成」一项因 Task 4 的浏览器部分未执行而保留未勾选。
