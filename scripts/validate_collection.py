#!/usr/bin/env python3
"""Validate a paper collection against its generated manifest."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from download_papers import sha256_file, valid_pdf


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a downloaded paper collection")
    parser.add_argument("--collection", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, help="defaults to <collection>/下载清单.csv")
    parser.add_argument("--strict", action="store_true", help="treat orphan PDFs and warnings as errors")
    parser.add_argument("--min-pdf-bytes", type=int, default=1024)
    parser.add_argument("--json-out", type=Path)
    return parser.parse_args(argv)


def validate(collection: Path, manifest: Path, strict: bool, min_pdf_bytes: int) -> Dict[str, object]:
    errors: List[str] = []
    warnings: List[str] = []
    checked = 0
    manifest_paths = set()
    if not collection.is_dir():
        errors.append(f"collection directory not found: {collection}")
    if not manifest.is_file():
        errors.append(f"manifest not found: {manifest}")
        return {"ok": False, "checked": 0, "errors": errors, "warnings": warnings}

    root = collection.resolve()
    with manifest.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    for index, row in enumerate(rows, 2):
        status = row.get("status", "")
        local_path = (row.get("local_path") or "").strip()
        if status != "成功":
            if local_path:
                warnings.append(f"row {index}: failed record unexpectedly has local_path")
            continue
        checked += 1
        if not local_path:
            errors.append(f"row {index}: successful record has no local_path")
            continue
        candidate = (collection / local_path).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            errors.append(f"row {index}: local_path escapes collection: {local_path}")
            continue
        manifest_paths.add(candidate)
        if not valid_pdf(candidate, min_pdf_bytes):
            errors.append(f"row {index}: invalid or missing PDF: {local_path}")
            continue
        expected_size = (row.get("bytes") or "").strip()
        if expected_size and candidate.stat().st_size != int(expected_size):
            errors.append(f"row {index}: size mismatch: {local_path}")
        expected_hash = (row.get("sha256") or "").strip()
        if expected_hash and sha256_file(candidate) != expected_hash:
            errors.append(f"row {index}: sha256 mismatch: {local_path}")

    actual_pdfs = {path.resolve() for path in collection.rglob("*.pdf") if path.is_file()}
    orphans = sorted(path.relative_to(root).as_posix() for path in actual_pdfs - manifest_paths)
    if orphans:
        warnings.append(f"orphan PDFs not referenced by successful manifest rows: {orphans}")
    if strict and warnings:
        errors.extend(f"strict: {warning}" for warning in warnings)

    return {
        "ok": not errors,
        "checked": checked,
        "manifest_rows": len(rows),
        "pdf_files": len(actual_pdfs),
        "errors": errors,
        "warnings": warnings,
    }


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)
    manifest = args.manifest or args.collection / "下载清单.csv"
    result = validate(args.collection, manifest, args.strict, args.min_pdf_bytes)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    print(text)
    if args.json_out:
        args.json_out.write_text(text + "\n", encoding="utf-8")
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
