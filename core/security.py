# -*- coding: utf-8 -*-
"""认证与登录态：全站唯一的密码哈希、当前用户、登录守卫与分享解锁态实现。

模块边界：`routes/*` 只能通过 `@login_required` / `current_user()` 使用本模块；
不得在别处再写一份哈希或登录判断。
安全边界：密码与分享密码一律不落明文；`current_user()` 的返回值显式剔除 `password_hash`。
"""

from functools import wraps

from flask import g, session
from werkzeug.security import check_password_hash, generate_password_hash

import core.codes as codes
import core.db as db
from core.responses import fail


# ---------------------------------------------------------------------------
# 密码哈希
# ---------------------------------------------------------------------------


def hash_password(raw: str) -> str:
    """登录密码哈希：pbkdf2:sha256，带随机盐。"""
    return generate_password_hash(raw, method="pbkdf2:sha256")


def verify_password(raw, hashed) -> bool:
    """校验登录密码；任一入参缺失一律返回 False，不抛异常。"""
    if not raw or not hashed:
        return False
    return check_password_hash(hashed, raw)


def hash_share_password(raw: str) -> str:
    """分享密码哈希：与登录密码同等强度，独立命名以免混用。"""
    return generate_password_hash(raw, method="pbkdf2:sha256")


def verify_share_password(raw, hashed) -> bool:
    """校验分享密码；任一入参缺失一律返回 False，不抛异常。"""
    if not raw or not hashed:
        return False
    return check_password_hash(hashed, raw)


# ---------------------------------------------------------------------------
# 当前用户与登录态
# ---------------------------------------------------------------------------


def current_user():
    """返回当前登录用户字典（id/email/username/bio）；未登录返回 None。

    缓存在 `g._user` 上：命中已登录用户时同一请求内只查一次库。
    约定 `g._user = None` 表示「缓存失效」，因此 `login_user()` / `logout_user()`
    只需把 `g._user` 置为 None 即可；未登录状态不缓存（每次调用重新判定）。
    返回值显式构造，绝不直接返回 sqlite3.Row，也绝不包含 password_hash。
    """
    cached = getattr(g, "_user", None)
    if cached is not None:
        return cached

    user = None
    user_id = session.get("user_id")
    if user_id is not None:
        rows = db.query(
            "SELECT id, email, username, bio FROM users WHERE id = ?", (user_id,)
        )
        if rows:
            row = rows[0]
            user = {
                "id": row["id"],
                "email": row["email"],
                "username": row["username"],
                "bio": row["bio"],
            }
        else:
            # session 里的用户已不存在（被删除）：清掉脏登录态
            session.pop("user_id", None)

    g._user = user
    return user


def login_user(user_id: int) -> None:
    """建立登录态；同时失效 `current_user()` 的请求内缓存。"""
    session["user_id"] = user_id
    g._user = None


def logout_user() -> None:
    """清除登录态；同时失效 `current_user()` 的请求内缓存。"""
    session.pop("user_id", None)
    g._user = None


def login_required(view):
    """接口级登录守卫：未登录直接返回 AUTH_REQUIRED，不执行被保护的视图。"""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return fail(codes.AUTH_REQUIRED)
        return view(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# 分享解锁态（session 级）
# ---------------------------------------------------------------------------


def set_share_unlocked(token: str) -> None:
    """把 token 记入当前 session 的解锁列表（去重追加）。"""
    tokens = list(session.get("unlocked_shares", []))
    if token not in tokens:
        tokens.append(token)
    # 显式回写：原地 append 不会触发 SecureCookieSession 的 modified 标记
    session["unlocked_shares"] = tokens


def is_share_unlocked(token: str) -> bool:
    """该 token 在当前 session 中是否已解锁。"""
    return token in session.get("unlocked_shares", [])
