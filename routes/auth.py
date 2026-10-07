# -*- coding: utf-8 -*-
"""认证接口：注册、登录、退出、当前用户。

模块边界：本模块只做参数校验、调用 `core.security` 与 `core.db`，
不自行手写 `{"code": ...}` 字面量（一律经 `core/responses.py`）。
安全边界：登录失败不区分「邮箱不存在」与「密码错误」；不记录明文密码。
"""

import re

from flask import Blueprint, request

import core.db as db
from core import codes
from core.responses import fail, ok
from core.security import (
    current_user,
    hash_password,
    login_user,
    logout_user,
    verify_password,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# 与设计文档「注册」校验规则逐字一致
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _json_body():
    """只接受 JSON 请求体；非 JSON 或空体一律视为空字典，交由字段校验处理。"""
    return request.get_json(silent=True) or {}


@auth_bp.post("/register")
def register():
    """注册；成功后直接建立登录态。校验顺序见实施计划 Task 2 的表格。"""
    data = _json_body()
    email = data.get("email")
    username = data.get("username")
    password = data.get("password")
    confirm = data.get("confirm_password")

    # 1. 字段齐全（缺字段或类型不对）
    if not all(isinstance(value, str) for value in (email, username, password, confirm)):
        return fail(codes.INVALID_PARAMS)

    email = email.strip()

    # 2. 邮箱格式
    if not EMAIL_RE.match(email):
        return fail(codes.EMAIL_INVALID)

    # 3. 用户名非空
    username = username.strip()
    if not username:
        return fail(codes.USERNAME_REQUIRED)

    # 4. 密码长度
    if len(password) < 6:
        return fail(codes.PASSWORD_TOO_SHORT)

    # 5. 两次密码一致
    if password != confirm:
        return fail(codes.PASSWORD_MISMATCH)

    # 6. 邮箱查重（列定义为 COLLATE NOCASE，大小写不敏感）
    if db.query("SELECT id FROM users WHERE email = ?", (email,)):
        return fail(codes.EMAIL_EXISTS)

    # 7. 入库并登录
    user_id = db.execute(
        "INSERT INTO users (email, username, password_hash, bio, created_at) VALUES (?,?,?,?,?)",
        (email, username, hash_password(password), "", db.now_iso()),
    ).lastrowid
    login_user(user_id)
    return ok({"user": current_user()}, 201)


@auth_bp.post("/login")
def login():
    """登录；邮箱不存在与密码错误返回同一个 code，避免探测。"""
    data = _json_body()
    email = data.get("email")
    password = data.get("password")

    if not isinstance(email, str) or not isinstance(password, str):
        return fail(codes.INVALID_PARAMS)

    rows = db.query(
        "SELECT id, password_hash FROM users WHERE email = ?", (email.strip(),)
    )
    if not rows or not verify_password(password, rows[0]["password_hash"]):
        return fail(codes.LOGIN_FAILED)

    login_user(rows[0]["id"])
    return ok({"user": current_user()})


@auth_bp.post("/logout")
def logout():
    """退出登录。"""
    logout_user()
    return ok()


@auth_bp.get("/me")
def me():
    """当前用户；未登录时 `data.user` 为 null（HTTP 200，不报错）。"""
    return ok({"user": current_user()})
