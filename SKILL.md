---
name: download-paper-collection
description: Adaptively inspect heterogeneous Excel literature lists, identify paper-bearing worksheets and title/source fields with confidence scoring, merge PDF/URL/DOI/arXiv/OpenReview sources, use available direct links and user-supplied authenticated sessions or request headers, deduplicate by DOI/arXiv/title, validate PDF integrity, and produce auditable manifests. Use when the user provides an .xlsx or .xlsm paper list and asks to batch download, resume, organize, validate, recover, or package papers across mixed public, publisher, institutional, or session-dependent sources.
metadata:
  version: "3.1.0"
  domain: "research-literature"
  workflow: "adaptive-inspect-map-download-validate-package"
  compatibility: "Requires Python 3.10+, openpyxl, PyYAML, writable local storage, and internet access. Optional Cookie, Authorization, and custom HTTP headers may be supplied for session-dependent sources."
---

# Download Paper Collection

Turn a heterogeneous Excel literature list into a verified collection:

`<worksheet>/<journal-or-conference>/<paper title>.pdf`

Use the bundled scripts. Do not write ad hoc parsing or download logic unless the workbook cannot be represented by the supported schema configuration.

## Dependencies

Required runtime:

- Python 3.10 or newer;
- `openpyxl` 3.1 or newer;
- `PyYAML` 6 or newer;
- writable local storage;
- network access when downloading papers.

Install Python dependencies with:

```bash
python3 -m pip install -r "$SKILL_DIR/requirements.txt"
```

Publisher, institutional, and session-dependent sources may require user-provided Cookie, Authorization, or custom request headers. The Skill should use the access context available in the execution environment, continue through alternative sources, and preserve actionable recovery information for unresolved interactive pages.

## Activation boundaries

Activate when the input is an `.xlsx` or `.xlsm` literature list and the user wants multiple papers downloaded, resumed, organized, validated, or packaged.

Do not activate for a single-paper summary, literature discovery without an input workbook, bibliography formatting, abstract translation, or citation analysis. Access requirements alone are not a reason to avoid this Skill.

## Required Agent flow

Resolve the absolute skill directory as `SKILL_DIR`. Never assume the current working directory.

### 1. Run adaptive preflight

```bash
python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/literature.xlsx" \
  --inspect-only \
  --schema-out "/tmp/paper-schema-report.json"
```

Read the JSON event and inspect:

- `accepted_sheets`;
- each sheet's `status`, `confidence`, `header_row`, and `header_span`;
- detected title, venue, and source columns;
- `candidate_columns` for low-confidence sheets;
- record, unique-paper, warning, and error counts.

The default confidence threshold is `0.72`.

### 2. Resolve schema uncertainty safely

Use this precedence:

`per-sheet schema config > CLI column mapping > alias config > automatic detection`

When a relevant sheet is `low_confidence` or `unrecognized`:

1. Inspect its candidate columns and workbook headers.
2. Prefer explicit mapping instead of lowering the threshold.
3. Retry preflight with one of these methods.

Direct mapping:

```bash
python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/literature.xlsx" \
  --sheets "论文总表" \
  --title-column "文档名" \
  --source-columns "PDF入口" "DOI字段" \
  --venue-column "刊物" \
  --inspect-only
```

Reusable JSON mapping:

```bash
python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/literature.xlsx" \
  --schema-config "$SKILL_DIR/references/schema-config.example.json" \
  --inspect-only
```

Read [references/workbook-schema.md](references/workbook-schema.md) before creating a custom mapping.

Never make an uncertain sheet downloadable merely by setting a very low confidence threshold. If the Agent cannot verify the intended title/source columns, stop and report the candidate mapping.

### 3. Download and resume

```bash
python3 "$SKILL_DIR/scripts/download_papers.py" \
  --input "/path/to/literature.xlsx" \
  --output "/path/to/paper-collection" \
  --schema-config "/path/to/schema.json" \
  --resume
```

Useful controls:

