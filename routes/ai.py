# -*- coding: utf-8 -*-
"""AI 润色接口：provider 状态查询与文本润色（全部要求登录）。

模块边界（spec Components）：本模块只做参数校验、长度限制与错误码映射，
prompt 拼接与上游调用一律交给 `core.ai`；不直接接触数据库与网络。

安全边界：
  - 两个接口都必须 `login_required`（spec 滥用限制）；
  - 长度上限取 `AI_MAX_CHARS`（不硬编码）；
  - 上游异常一律换算成 spec 错误码，绝不把上游报文透传给前端；
  - 响应体只经 `core.responses` 构造，`AI_API_KEY` 不会出现在任何响应中。
"""

from flask import Blueprint, current_app, request

from core import codes
from core.ai.base import PolishError, get_provider
from core.responses import fail, ok
from core.security import login_required

ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")


@ai_bp.get("/status")
@login_required
def status():
    """报告当前 provider 与其可用性，前端据此决定是否显示「演示模式」徽标。"""
    provider = get_provider()
    return ok({"provider": provider.name, "available": bool(provider.available)})


@ai_bp.post("/polish")
@login_required
def polish():
    """校验入参 → 调用 provider → 映射错误码；成功返回 polish 结果与 provider 名。"""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return fail(codes.INVALID_PARAMS)

    text = payload.get("text")
    if not isinstance(text, str):
        return fail(codes.INVALID_PARAMS)
    if not text.strip():
        return fail(codes.AI_EMPTY_TEXT)
    if len(text) > current_app.config["AI_MAX_CHARS"]:
        return fail(codes.AI_TOO_LONG)

    provider = get_provider()
    try:
        polished = provider.polish(text)
    except PolishError as exc:
        current_app.logger.warning("AI 润色失败：%s %s", exc.code, exc.detail)
        return fail(exc.code)
    except Exception as exc:  # noqa: BLE001 - 任何上游异常都换算成 AI_UNAVAILABLE
        current_app.logger.warning("AI 润色异常：%r", exc)
        return fail(codes.AI_UNAVAILABLE)

    return ok({"polished": polished, "provider": provider.name})
