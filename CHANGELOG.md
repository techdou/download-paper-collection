# Changelog

## 3.1.0 - 2026-07-28

- Removed the hard activation/stop rule that excluded paywall-, login-, CAPTCHA-, publisher-, or institution-dependent records.
- Added repeatable custom request headers, Authorization, Cookie header, Netscape cookie-file, and User-Agent options.
- Preserved supplied request context across direct candidates and landing-page PDF discovery.
- Reclassified `401`, `403`, login, entitlement, and challenge pages as recoverable per-source outcomes instead of a global access-control blocker.
- Continued all alternative URLs, duplicate-row sources, and remaining papers after interactive or authorization responses.
- Kept PDF integrity, unsafe URL, redirect, private-host, and response-size protections.
- Added regression coverage for authenticated header/cookie downloads and interactive-page classification.

## 3.0.1 - 2026-07-27

### Cross-host Skill format compatibility

- Moved `compatibility` from the top-level YAML frontmatter into `metadata.compatibility`.
- Limited top-level frontmatter to `name`, `description`, `metadata`, optional `license`, and optional `allowed-tools`.
- Added an explicit `## Dependencies` section to `SKILL.md`.
- Added `scripts/validate_skill.py` to enforce the portable frontmatter allowlist, required fields, naming rules, string-valued metadata, and a non-empty body.
- Integrated format validation into the smoke-test gate.
- Added regression tests that reject custom top-level fields and verify the standalone validator.

## 3.0.0 - 2026-07-27

### Adaptive Agent invocation

- Reframed the Skill around adaptive inspect → map → download → validate → package routing.
- Added confidence-aware Agent decision rules and a prohibition on blindly lowering thresholds.
- Added explicit CLI mapping and reusable per-sheet JSON schema configuration.
- Added candidate-column reporting so an Agent can resolve ambiguous workbooks deterministically.

### Workbook adapter

- Added a dedicated `workbook_schema.py` adapter layer.
- Increased automatic header scanning to 40 rows.
- Added merged and one-to-three-row hierarchical header support.
- Added built-in Chinese/English aliases for generic, English, and Chinese titles, venue, year, PDF, DOI, arXiv, OpenReview, and generic source URLs.
- Added custom alias extension through JSON.
- Added automatic paper-sheet routing while skipping empty, hidden, instruction, and statistics sheets.
- Added optional venue/year handling instead of requiring venue.
- Added multiple source-column aggregation and original-column provenance.
- Added deterministic title derivation for source-only rows.
- Added DOI-first, arXiv-second, normalized-title-third deduplication.
- Added safe profile-only inference that suggests columns but never auto-accepts them.

### Source resolution

- Added source ranking with source-column semantic boosts, duplicate-record source merging, and ordinary repository/dataset/video-link suppression.
- Added HAL transformation in addition to arXiv, CVF, NeurIPS, AAAI, OpenReview, PMLR, and ACL.
- Expanded landing-page discovery to PDF-specific citation metadata, links, iframes, embeds, objects, and common data attributes.
- Preserved landing-page cookies and `Referer` headers when following discovered PDF links.
- Added one-depth crawl limit, per-host delay, bounded `Retry-After` handling, and structured failure categories.
- Added per-source attempt history to CSV/JSON manifests and the run journal.

### Recovery and audit

- Finalize every deduplicated paper group immediately to improve interruption recovery.
- Added `结构识别报告.json` and `运行日志.jsonl`.
- Added schema confidence, bilingual titles, year, dedupe identity/mode, source-column provenance, attempt history, and failure category to manifests.
- Added prior-manifest reuse under `--resume`.
- Preserved valid fallback PDFs when forced redownload fails.

### Quality assurance

- Expanded regression coverage from 15 to 30 tests.
- Added tests for merged/multi-row headers, mixed worksheets, explicit mappings, alias extensions, low-confidence stops, derived titles, DOI deduplication, and source ranking.

## 2.0.0 - 2026-07-27

- Added automatic single-row schema inspection, secure bounded downloads, independent validation, manifests with checksums, Agent routing guidance, and regression tests.
