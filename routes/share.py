# -*- coding: utf-8 -*-
"""分享接口：作者侧分享管理 + 公开读取 / 密码解锁 / 评论。

模块边界：SQL 一律经 `core.db`，全部使用 `?` 占位符；响应一律经 `core.responses`，
不得手写 `{"code": ...}` 字面量。
安全边界：
  - 分享管理接口校验 `note.user_id == current_user.id`，越权统一返回 `NOTE_NOT_FOUND`；
  - 公开接口只返回标题 / 正文 / 作者用户名 / 更新时间，绝不返回 note id、author id、
    作者邮箱、密码哈希或 token 列表；
  - 评论读写接口在分享设有密码且当前 session 未解锁时返回 `SHARE_PASSWORD_REQUIRED`
    （防止绕过密码留言）；
  - 作者本人不享受免密特例：与访客走同一套解锁流程。
"""

import secrets

from flask import Blueprint, request

import core.db as db
from core import codes
from core.responses import fail, ok
from core.security import (
    current_user,
    hash_share_password,
    is_share_unlocked,
    login_required,
    set_share_unlocked,
    verify_share_password,
)

share_bp = Blueprint("share", __name__, url_prefix="/api")

# 分享密码最短长度（spec：短于 4 位 → INVALID_PARAMS）
SHARE_PASSWORD_MIN = 4

# 评论相关限制（spec 错误码表 / 滥用限制）
NICKNAME_MAX = 30
COMMENT_MAX = 500


def _owned_note(note_id):
    """按当前用户取笔记；查不到（含他人的笔记）返回 None。"""
    rows = db.query(
        "SELECT id FROM notes WHERE id = ? AND user_id = ?",
        (note_id, current_user()["id"]),
    )
    return rows[0] if rows else None


def _share_by_token(token):
    """按 token 取分享及其所属笔记；不存在返回 None。

    只取公开接口需要的列，绝不带出作者邮箱等隐私字段。
    """
    rows = db.query(
        "SELECT s.note_id, s.token, s.password_hash,"
        "       n.title, n.content_md, n.updated_at,"
        "       u.username AS author_username"
        " FROM shares s"
        " JOIN notes n ON n.id = s.note_id"
        " JOIN users u ON u.id = n.user_id"
        " WHERE s.token = ?",
        (token,),
    )
    return rows[0] if rows else None


def _locked(row, token):
    """该分享是否处于「有密码且当前 session 未解锁」状态。"""
    return bool(row["password_hash"]) and not is_share_unlocked(token)


@share_bp.post("/notes/<int:note_id>/share")
@login_required
def create_or_update_share(note_id):
    """生成或重新生成分享链接。

    `shares` 表 `UNIQUE(note_id)`：已存在则更新 `password_hash` 并换发新 token，
    不存在则插入。`password` 为空串表示无密码。
    """
    if _owned_note(note_id) is None:
        return fail(codes.NOTE_NOT_FOUND)

    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    if not isinstance(password, str):
        return fail(codes.INVALID_PARAMS)
    if password and len(password) < SHARE_PASSWORD_MIN:
        return fail(codes.INVALID_PARAMS)

    password_hash = hash_share_password(password) if password else None
    token = secrets.token_urlsafe(16)

    existing = db.query("SELECT id FROM shares WHERE note_id = ?", (note_id,))
    if existing:
        db.execute(
            "UPDATE shares SET token = ?, password_hash = ?, created_at = ? WHERE note_id = ?",
            (token, password_hash, db.now_iso(), note_id),
        )
    else:
        db.execute(
            "INSERT INTO shares (note_id, token, password_hash, created_at) VALUES (?,?,?,?)",
            (note_id, token, password_hash, db.now_iso()),
        )

    return ok({
        "token": token,
        "url": "/share/%s" % token,
        "has_password": bool(password),
    })


