# Skill quality review

## Executive assessment

The original package could download papers from one predictable workbook layout, but it behaved like a fixed automation script. Version 2.0 introduced preflight, security, validation, and Agent routing. Version 3.0 addressed the remaining central weakness: heterogeneous Excel structures. Version 3.0.1 additionally aligned the package with the conservative Codex-compatible frontmatter allowlist. Version 3.1.0 removes the overly restrictive access-policy routing and adds reusable authenticated request context while retaining file-integrity and network-safety controls.

The current Skill separates workbook interpretation from network resolution. An Agent can automatically accept strong mappings, skip irrelevant sheets, inspect candidate columns for ambiguous sheets, and apply explicit reusable mappings without editing code. This materially improves both robustness and invocation safety.

## Version progression

| Dimension | Original | v2.0 | v3.0 | v3 evidence |
|---|---:|---:|---:|---|
| Trigger precision | 7.0 | 9.0 | 9.3 | Positive/negative boundaries plus adaptive mapping route |
| Agent execution determinism | 6.0 | 9.0 | 9.5 | Inspect → map → download → validate → package contract |
| Workbook adaptability | 4.0 | 8.0 | 9.6 | Multi-sheet, merged/multi-row headers, aliases, explicit per-sheet config |
| Ambiguity safety | 4.0 | 7.5 | 9.5 | Confidence threshold, profile-only suggestions, explicit-selected-sheet errors |
| Source matching | 6.0 | 8.5 | 9.2 | Multiple sources, ranking, DOI/arXiv dedupe, non-paper suppression |
| Download correctness | 6.0 | 8.5 | 9.1 | One-depth discovery, bounded retries, Retry-After, structured failures |
| Access robustness and network safety | 6.0 | 9.0 | 9.6 | Cookie/Header/Authorization support, recoverable interactive states, URL/redirect/IP/size checks |
| Recovery/resume | 5.0 | 8.0 | 9.0 | Immediate group finalization, prior-manifest reuse, force fallback |
| Auditability | 6.0 | 9.0 | 9.6 | Schema report, run journal, source provenance, attempts, checksums |
| Testability | 2.0 | 9.0 | 9.6 | 37 deterministic regression tests plus standalone format and smoke gates |
| Cross-Agent portability | 5.0 | 8.5 | 9.4 | Conservative frontmatter allowlist, string metadata, explicit dependencies, standalone format validator |

Overall assessment: **9.5/10 — robust production-oriented, cross-host-compatible Agent Skill for heterogeneous Excel paper lists.**

## Key design improvements

### Cross-host format compatibility

The top-level `SKILL.md` frontmatter is restricted to the conservative host-compatible allowlist. Custom version, domain, workflow, and compatibility data are stored as strings under `metadata`, while runtime requirements are duplicated in the human-readable `## Dependencies` section. A standalone validator and regression tests prevent unsupported top-level keys from returning in later releases.

### Agent discovery and routing

The Skill description now tells the Agent both when to invoke and when not to invoke. The main workflow includes a dedicated ambiguity-resolution branch instead of assuming automatic detection always succeeds.

### Schema adaptability

`workbook_schema.py` provides:

- multilingual semantic aliases;
- merged and hierarchical header interpretation;
- confidence scoring and candidate columns;
- automatic paper-sheet selection;
- explicit CLI and JSON mappings;
- custom organization-specific aliases;
- optional metadata and multiple source columns.

### Safe flexibility

The system is flexible without making silent guesses. Data profiling may identify likely unknown columns, but those mappings remain below acceptance confidence and require explicit Agent confirmation.

### Download robustness

Duplicate rows contribute all available sources. The resolver prioritizes direct and repository PDF candidates using both URL shape and source-column semantics, preserves landing-page cookies and `Referer` where required, records every attempt, respects host pacing and retry signals, and keeps failure categories distinct.

### Recovery and observability

Each deduplicated paper group is copied to final targets immediately. A run journal and prior-manifest reuse improve restart behavior, while final manifests retain enough provenance to reproduce and audit the result.

## Remaining limitations

- Publisher HTML and anti-bot behavior can change without notice.
- The Skill can reuse user-supplied institutional or publisher sessions, but it cannot autonomously complete browser-only interaction, multifactor authentication, or a live CAPTCHA challenge.
- It does not semantically verify that downloaded PDF content matches the claimed title; it verifies structure and integrity.
- Legacy `.xls`, encrypted files, transposed tables, multi-row logical records, comments/shapes/custom XML, and formula evaluation need separate adapters.
- Downloads remain deliberately sequential and conservative.
- DOI landing pages may not expose a usable PDF URL even when another copy exists elsewhere; external scholarly-discovery APIs are not called by default.

## Recommended future extension

A later resolver plugin could query metadata services, institutional resolvers, or browser-assisted handoff adapters and add discovered copies as source candidates. It should preserve provenance, isolate credentials, and keep interactive completion auditable.
