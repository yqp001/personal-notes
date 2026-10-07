# -*- coding: utf-8 -*-
"""润色 provider 抽象与工厂：全站唯一决定「用哪个大模型实现」的地方。

模块边界（spec Components）：
  - `PolishProvider` 定义可插拔契约；`mock.py` / `openai_compat.py` 各实现一份；
  - `get_provider()` 按 `current_app.config["AI_PROVIDER"]` 返回单例；
  - `routes/ai.py` 只负责参数校验、长度限制与错误码映射，不关心具体实现。

安全边界：本模块不读取任何环境变量（配置一律来自 `config.py` 校验过的 app.config），
也不拼接任何 prompt 之外的上游报文；`AI_API_KEY` 只在 provider 内部用于构造请求头。
"""


class PolishError(Exception):
    """携带错误码，由路由层直接映射为 fail(code)。"""

    def __init__(self, code, detail=""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


class PolishProvider:
    """润色 provider 契约：`name` + `polish(text)` + `available`。"""

    name = "base"

    def polish(self, text: str) -> str:
        raise NotImplementedError

    @property
    def available(self) -> bool:
        """当前配置下是否真的可用（mock 恒为 True；openai 取决于 Key 等是否齐备）。"""
        return True


# 单例缓存：key 为 provider 名，避免每个请求重复构造（openai 实现要读配置）
_cache = {}


def _singleton(key, factory):
    if key not in _cache:
        _cache[key] = factory()
    return _cache[key]


def get_provider():
    """按 config.AI_PROVIDER 返回单例；未知取值回退 mock 并打日志。"""
    from flask import current_app

    from core.ai.mock import MockProvider

    name = current_app.config.get("AI_PROVIDER", "mock")

    if name == "openai":
        # 延迟 import：requests 缺失或损坏时也不得影响 mock 模式的启动与演示
        from core.ai.openai_compat import OpenAICompatProvider

        return _singleton("openai", OpenAICompatProvider)

    if name != "mock":
        current_app.logger.warning("未知的 AI_PROVIDER=%r，已回退到 mock", name)

    return _singleton("mock", MockProvider)
