# -*- coding: utf-8 -*-
"""OpenAI 兼容 provider：按 OpenAI Chat Completions 协议调用真实大模型。

契约（spec Components / Error Handling）：
  - `POST {AI_BASE_URL}/chat/completions`，超时 `AI_TIMEOUT`（默认 15s）；
  - `available` 仅在 base_url / api_key / model 三者齐备时为 True；
  - 上游超时 → `AI_TIMEOUT`；连接失败 / 非 200 / 响应不可解析 / 空内容 → `AI_UNAVAILABLE`。

安全边界：`AI_API_KEY` 只用于本条请求的 Authorization 头，绝不写入日志、响应或模板；
上游报文只以**截断后**的形式进日志（`resp.text[:300]`），不返回前端。
提示：启用真实 provider 会把选中的文本片段发送至所配置的服务商。
"""

import requests
from flask import current_app

import core.codes as codes
from core.ai.base import PolishError, PolishProvider

SYSTEM_PROMPT = (
    "你是一位中文写作润色助手。请在不改变原意、不增删事实的前提下，"
    "提升输入文本的流畅度、清晰度与文采。只输出润色后的文本本身，"
    "不要输出任何解释、前后缀、引号或 Markdown 代码块。"
)

# 日志中上游报文的最大长度：避免把整段上游响应写进日志
UPSTREAM_LOG_LIMIT = 300


class OpenAICompatProvider(PolishProvider):
    """OpenAI 兼容协议的润色实现；不做任何 prompt 拼接以外的业务逻辑。"""

    name = "openai"

    def __init__(self):
        config = current_app.config
        self.base_url = (config.get("AI_BASE_URL") or "").rstrip("/")
        self.api_key = config.get("AI_API_KEY") or ""
        self.model = config.get("AI_MODEL") or ""
        self.timeout = config.get("AI_TIMEOUT", 15)
        self.temperature = config.get("AI_TEMPERATURE", 0.3)

    @property
    def available(self):
        return bool(self.base_url and self.api_key and self.model)

    def polish(self, text: str) -> str:
        if not self.available:
            raise PolishError(codes.AI_UNAVAILABLE, "AI 服务未配置")

        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        }
        try:
            resp = requests.post(
                self.base_url + "/chat/completions",
                json=payload,
                timeout=self.timeout,
                headers={
                    "Authorization": "Bearer " + self.api_key,
                    "Content-Type": "application/json",
                },
            )
        except requests.Timeout:
            raise PolishError(codes.AI_TIMEOUT)
        except requests.RequestException:
            raise PolishError(codes.AI_UNAVAILABLE)

        if resp.status_code != 200:
            current_app.logger.warning(
                "AI 上游返回 %s: %s", resp.status_code, resp.text[:UPSTREAM_LOG_LIMIT]
            )
            raise PolishError(codes.AI_UNAVAILABLE)

        try:
            content = resp.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise PolishError(codes.AI_UNAVAILABLE, "无法解析上游响应")

        if not content or not content.strip():
            current_app.logger.warning("AI 上游返回空内容")
            raise PolishError(codes.AI_UNAVAILABLE, "上游返回空内容")

        return content.strip()
