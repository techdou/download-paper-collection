---
name: download-paper-collection
description: Batch download, organize, and validate academic papers from an Excel literature list. Handles open-access (arXiv, CVF, NeurIPS, AAAI, MDPI), institutional proxy (EZproxy/CARSI via Wuhan University, NENU, etc.), and browser-automated download (WebBridge/CDP) for paywalled publishers (IEEE, ScienceDirect/Elsevier, ACM, Wiley). Use whenever the user mentions downloading papers, batch PDF collection, 论文下载, organizing a literature list, or accessing papers through a university proxy or VPN — even if they don't say "skill" or name this tool.
metadata:
  version: "4.0.0"
  domain: "research-literature"
  workflow: "inspect → classify-sources → download-OA → download-proxy → validate → archive → audit"
  compatibility: "Requires Python 3.10+, openpyxl, PyYAML, poppler-utils. Optional: Node.js 18+ and kimi-webbridge for browser-automated downloads. Optional Cookie, Authorization, and custom HTTP headers for session-dependent sources."
---

# Download Paper Collection

Turn a heterogeneous Excel literature list into a verified collection:

`<worksheet>/<journal-or-conference>/<paper title>.pdf`

## Quick-start: which download path to use

When you receive a paper download request, classify each paper into one of these paths **before downloading**:

| Path | When | Tool | Key script |
|------|------|------|------------|
| **A. Direct OA** | Paper is on arXiv, CVF, NeurIPS, AAAI, PMLR, ESSD, or has a known OA PDF link | `download_papers.py` (urllib) | Core downloader handles this |
| **B. Institutional proxy** | Paper is behind IEEE/ACM/Elsevier paywall, user has university VPN/proxy access | `institutional_proxy_batch.mjs` + WebBridge | `scripts/institutional_proxy_batch.mjs` |
| **C. Browser fallback** | Proxy fetch blocked by Arkose/Cloudflare, or PDF link is JS-rendered | User manually downloads, then validate + archive | `validate_pdf_deep.py` |
| **D. Metadata only** | No legal full-text access exists | Record as `manual_needed`, skip download | — |

**Decision rule**: Try A first. If the paper is not OA, check if the user has institutional proxy access (ask for proxy URL if not provided). Use B for proxy-accessible papers. If B fails due to anti-bot challenges, fall back to C. Never attempt D unless all legal sources are exhausted.

Read [references/browser-download-playbook.md](references/browser-download-playbook.md) for the full decision tree and per-publisher strategies.

## Security boundaries (read before any download)

These are non-negotiable. Violating them is worse than not downloading the paper.

- Use only the user's legitimate institutional access channels.
- Never bypass CAPTCHA, Cloudflare, Arkose Labs, OTP, 2FA, or any security challenge. When detected, stop automation and hand the specific paper to the user.
- Never read, export, or display passwords, cookies, session tokens, or Authorization headers.
- Access sites serially with conservative delays (8–15 seconds between papers to the same host).
- Do not use UA spoofing, fingerprint forgery, proxy rotation, or cookie export.
- Do not save HTML, login pages, error pages, or supplementary materials as if they were the main paper PDF.

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

## Institutional proxy and browser automation modules

For Path B and C above. The core `download_papers.py` cannot reach these sources.

### Prerequisites

- `kimi-webbridge` daemon on `127.0.0.1:10086` with browser extension connected (for Path B).
- `poppler-utils` (`pdfinfo`, `pdftotext`) for deep validation.
- Node.js 18+ for `.mjs` scripts.

### Modules

| Module | Purpose |
|--------|---------|
| `scripts/institutional_proxy_batch.mjs` | Batch orchestrator: queue → resume → navigate → challenge detect → stream → validate → archive → manifest. Start here for Path B. |
| `scripts/lib/stream_from_tab.mjs` | Stream-download PDF from authorized browser tab. Solves CDP timeout on large binaries via 96KB chunking. |
| `scripts/lib/challenge_detect.mjs` | Detect CAPTCHA/Cloudflare/Arkose/SSO/OTP. Stops automation on detection. |
| `scripts/validate_pdf_deep.py` | Five-check validation: %PDF header, EOF, size, pages, title token coverage + DOI. Unicode-path compatible. |

### Reference docs (read on demand)

- [references/institutional-proxy.md](references/institutional-proxy.md) — EZproxy/CARSI formats, per-publisher proxy path segments, PII lookup, session expiry pitfalls.
- [references/publisher-pdf-endpoints.md](references/publisher-pdf-endpoints.md) — Per-publisher PDF URL patterns and automation feasibility (IEEE, ScienceDirect, ACM, AAAI, MDPI, Wiley, IGARSS).
- [references/browser-download-playbook.md](references/browser-download-playbook.md) — Full download decision tree, 96KB chunking technique, security boundaries.
