# -*- coding: utf-8 -*-
"""页面路由：只渲染 Jinja2 模板，不读写数据库。

Phase 1 先以占位模板渲染全部 10 条路由，保证骨架可用、无 500；
Phase 2 起各页面陆续接入真实数据（登录守卫、编辑页、羊皮纸详情等）。
"""

from flask import Blueprint, redirect, render_template

from core.security import current_user

pages_bp = Blueprint("pages", __name__)


@pages_bp.route("/")
def home():
    """主页落地页。"""
    return render_template("index.html")


@pages_bp.route("/login")
def login():
    """登录页；已登录直接回个人主页。"""
    if current_user():
        return redirect("/profile")
    return render_template("login.html")


@pages_bp.route("/register")
def register():
    """注册页；已登录直接回个人主页。"""
    if current_user():
        return redirect("/profile")
    return render_template("register.html")


@pages_bp.route("/profile")
def profile():
    """个人主页：个人信息 + 我的笔记 + 我的收藏 + 分享管理（需登录）。"""
    if not current_user():
        return redirect("/login")
    return render_template("profile.html")


@pages_bp.route("/notes")
def notes_list():
    """我的笔记列表。"""
    return render_template("notes_list.html")


@pages_bp.route("/notes/new")
def note_new():
    """写笔记页（需登录）。"""
    if not current_user():
        return redirect("/login")
    return render_template("note_edit.html")


@pages_bp.route("/notes/<int:note_id>")
def note_detail(note_id):
    """笔记详情页（羊皮纸）。"""
    return render_template("note_detail.html")


@pages_bp.route("/notes/<int:note_id>/edit")
def note_edit(note_id):
    """编辑已有笔记（需登录）。"""
    if not current_user():
        return redirect("/login")
    return render_template("note_edit.html")


@pages_bp.route("/about")
def about():
    """关于页。"""
    return render_template("about.html")


@pages_bp.route("/share/<token>")
def share(token):
    """公开分享页（可带密码锁与评论区）。"""
    return render_template("share.html")
