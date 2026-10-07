# -*- coding: utf-8 -*-
"""个人笔记 —— 颜色对比度核验（纯标准库，无第三方依赖，不使用 Pillow）。

按 WCAG 2.x 相对亮度公式计算前景 / 背景的对比度，逐项核对 spec
「Accessibility and Visual Verification」里承诺的阈值：

    正文 ≥ 4.5:1、羊皮纸正文 ≥ 7:1、次要文字 ≥ 4.5:1、
    按钮文字 ≥ 4.5:1、链接 ≥ 4.5:1、错误提示 ≥ 4.5:1。

用法：
    python tests/contrast_check.py

退出码：全部达标为 0，任一项不达标为 1。
"""

import sys


def lum(hexcolor):
    """sRGB 相对亮度（WCAG 定义）。"""
    c = [int(hexcolor[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(fg, bg):
    """前景 / 背景对比度，保留两位小数。"""
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return round((hi + 0.05) / (lo + 0.05), 2)


# (名称, 前景, 背景, 要求)
CHECKS = [
    ("正文",        "#3D3730", "#F7F4EE", 4.5),
    ("次要文字",    "#6F665C", "#F7F4EE", 4.5),
    ("链接/主按钮", "#7A5C2E", "#F7F4EE", 4.5),
    ("主按钮白字",  "#FFFFFF", "#7A5C2E", 4.5),
    ("羊皮纸正文",  "#4A3B2A", "#F2E7D0", 7.0),
    ("纸面链接",    "#7A5C2E", "#F2E7D0", 4.5),
    ("错误提示",    "#9E4A34", "#F7F4EE", 4.5),
]


def main():
    bad = 0
    for name, fg, bg, need in CHECKS:
        r = ratio(fg, bg)
        ok = r >= need
        bad += 0 if ok else 1
        print("%s %s: %s:1（需 ≥ %s:1）" % ("[OK]  " if ok else "[FAIL]", name, r, need))
    print("失败数:", bad)
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
