#!/usr/bin/env python3
"""validate_pdf_deep.py — 深度 PDF 校验

五重校验：%PDF 头、%%EOF 尾、文件大小、页数、题名 token 覆盖率 + DOI 匹配。
用于确认下载的 PDF 是真实论文，不是 HTML 登录页、错误页、补充材料或错配内容。

Windows Unicode 路径兼容：Poppler 的 pdfinfo/pdftotext 在 Git Bash 下对部分
Unicode 路径（上标 ²、en-dash –、中文）报 "No such file"，通过复制到 ASCII
临时目录解决。

依赖：poppler-utils (pdfinfo, pdftotext)

CLI:
  python validate_pdf_deep.py --pdf paper.pdf --title "[EN] Some Title" --doi "10.xxx/yyy"
  python validate_pdf_deep.py --pdf paper.pdf --title "Some Title" --min-pages 2

退出码：0 = 通过，2 = 校验失败，其他 = 参数错误
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path


def normalize(value: str) -> str:
    """归一化文本用于 token 匹配：NFKD → ASCII → 小写 → 提取字母数字"""
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def extract_english_title(value: str) -> str:
    """从 '[EN] xxx [中文] yyy' 格式中提取英文标题段"""
    match = re.search(r"\[EN\]\s*(.*?)(?:\s*\[中文\]|$)", value, re.S | re.I)
    return " ".join((match.group(1) if match else value).split())


def run_command(args: list[str]) -> str:
    """运行命令并返回 stdout，失败抛 RuntimeError"""
    proc = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:1000])
    return proc.stdout


def validate_pdf(pdf_path: Path, title: str, doi: str = "", min_pages: int = 2) -> dict:
    """
    校验 PDF 完整性和内容匹配。

    返回 dict 含：
    - valid: bool
    - errors: list[str]
    - bytes, sha256, signature, eof, pages
    - title_token_coverage, title_match, doi_match (如果 pdfinfo 可用)
    """
    result: dict[str, object] = {
        "pdf": str(pdf_path.resolve()),
        "valid": False,
        "errors": [],
    }
    errors: list[str] = result["errors"]  # type: ignore[assignment]

    if not pdf_path.exists():
        errors.append("file_missing")
        return result

    data = pdf_path.read_bytes()
    result.update({
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "signature": data[:8].decode("ascii", errors="replace"),
        "eof": data.rstrip().endswith(b"%%EOF"),
    })

    # 1. PDF 签名
    if not data.startswith(b"%PDF"):
        errors.append("invalid_pdf_signature")

    # 2. EOF 标记
    if not result["eof"]:
        errors.append("missing_eof")

    # 3. 文件大小（< 50KB 几乎不可能是真论文）
    if len(data) < 50_000:
        errors.append("file_too_small")

    # 4. pdfinfo 页数 + pdftotext 题名/DOI 匹配
    try:
        # Unicode 路径兜底：复制到 ASCII 临时目录
        tool_path = pdf_path
        temp_dir = None
        try:
            str(pdf_path).encode("ascii")
        except UnicodeEncodeError:
            temp_dir = tempfile.TemporaryDirectory(prefix="pdf-validate-")
            tool_path = Path(temp_dir.name) / "document.pdf"
            tool_path.write_bytes(data)

        info = run_command(["pdfinfo", str(tool_path)])
        pages_match = re.search(r"^Pages:\s+(\d+)", info, re.M)
        pages = int(pages_match.group(1)) if pages_match else 0
        result["pages"] = pages
        if pages < min_pages:
            errors.append("too_few_pages")

        text = run_command(["pdftotext", "-f", "1", "-l", "3", str(tool_path), "-"])

        if temp_dir is not None:
            temp_dir.cleanup()

        # 题名 token 覆盖率
        expected = normalize(extract_english_title(title))
        actual = normalize(text)
        expected_tokens = [t for t in expected.split() if len(t) >= 4]
        token_hits = sum(1 for token in expected_tokens if token in actual)
        token_coverage = token_hits / max(1, len(expected_tokens))
        title_ok = token_coverage >= 0.72 or expected in actual

        result["title_sequence_score"] = round(
            SequenceMatcher(None, expected, actual[: max(4000, len(expected) * 20)]).ratio(), 4
        )
        result["title_token_coverage"] = round(token_coverage, 4)
        result["title_match"] = title_ok
        result["expected_title"] = extract_english_title(title)

        if not title_ok:
            errors.append("title_mismatch")

        # DOI 匹配
        doi_norm = doi.lower().removeprefix("https://doi.org/").strip()
        doi_found = not doi_norm or doi_norm in text.lower() or doi_norm in info.lower()
        result["doi"] = doi_norm
        result["doi_match"] = doi_found

        if doi_norm and not doi_found:
            errors.append("doi_mismatch")

    except Exception as exc:
        errors.append("pdf_text_validation_failed")
        result["validation_exception"] = str(exc)

    result["valid"] = not errors
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="深度校验 PDF 完整性和内容匹配")
    parser.add_argument("--pdf", required=True, help="PDF 文件路径")
    parser.add_argument("--title", required=True, help="预期论文标题（可含 [EN]...[中文] 格式）")
    parser.add_argument("--doi", default="", help="预期 DOI（可选）")
    parser.add_argument("--min-pages", type=int, default=2, help="最少页数（默认 2）")
    args = parser.parse_args()

    result = validate_pdf(Path(args.pdf), args.title, args.doi, args.min_pages)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["valid"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
