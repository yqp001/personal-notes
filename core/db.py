# -*- coding: utf-8 -*-
"""SQLite 连接管理、建表与全站唯一的 SQL 出入口。

模块边界：本模块是唯一直接持有 sqlite3 连接与 SQL 的地方；
`routes/*` 只能调用这里暴露的 `query()` / `execute()`，不得自行 `sqlite3.connect`。
所有 SQL 一律使用 `?` 占位符，禁止字符串拼接。
"""

import os
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g

# 逐字采用设计文档「数据模型」章节的 5 段 CREATE TABLE 与 CREATE INDEX，
# 仅追加 IF NOT EXISTS 以保证重复启动幂等。
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  content_md   TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_user_status ON notes(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS shares (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id       INTEGER NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname   TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, created_at);

CREATE TABLE IF NOT EXISTS favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, note_id)
);
"""


def _connect():
    """建立一条配置好外键约束与 WAL 的连接。"""
    path = current_app.config["DB_PATH"]
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_db():
    """取当前请求上下文内的连接（惰性建立、请求内复用）。"""
    if "db" not in g:
        g.db = _connect()
    return g.db


def close_db(exc=None):
    """请求结束关闭连接；注册在 app.teardown_appcontext 上。"""
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    """建表建索引；幂等，可在每次启动时安全调用。"""
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()


def query(sql, args=()):
    """执行查询并返回 sqlite3.Row 列表。"""
    return get_db().execute(sql, args).fetchall()


def execute(sql, args=()):
    """执行写操作并提交，返回游标（可取 lastrowid / rowcount）。"""
    conn = get_db()
    cursor = conn.execute(sql, args)
    conn.commit()
    return cursor


def now_iso():
    """当前时间戳：ISO-8601 UTC 字符串。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