```text
--sheets "推荐精读" "CCF-A论文"
--host-delay 0.2
--timeout 20
--retries 2
--retry-delay 1
--max-bytes 104857600
--header "Authorization: Bearer ..."
--cookie "session=..."
--cookie-file "/path/to/cookies.txt"
--user-agent "Mozilla/5.0 ..."
--fail-on-warning
--force
```

Rules:

- Preserve the source workbook.
- Reuse valid existing PDFs unless `--force` is explicitly required.
- Under `--force`, preserve a valid existing PDF when redownload fails.
- Never use `--allow-private-hosts` outside controlled local tests.
- Do not claim success from HTTP status alone.
- Continue remaining sources and records after individual failures, authorization responses, or interactive challenge pages.
- Use only session data or credentials supplied or made available by the user/environment; never print secret header or Cookie values into manifests or logs.

### 4. Validate independently

```bash
python3 "$SKILL_DIR/scripts/validate_collection.py" \
  --collection "/path/to/paper-collection"
```

Use `--strict` before final delivery when orphan PDFs should fail validation.

Validation must confirm:

- every successful manifest record points to a local PDF;
- paths remain inside the collection root;
- PDF header and EOF marker exist;
- byte size and SHA-256 match the manifest.

### 5. Review and package

Review:

- `结构识别报告.json`;
- `下载清单.csv` and `下载清单.json`;
- `运行日志.jsonl`;
- `下载报告.json`.

Report exact record-level and unique-paper successes/failures, schema decisions, validation result, and recurring failure categories. Package only after validation passes.

## Adaptive workbook behavior

The parser supports:

- mixed useful and irrelevant worksheets;
- hidden-sheet exclusion by default;
- headers within the first 40 rows;
- merged and up-to-three-row hierarchical headers;
- separate English/Chinese title columns or bilingual title cells;
- optional venue and year fields;
- multiple source columns in one record;
- ordinary URLs, Excel hyperlinks, `HYPERLINK()` formulas, bare DOI, arXiv ID, and OpenReview ID;
- deterministic title derivation when a source exists but title is empty;
- DOI-first, then arXiv, then normalized-title deduplication;
- candidate-column output when only data profiling suggests a mapping.

Automatically skip empty, hidden, explanation, statistics, and other non-paper sheets unless explicitly selected or `--strict-schema` is used.

## Source resolution policy

Read [references/source-resolution.md](references/source-resolution.md) for ranking and recovery details.

Core rules:

- Prefer direct PDF links and known public repositories.
- Merge sources from duplicate records before downloading.
- Treat DOI and publisher URLs as landing pages and follow valid PDF links using the active Cookie jar, Referer, Authorization, and custom headers when supplied.
- Ignore ordinary GitHub, dataset, video, code, and supplementary links as paper sources unless they directly resolve to a PDF.
- Parse one landing-page depth by default; use deterministic repository transformations and all workbook-provided sources before declaring failure.
- Respect host delay, bounded retries, response-size limits, and `Retry-After`.
- Reject HTML/error pages, private addresses, unsafe redirects, truncated PDFs, and oversized responses.

## Stop conditions

Stop and report a blocker when:

- the workbook is encrypted, corrupt, or unsupported;
- no worksheet passes schema confidence and no mapping can be verified;
- an explicitly selected sheet remains ambiguous;
- required runtime dependencies are unavailable;
- the environment has no network access for a requested download;
- final validation fails and cannot be repaired safely.

Do not stop the whole batch for `401`, `403`, a login page, entitlement page, or CAPTCHA/challenge response. Record the condition, continue all alternative URLs and duplicate-row sources, and report which records need a refreshed session or manual browser completion.

Do not stop merely because some papers fail. Preserve all per-source attempts and complete the valid subset.

## Regression gate

After any change, run:

```bash
python3 "$SKILL_DIR/scripts/validate_skill.py" "$SKILL_DIR"
python3 "$SKILL_DIR/scripts/smoke_test.py" --verbose
```

The format validator enforces the portable top-level frontmatter allowlist: `name`, `description`, `metadata`, `license`, and `allowed-tools`. Put custom fields such as `version`, `compatibility`, `author`, and `domain` inside `metadata`. Do not deliver a modified Skill when either command fails.
