# -*- coding: utf-8 -*-
"""集中配置：全站唯一读取环境变量的模块。

安全边界：AI_API_KEY 只在此处出现，不得写入模板、日志或前端响应。
"""

import os
import secrets

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Config:
    SECRET_KEY = os.environ.get("NOTEBOOK_SECRET_KEY") or secrets.token_hex(16)
    DB_PATH = os.environ.get("NOTEBOOK_DB_PATH") or os.path.join(BASE_DIR, "data", "notebook.db")

    AI_PROVIDER = os.environ.get("AI_PROVIDER", "mock")          # mock | openai
    AI_BASE_URL = os.environ.get("AI_BASE_URL", "")
    AI_API_KEY = os.environ.get("AI_API_KEY", "")
    AI_MODEL = os.environ.get("AI_MODEL", "")
    AI_TIMEOUT = int(os.environ.get("AI_TIMEOUT", "15"))
    AI_MAX_CHARS = int(os.environ.get("AI_MAX_CHARS", "2000"))
    AI_TEMPERATURE = float(os.environ.get("AI_TEMPERATURE", "0.3"))
