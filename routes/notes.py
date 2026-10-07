# -*- coding: utf-8 -*-
"""笔记接口：列表、创建、详情、更新、删除（全部要求登录）。

模块边界：SQL 一律经 `core.db`，全部使用 `?` 占位符；响应一律经 `core.responses`，
不得手写 `{"code": ...}` 字面量。
安全边界：每条查询都带 `user_id = current_user.id`；查不到即返回 `NOTE_NOT_FOUND`
（**不使用 `FORBIDDEN`**，避免探测他人笔记是否存在）。
"""

import re

from flask import Blueprint, request

import core.db as db
from core import codes
from core.responses import fail, ok
from core.security import current_user, login_required

notes_bp = Blueprint("notes", __name__, url_prefix="/api/notes")

# 允许的笔记状态（与 notes 表的 CHECK 约束一致）
STATUSES = ("draft", "published")

# 摘要长度：去 Markdown 符号后取前 60 字
EXCERPT_LENGTH = 60


def _excerpt(content_md):
    """正文摘要：去掉常见 Markdown 符号后取前 60 字。

    只做纯文本化，不追求完整 Markdown 语义（渲染由前端 vendored 库负责）。
    """
    text = content_md or ""
    text = re.sub(r"```.*?```", " ", text, flags=re.S)              # 围栏代码块
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)            # 图片 → 替代文字
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)             # 链接 → 链接文字
    text = re.sub(r"`([^`]*)`", r"\1", text)                         # 行内代码
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)        # 标题标记
    text = re.sub(r"^\s{0,3}>\s*", "", text, flags=re.M)             # 引用标记
    text = re.sub(r"^\s{0,3}(?:[-*+]|\d+\.)\s+", "", text, flags=re.M)  # 列表标记
    text = re.sub(r"[*_~]", "", text)                                # 强调符号
    text = re.sub(r"\s+", " ", text).strip()
    return text[:EXCERPT_LENGTH]


def _read_payload():
    """读取并校验创建/更新笔记的公共入参。

    返回 `(title, content_md, status, error_code)`；`error_code` 非空时表示校验失败。
    """
    data = request.get_json(silent=True) or {}
    title = data.get("title", "")
    content_md = data.get("content_md", "")
    status = data.get("status")

    if not isinstance(title, str) or not isinstance(content_md, str):
        return None, None, None, codes.INVALID_PARAMS
    if status not in STATUSES:
        return None, None, None, codes.INVALID_PARAMS
    if status == "published" and not title.strip():
        return None, None, None, codes.NOTE_TITLE_REQUIRED
    return title, content_md, status, None


@notes_bp.get("")
@login_required
def list_notes():
    """我的笔记列表；`status=all`（默认）/`draft`/`published`，按 updated_at 倒序。"""
    status = request.args.get("status", "all")
    if status not in ("all",) + STATUSES:
        return fail(codes.INVALID_PARAMS)

    sql = (
        "SELECT id, title, status, content_md, created_at, updated_at"
        " FROM notes WHERE user_id = ?"
    )
    args = [current_user()["id"]]
    if status != "all":
        sql += " AND status = ?"
        args.append(status)
    # 次级排序键 id 保证同一时间戳下顺序确定
    sql += " ORDER BY updated_at DESC, id DESC"

    notes = [
        {
            "id": row["id"],
            "title": row["title"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "excerpt": _excerpt(row["content_md"]),
        }
        for row in db.query(sql, tuple(args))
    ]
    return ok({"notes": notes})


@notes_bp.post("")
@login_required
def create_note():
    """新建笔记：草稿允许空标题，发布必须填写标题。"""
    title, content_md, status, error = _read_payload()
    if error:
        return fail(error)

    now = db.now_iso()
    published_at = now if status == "published" else None
    note_id = db.execute(
        "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at, published_at)"
        " VALUES (?,?,?,?,?,?,?)",
        (current_user()["id"], title, content_md, status, now, now, published_at),
    ).lastrowid
    return ok({"id": note_id}, 201)


@notes_bp.get("/<int:note_id>")
@login_required
def get_note(note_id):
    """笔记详情；不属于当前用户时按「不存在」处理。"""
    user_id = current_user()["id"]
    rows = db.query(
        "SELECT id, title, content_md, status, created_at, updated_at, published_at,"
        " EXISTS(SELECT 1 FROM favorites"
        "        WHERE favorites.note_id = notes.id AND favorites.user_id = ?) AS favorited"
        " FROM notes WHERE id = ? AND user_id = ?",
        (user_id, note_id, user_id),
    )
    if not rows:
        return fail(codes.NOTE_NOT_FOUND)

    row = rows[0]
    return ok({
        "note": {
            "id": row["id"],
            "title": row["title"],
            "content_md": row["content_md"],
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "published_at": row["published_at"],
            "favorited": bool(row["favorited"]),
        }
    })


@notes_bp.put("/<int:note_id>")
@login_required
def update_note(note_id):
    """更新笔记；仅当由 draft 变为 published 时补填 published_at。"""
    title, content_md, status, error = _read_payload()
    if error:
        return fail(error)

    user_id = current_user()["id"]
    rows = db.query(
        "SELECT id, published_at FROM notes WHERE id = ? AND user_id = ?",
        (note_id, user_id),
    )
    if not rows:
        return fail(codes.NOTE_NOT_FOUND)

    now = db.now_iso()
    published_at = rows[0]["published_at"]
    if status == "published" and not published_at:
        published_at = now

    db.execute(
        "UPDATE notes SET title = ?, content_md = ?, status = ?, updated_at = ?, published_at = ?"
        " WHERE id = ? AND user_id = ?",
        (title, content_md, status, now, published_at, note_id, user_id),
    )
    return ok({"id": note_id})


@notes_bp.delete("/<int:note_id>")
@login_required
def delete_note(note_id):
    """删除笔记；级联删除由外键约束处理。"""
    cursor = db.execute(
        "DELETE FROM notes WHERE id = ? AND user_id = ?",
        (note_id, current_user()["id"]),
    )
    if cursor.rowcount == 0:
        return fail(codes.NOTE_NOT_FOUND)
    return ok()
