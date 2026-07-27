# Download Paper Collection Skill | 论文批量下载整理 Skill

[English](#english) | [中文](#中文)

---

<a id="中文"></a>
## 中文

可移植 Agent Skill，把异构的 Excel 文献清单转成**经验证、可审计的论文集合**。

### 核心能力

- **自适应工作簿识别**：自动识别含论文的工作表、表头字段（标题/来源/DOI/arXiv），支持合并表头、多行表头、多个来源列
- **置信度评分**：对自动识别结果打分，低置信度时回退到显式 CLI 或 JSON 映射
- **多源合并**：PDF 直链 / URL / DOI / arXiv / OpenReview 混合来源统一处理
- **会话认证**：支持用户提供的 Cookie、Authorization 头、自定义请求头用于出版商/机构源
- **去重**：按 DOI / arXiv ID / 标题去重
- **完整性校验**：PDF 完整性校验、断点续传、失败恢复
- **可审计输出**：生成清单（manifest）记录每篇论文的来源、状态、校验结果

### 触发场景

- 用户给一份 `.xlsx` / `.xlsm` 论文清单，要求批量下载
- "帮我下载这些论文"、"整理这份文献列表"、"续传上次没下完的"
- 混合公开源、出版商源、机构源、需要会话登录的源

### 安装

```bash
python3 -m pip install -r requirements.txt
```

将 `download-paper-collection` 目录放到 Agent 客户端的 skills 目录下。

---

<a id="english"></a>
## English

A skills-compatible package for turning heterogeneous Excel literature lists into validated, auditable paper collections.

Version 3.1.0 retains the adaptive workbook adapter instead of binding the downloader to one Excel template. It recognizes paper-bearing sheets, scores schema confidence, supports merged/multi-row headers and multiple source columns, and lets an Agent fall back to explicit CLI or JSON mappings when automatic recognition is uncertain.

## Install

```bash
python3 -m pip install -r requirements.txt
```

Place the `download-paper-collection` directory in the skills directory used by your Agent client.

## Portable Skill metadata

The `SKILL.md` frontmatter uses the conservative cross-host top-level allowlist:

```yaml
name:
description:
metadata:
license:        # optional
allowed-tools:  # optional
```

Custom fields such as `version`, `compatibility`, `author`, and `domain` belong under `metadata`. Runtime requirements are also documented in the `## Dependencies` section of `SKILL.md`. This layout passes the current Codex validator while remaining suitable for Agent Skills-compatible clients.

Validate the package format with:

```bash
python3 scripts/validate_skill.py .
```

## Recommended flow

```bash
SKILL_DIR="/absolute/path/to/download-paper-collection"

python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/papers.xlsx" \
  --inspect-only \
  --schema-out "/tmp/paper-schema.json"

python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/papers.xlsx" \
  --output "/path/to/paper-collection" \
  --resume

python3 "$SKILL_DIR/scripts/validate_collection.py" \
  --collection "/path/to/paper-collection"
```

## Explicit mapping for unusual workbooks

```bash
python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/papers.xlsx" \
  --sheets "论文总表" \
  --title-column "作品名" \
  --venue-column "载体" \
  --source-columns "公开获取" "DOI字段" \
  --inspect-only
```

For reusable layouts:

```bash
python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/papers.xlsx" \
  --schema-config "/path/to/schema.json" \
  --inspect-only
```

See `references/schema-config.example.json`.

## Adaptive behavior

The parser supports:

- mixed paper, explanation, statistics, and empty worksheets;
- hidden-sheet exclusion;
- header rows within the first 40 rows;
- merged and up-to-three-row headers;
- bilingual or separate English/Chinese titles;
- optional venue/year fields;
- multiple PDF, URL, DOI, arXiv, and OpenReview columns;
- DOI/arXiv/title-based deduplication;
- candidate-column reports for low-confidence structures;
- deterministic fallback titles for source-only records.

Low-confidence profile inference never authorizes a download by itself. The Agent must confirm the columns through explicit mapping.

## Output

```text
paper-collection/
├── source-workbook.xlsx
├── 结构识别报告.json
├── 下载清单.csv
├── 下载清单.json
├── 运行日志.jsonl
├── 下载报告.json
├── 推荐精读/
│   └── IEEE TGRS/
│       └── Paper title.pdf
└── CCF-A论文/
    └── CVPR/
        └── Another paper.pdf
```

The manifest records source sheet/row, bilingual titles, venue/year, schema confidence, deduplication identity, original source columns, ranked source URLs, all network attempts, failure category, final URL, local path, size, and SHA-256.

## Access and network handling

The downloader may use public links, publisher/institutional links, landing-page cookies, and user-supplied request context. Provide session-dependent access with `--authorization`, repeatable `--header`, `--cookie`, `--cookie-file`, or `--user-agent`. A `401`, `403`, login page, entitlement page, or CAPTCHA/challenge response is recorded as recoverable and does not stop other sources or papers.

The integrity and network-safety checks remain enabled: unsafe URL schemes, private network targets by default, unsafe redirects, oversized responses, and non-PDF content are rejected. HTML challenge/login pages are never mislabeled as successful PDFs.

Example with an existing authorized session:

```bash
python3 scripts/download_papers.py \
  --input literature.xlsx \
  --output paper-collection \
  --cookie-file /path/to/cookies.txt \
  --header "Authorization: Bearer ..." \
  --user-agent "Mozilla/5.0 ..." \
  --resume
```

Cookie files use the standard Netscape/Mozilla `cookies.txt` format. The downloader records only header names and whether session data was supplied; secret values are not written into manifests or the run journal.

## Test

```bash
python3 scripts/validate_skill.py .
python3 scripts/smoke_test.py --verbose
```
