# -*- coding: utf-8 -*-
"""个人笔记 —— 应用入口：应用工厂 + 开发服务器启动。"""

import os

from flask import Flask, render_template, request
from werkzeug.exceptions import HTTPException

import config
from core import codes, db
from core.responses import fail
from core.security import current_user


def _warn_if_random_secret():
    """SECRET_KEY 回退到随机值时给出警告（开发用；重启后登录态失效）。"""
    if not os.environ.get("NOTEBOOK_SECRET_KEY"):
        print("[警告] 未设置 NOTEBOOK_SECRET_KEY，本次使用随机密钥，重启后登录态失效")


def create_app():
    app = Flask(__name__)
    app.config.from_object(config.Config)
    _warn_if_random_secret()

    # 首次启动自动建库建表（幂等）
    with app.app_context():
        db.init_db()
    app.teardown_appcontext(db.close_db)

    @app.errorhandler(404)
    def handle_not_found(error):
        """API 路径返回统一 JSON；页面路径渲染中文 404 页。"""
        if request.path.startswith("/api/"):
            return fail(codes.NOT_FOUND)
        return render_template("404.html"), 404

    @app.errorhandler(Exception)
    def handle_unexpected(error):
        """兜底：记录日志后返回统一中文提示，绝不向前端泄漏堆栈。"""
        # HTTP 语义异常（405、400 等）保持自身状态码，不降级成 500
        if isinstance(error, HTTPException):
            return error
        app.logger.exception("未捕获异常：%s", error)
        return fail(codes.INTERNAL_ERROR)

    # 供 base.html 判断登录态（Phase 1 为 None 占位，Phase 2 接入真实实现）
    @app.context_processor
    def inject_user():
        return {"current_user": current_user()}

    from routes.ai import ai_bp
    from routes.auth import auth_bp
    from routes.notes import notes_bp
    from routes.pages import pages_bp
    from routes.profile import profile_bp
    from routes.share import share_bp

    app.register_blueprint(pages_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(profile_bp)
    app.register_blueprint(notes_bp)
    app.register_blueprint(share_bp)
    app.register_blueprint(ai_bp)

    return app


if __name__ == "__main__":
    # 端口可由 NOTEBOOK_PORT 覆盖（start.bat 探测到 5000 被占用时顺延）。
    # 明确 debug=False：避免重载器造成双进程与数据库双写。
    port = int(os.environ.get("NOTEBOOK_PORT", "5000"))
    application = create_app()
    print(f"[信息] 个人笔记已启动： http://127.0.0.1:{port}/")
    application.run(host="127.0.0.1", port=port, debug=False)
