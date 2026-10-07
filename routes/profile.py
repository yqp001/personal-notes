# -*- coding: utf-8 -*-
"""个人信息与收藏接口。

本阶段实现 `PUT /api/profile`、`GET /api/favorites` 与 `POST /api/notes/<id>/favorite`。
模块边界：只做参数校验与 `current_user()` 取用户，SQL 一律经 `core.db`。
安全边界：收藏只能针对**自己的**笔记；每条查询都带 `user_id = current_user.id`，
查不到即按「不存在」处理（`NOTE_NOT_FOUND`），避免探测他人笔记是否存在。
"""

from flask import Blueprint, request

import core.db as db
from core import codes
from core.responses import fail, ok
from core.security import current_user, login_required, login_user

profile_bp = Blueprint("profile", __name__, url_prefix="/api")

# 简介长度上限（设计文档「个人信息更新」：bio 允许空、≤ 200 字）
BIO_MAX_LENGTH = 200


@profile_bp.put("/profile")
@login_required
def update_profile():
    """更新当前用户的用户名与简介。"""
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    bio = data.get("bio", "")

    if not isinstance(username, str) or not isinstance(bio, str):
        return fail(codes.INVALID_PARAMS)

    username = username.strip()
    if not username:
        return fail(codes.USERNAME_REQUIRED)
    if len(bio) > BIO_MAX_LENGTH:
        return fail(codes.INVALID_PARAMS)

    user = current_user()
    db.execute(
        "UPDATE users SET username = ?, bio = ? WHERE id = ?",
        (username, bio, user["id"]),
    )
    # 重新建立同一用户的登录态：顺带失效 current_user() 的请求内缓存，
    # 使本响应回读到的就是更新后的资料（session 内容不变）。
    login_user(user["id"])
    return ok({"user": current_user()})


@profile_bp.post("/notes/<int:note_id>/favorite")
@login_required
def toggle_favorite(note_id):
    """切换收藏：已收藏则取消、未收藏则收藏；返回收藏后的状态。"""
    user_id = current_user()["id"]

    # 只能收藏自己的笔记：查不到（含他人的笔记）一律按「不存在」处理
    rows = db.query(
        "SELECT id FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
    )
    if not rows:
        return fail(codes.NOTE_NOT_FOUND)

    existing = db.query(
        "SELECT id FROM favorites WHERE user_id = ? AND note_id = ?", (user_id, note_id)
    )
    if existing:
        db.execute(
            "DELETE FROM favorites WHERE user_id = ? AND note_id = ?", (user_id, note_id)
        )
        return ok({"favorited": False})

    db.execute(
        "INSERT INTO favorites (user_id, note_id, created_at) VALUES (?,?,?)",
        (user_id, note_id, db.now_iso()),
    )
    return ok({"favorited": True})


@profile_bp.get("/favorites")
@login_required
def list_favorites():
    """我收藏的笔记列表，按收藏时间倒序。"""
    rows = db.query(
        "SELECT n.id, n.title, n.status, n.created_at, n.updated_at"
        " FROM favorites f JOIN notes n ON n.id = f.note_id"
        " WHERE f.user_id = ?"
        " ORDER BY f.created_at DESC, f.id DESC",
        (current_user()["id"],),
    )
    notes = [
        {
            "id": row["id"],
            "title": row["title"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]
    return ok({"notes": notes})


@profile_bp.get("/share/mine")
@login_required
def list_my_shares():
    """我生成的分享链接列表，按创建时间倒序（只含当前用户的笔记）。"""
    rows = db.query(
        "SELECT s.note_id, n.title AS note_title, s.token, s.password_hash, s.created_at"
        " FROM shares s JOIN notes n ON n.id = s.note_id"
        " WHERE n.user_id = ?"
        " ORDER BY s.created_at DESC, s.id DESC",
        (current_user()["id"],),
    )
    shares = [
        {
            "note_id": row["note_id"],
            "note_title": row["note_title"],
            "token": row["token"],
            "url": "/share/%s" % row["token"],
            "has_password": bool(row["password_hash"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]
    return ok({"shares": shares})