@share_bp.delete("/notes/<int:note_id>/share")
@login_required
def cancel_share(note_id):
    """取消分享：只删除分享记录，绝不删除笔记。"""
    if _owned_note(note_id) is None:
        return fail(codes.NOTE_NOT_FOUND)

    db.execute("DELETE FROM shares WHERE note_id = ?", (note_id,))
    return ok()


@share_bp.get("/share/<token>")
def read_share(token):
    """公开读取分享内容（无需登录）。

    只返回 title / content_md / author_username / updated_at / has_password，
    绝不返回 note id、author id、作者邮箱、密码哈希或 token 列表。
    """
    row = _share_by_token(token)
    if row is None:
        return fail(codes.SHARE_NOT_FOUND)
    if _locked(row, token):
        return fail(codes.SHARE_PASSWORD_REQUIRED)

    return ok({
        "note": {
            "title": row["title"],
            "content_md": row["content_md"],
            "author_username": row["author_username"],
            "updated_at": row["updated_at"],
            "has_password": bool(row["password_hash"]),
        },
        "unlocked": not row["password_hash"] or is_share_unlocked(token),
    })


@share_bp.post("/share/<token>/unlock")
def unlock_share(token):
    """校验分享密码；成功后把 token 记入当前 session 的解锁列表。"""
    row = _share_by_token(token)
    if row is None:
        return fail(codes.SHARE_NOT_FOUND)

    # 免密分享：无需解锁，直接成功（幂等）
    if not row["password_hash"]:
        return ok()

    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    if not isinstance(password, str):
        return fail(codes.INVALID_PARAMS)
    if not verify_share_password(password, row["password_hash"]):
        return fail(codes.SHARE_PASSWORD_WRONG)

    set_share_unlocked(token)
    return ok()


@share_bp.get("/share/<token>/comments")
def list_comments(token):
    """评论列表（时间正序）。

    加锁分享在未解锁时返回 `SHARE_PASSWORD_REQUIRED`（防止绕过密码读取讨论）。
    """
    row = _share_by_token(token)
    if row is None:
        return fail(codes.SHARE_NOT_FOUND)
    if _locked(row, token):
        return fail(codes.SHARE_PASSWORD_REQUIRED)

    rows = db.query(
        "SELECT nickname, content, created_at FROM comments WHERE note_id = ?"
        " ORDER BY created_at ASC, id ASC",
        (row["note_id"],),
    )
    return ok({
        "comments": [
            {
                "nickname": r["nickname"],
                "content": r["content"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    })


@share_bp.post("/share/<token>/comments")
def add_comment(token):
    """发表评论。

    登录用户：`user_id` 记录当前用户，`nickname` 取用户名（忽略传入值）；
    游客：`user_id = NULL`，`nickname` 必填且不超过 30 字。
    加锁分享在未解锁时返回 `SHARE_PASSWORD_REQUIRED`（防止绕过密码留言）。
    """
    row = _share_by_token(token)
    if row is None:
        return fail(codes.SHARE_NOT_FOUND)
    if _locked(row, token):
        return fail(codes.SHARE_PASSWORD_REQUIRED)

    data = request.get_json(silent=True) or {}
    content = data.get("content", "")
    nickname = data.get("nickname", "")
    if not isinstance(content, str) or not isinstance(nickname, str):
        return fail(codes.INVALID_PARAMS)
    if not content.strip():
        return fail(codes.COMMENT_EMPTY)
    if len(content) > COMMENT_MAX:
        return fail(codes.COMMENT_TOO_LONG)

    user = current_user()
    if user is None:
        nickname = nickname.strip()
        if not nickname:
            return fail(codes.NICKNAME_REQUIRED)
        if len(nickname) > NICKNAME_MAX:
            return fail(codes.INVALID_PARAMS)
        user_id = None
    else:
        user_id = user["id"]
        nickname = user["username"]

    comment_id = db.execute(
        "INSERT INTO comments (note_id, user_id, nickname, content, created_at) VALUES (?,?,?,?,?)",
        (row["note_id"], user_id, nickname, content, db.now_iso()),
    ).lastrowid
    return ok({"id": comment_id}, 201)
