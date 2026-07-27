# Source resolution and download policy

## Source ranking

Sources from duplicate rows and multiple columns are merged before network work. Column semantics such as `pdf_url`, `doi`, `arxiv`, and `openreview` contribute priority in addition to URL shape. Default priority:

1. Direct `.pdf` or explicitly PDF-formatted URL.
2. Known public paper repositories and deterministic repository transforms.
3. DOI resolver or publisher/repository landing page.
4. Generic source page.
5. Non-paper project, dataset, video, code, or supplementary link; ignored unless it is a direct PDF.

## Supported deterministic transforms

The resolver contains conservative transformations for:

- arXiv abstract → PDF;
- OpenReview forum → PDF;
- CVF HTML → paper PDF;
- NeurIPS abstract → paper PDF;
- AAAI article view → download;
- PMLR HTML → PDF;
- ACL Anthology entry → PDF;
- HAL entry → document endpoint.

A failed transform does not end the record. Remaining source candidates are attempted.

## Landing-page discovery

The resolver may inspect one landing-page depth and collect:

- `citation_pdf_url` and related citation metadata;
- PDF `<a>` and `<link>` targets;
- PDF iframe/embed/object sources;
- common PDF data attributes.

It does not recursively crawl a site. Cookies established by the landing page and the landing-page `Referer` are preserved for discovered PDF requests. User-supplied Cookie files, Cookie headers, Authorization values, custom headers, and User-Agent strings are also applied across candidate requests.

## Retry behavior

- Requests are sequential and conservative.
- `--host-delay` spaces requests to the same host.
- `--retries` applies to transient network errors, `429`, and `5xx` responses.
- `Retry-After` is honored with a bounded wait.
- `401` is classified as `authorization_required`; `403` as `forbidden_or_challenge`. Neither stops the batch, and both remain recoverable through refreshed user-supplied session data or another source.
- HTML login, entitlement, and CAPTCHA/challenge pages are classified separately as `session_required`, `entitlement_required`, or `interactive_challenge`.
- `404`, timeout, rate limit, non-PDF, blocked URL, and other categories are retained separately.

## Integrity behavior

A successful response must:

- fit within `--max-bytes`;
- begin with a PDF header;
- contain an EOF marker near the end;
- survive atomic placement and final validation.

HTML, JSON, login pages, challenge pages, truncated files, and mislabeled content are never saved as PDFs even when HTTP status is 200. Their access state is recorded while the resolver continues other source candidates.

## Network safety

By default the resolver rejects:

- non-HTTP(S) schemes;
- localhost and `.local` names;
- private, loopback, link-local, multicast, reserved, and unspecified IP addresses;
- redirects or final URLs entering those ranges.

`--allow-private-hosts` exists only for controlled local regression tests.

## Resume and overwrite semantics

- Existing valid planned targets are reused by default.
- `--resume` also consults a prior manifest after folder/schema changes.
- Each paper group is finalized immediately, reducing loss after interruption.
- `运行日志.jsonl` records completed groups and source attempts.
- Invalid existing targets are quarantined before replacement.
- With `--force`, a valid existing file remains the fallback when redownload fails.


## Session and request context

The downloader accepts access context supplied by the user or execution environment:

- `--header "Name: Value"` for repeatable custom HTTP headers;
- `--authorization "Bearer ..."` or another complete Authorization value;
- `--cookie "name=value; ..."` for a Cookie header;
- `--cookie-file /path/to/cookies.txt` for Netscape/Mozilla browser-exported cookies;
- `--user-agent` for sites whose session is bound to a browser User-Agent.

Secret values are applied to requests but only header names and a boolean session indicator are written to the run journal. Values must not be copied into manifests, reports, or user-visible logs.
