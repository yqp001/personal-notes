# -*- coding: utf-8 -*-
"""统一响应构造 —— 全站唯一构造响应体的地方。

任何路由都不得手写 {"code": ...} 字面量。
"""

from flask import jsonify

from core import codes


def ok(data=None, http=200):
    """成功响应：code 固定为 OK，message 取统一文案。"""
    return jsonify({
        "code": codes.OK,
        "message": codes.MESSAGES[codes.OK],
        "data": data,
    }), http


def fail(code, http=None, message=None):
    """失败响应：message 从 MESSAGES 查表，HTTP 状态取 HTTP_STATUS 的默认值。"""
    status = http or codes.HTTP_STATUS.get(code, 400)
    return jsonify({
        "code": code,
        "message": message or codes.MESSAGES.get(code, "请求失败"),
        "data": None,
    }), status
