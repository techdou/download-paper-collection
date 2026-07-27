# Agent routing and recovery guide

## Positive triggers

Invoke for requests such as:

- “把这个 Excel 里的论文自动识别后批量下载。”
- “这个表有多个 Sheet 和不同列名，匹配后下载公开 PDF。”
- “继续上次未完成的论文合集下载。”
- “按工作表和期刊分类，生成下载清单并校验。”
- “相同 DOI 的论文只下载一次。”

## Negative triggers

Do not invoke for:

- summarizing or interpreting one paper;
- finding papers without an input workbook;
- checking bibliographic truth only;
- editing abstracts or taxonomy only;

A larger research workflow may use this skill after search and URL verification have produced an Excel list.

## Routing sequence

1. Run adaptive preflight.
2. Accept only sheets with `status=accepted`.
3. For relevant low-confidence sheets, inspect `candidate_columns`.
4. Resolve with CLI mapping or a reusable schema config.
5. Rerun preflight; do not download until errors are zero.
6. Download with `--resume`.
7. Run independent validation.
8. Review manifests and package.

## Mapping decision table

| Situation | Agent action |
|---|---|
| Standard Chinese/English headers | Use automatic mapping |
| Mixed paper and instruction sheets | Allow automatic sheet routing |
| Low-confidence but obvious candidate columns | Retry with `--title-column` and `--source-columns` |
| Different layouts per sheet | Create per-sheet JSON mappings |
| Repeated organization-specific headers | Extend `aliases` in JSON |
| Profile-only candidates | Confirm explicitly; never lower threshold merely to pass |
| One logical record spans several rows | Patch adapter and add tests |

## Recovery matrix

| Symptom | Agent action |
|---|---|
| No accepted sheets | Inspect candidates; provide explicit mapping |
| Relevant sheet skipped | Select it explicitly and map columns |
| Wrong header row | Use `--header-row` or per-sheet `header_row` |
| Multiple source columns | Keep all; resolver ranks and merges them |
| Missing venue | Continue under `未分类` |
| Missing title but DOI/URL exists | Allow deterministic fallback; report derived titles |
| Missing source | Continue other records; preserve `missing_source` failure |
| 401/403/login page | Continue other sources; retry with user-supplied `--authorization`, `--header`, `--cookie`, or `--cookie-file`; otherwise report a recoverable session requirement |
| 404 | Try remaining duplicate/source candidates |
| 429/5xx | Use bounded retries and host delay |
| HTML landing page | Allow one-depth PDF metadata/link discovery while preserving Cookie, Referer, Authorization, and custom headers |
| CAPTCHA/challenge page | Record `interactive_challenge`, continue the batch, and request browser/manual completion or refreshed cookies only for unresolved records |
| Existing valid PDF | Reuse; use `--force` only when requested |
| Forced redownload fails | Preserve valid fallback |
| Invalid existing PDF | Quarantine and replace |
| Hash/size mismatch | Repair/redownload, regenerate manifests, revalidate |
| No network | Complete preflight and report the blocker |

## Completion standard

A complete Agent response states:

- which worksheets were accepted or skipped;
- whether explicit mapping was needed;
- record and unique-paper counts;
- exact success/failure totals;
- recurring failure categories;
- validation result;
- archive or output location.

Do not compress before manifests and validation are complete.
