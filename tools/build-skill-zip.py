#!/usr/bin/env python3
"""把技能目录打成 WorkBuddy 开放平台可上传的 ZIP（无第三方依赖）。

平台接收 .zip，大小不超过 3MB，包里核心文件是 SKILL.md。
官方文档给出的目录树以技能名为根：

    workbuddy-thread-context/
        SKILL.md
        references/
        scripts/

因此默认产出带一层技能名目录的包。若平台解析报错（提示缺少 SKILL.md），
再用 --flat 产出根目录直接放 SKILL.md 的版本。

用法：
    python tools/build-skill-zip.py            # 产出两个版本
    python tools/build-skill-zip.py --flat     # 只产出扁平版
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = ROOT / "skills" / "workbuddy-thread-context"
DIST = ROOT / "dist"
NAME = "workbuddy-thread-context"

SKIP_PARTS = {"__pycache__", ".DS_Store"}
SKIP_SUFFIX = {".pyc", ".pyo"}


def skill_version():
    text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    m = re.search(r"^version:\s*([0-9A-Za-z.\-]+)", text, re.M)
    return m.group(1) if m else "0.0.0"


def iter_files():
    for p in sorted(SKILL_DIR.rglob("*")):
        if not p.is_file():
            continue
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if p.suffix in SKIP_SUFFIX:
            continue
        yield p


def build(flat):
    DIST.mkdir(parents=True, exist_ok=True)
    ver = skill_version()
    suffix = "-flat" if flat else ""
    out = DIST / f"{NAME}-{ver}{suffix}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in iter_files():
            rel = p.relative_to(SKILL_DIR)
            arc = str(rel) if flat else f"{NAME}/{rel}"
            z.write(p, arc)
    return out


if __name__ == "__main__":
    flat_only = "--flat" in sys.argv
    outs = [build(True)] if flat_only else [build(False), build(True)]
    for o in outs:
        print(f"已生成 {o.relative_to(ROOT)}  ({o.stat().st_size} 字节)")
