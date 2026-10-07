# -*- coding: utf-8 -*-
"""Mock 润色 provider：纯离线、确定性、只做格式规范化。

边界（spec Security / Deferred #1）：不访问网络、不读环境变量、不使用随机数，
只做「空白归一 → 去除汉字间空格 → 中英文标点规范 → 合并重复标点 → 句末标点补全 → 相邻重复词去除」
六步格式变换，**不做任何事实性改写**；同一输入必然得到同一输出。

规则 5、6 是对 spec Deferred #1 的落实：该条明确允许「实现时若演示效果不理想可增补规则」。
增加前，示例输入 `这是  一段,,需要润色的文字` 会被润色成 `这是 一段，,需要润色的文字。`，
既留着汉字间空格又出现 `，,` 混用标点，演示观感像功能故障。
"""

import re

from core.ai.base import PolishProvider

CJK = r"\u4e00-\u9fff"

# 汉字后需要转全角的 ASCII 标点
_PUNCT_MAP = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！"}

# 已可收尾的标点：命中即不再补「。」
_END = "。！？…～）」』\"'"
# 其它可接受的收尾标点：以它们结尾同样不补「。」（避免出现「，。」这类双标点）
_TAIL = "。！？；，：、】》"

# 规则 5：汉字 + 空格/制表符 + 汉字
_CJK_WS_RE = re.compile("([" + CJK + "])[ \t]+([" + CJK + "])")

# 规则 6：可参与「重复/混用」合并的标点连续段
_PUNCT_RUN_RE = re.compile("[，。！？；：,.!?;:]+")
_FULL_PUNCT = "，。！？；："
_ASCII_TO_FULL = {",": "，", ".": "。", "!": "！", "?": "？", ";": "；", ":": "："}


def _collapse_ws(text):
    """空白归一：行内连续空格/制表符折成一个空格，≥3 个连续换行折成 2 个。"""
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def _strip_cjk_spaces(text):
    """去除汉字之间的多余空格（中文正文不使用词间空格）。

    只处理「汉字 空格 汉字」；汉字与英文之间、英文与英文之间的空格一律保留，
    因此 `你好 world 吗` 不受影响。空格类只含空格与制表符，换行不受影响。
    循环到稳定，以覆盖「甲 乙 丙」这类相邻多处空格。
    """
    while True:
        new = _CJK_WS_RE.sub(r"\1\2", text)
        if new == text:
            return text
        text = new


def _normalize_punct(text):
    """仅当 ASCII 标点紧跟在汉字之后时转全角，避免破坏英文与代码。"""
    for half, full in _PUNCT_MAP.items():
        # "\\" 只产生一个反斜杠：模式形如 ([\u4e00-\u9fff])\,
        text = re.sub("([" + CJK + "])\\" + half, lambda m, f=full: m.group(1) + f, text)
    return text


def _collapse_punct(text):
    """合并紧邻的重复 / 混用标点，例如「，,」「。。」→ 单个全角标点。

    为免破坏英文里的正常写法（如省略号 `a...b`、`1.2`、`e.g.`），
    只在「该段含全角标点」或「紧邻汉字」时才合并；长度为 1 的标点一律不处理。
    """
    def repl(match):
        run = match.group(0)
        if len(run) < 2:
            return run
        before = text[match.start() - 1] if match.start() > 0 else ""
        after = text[match.end()] if match.end() < len(text) else ""
        cjk_neighbor = bool(re.match("[" + CJK + "]", before)) or bool(re.match("[" + CJK + "]", after))
        has_full = any(ch in _FULL_PUNCT for ch in run)
        if not (has_full or cjk_neighbor):
            return run
        for ch in run:
            if ch in _FULL_PUNCT:
                return ch
        return _ASCII_TO_FULL.get(run[0], run[0])

    return _PUNCT_RUN_RE.sub(repl, text)


def _ensure_end_punct(text):
    """句末标点补全：缺收尾标点时补「。」，已规范文本原样返回。"""
    stripped = text.rstrip()
    if not stripped:
        return text
    if stripped[-1] not in _END and stripped[-1] not in _TAIL:
        return stripped + "。"
    return text


def _dedupe_words(text):
    """相邻重复词去除：重复的英文词，以及紧邻重复的 2–4 字中文词。"""
    text = re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", text)                 # 重复的英文词
    return re.sub(r"([\u4e00-\u9fff]{2,4})\1+", r"\1", text)         # 紧邻重复的 2–4 字中文词


class MockProvider(PolishProvider):
    """默认 provider：规则化润色，输出确定、可预期、无外部依赖。"""

    name = "mock"

    @property
    def available(self):
        """Mock 无任何外部依赖，恒为可用。"""
        return True

    def polish(self, text):
        """依次应用六条规则（顺序固定）；去重放最后，避免把标点并入重复片段。"""
        text = _collapse_ws(text)
        text = _strip_cjk_spaces(text)
        text = _normalize_punct(text)
        text = _collapse_punct(text)
        text = _ensure_end_punct(text)
        return _dedupe_words(text)
