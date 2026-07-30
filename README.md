# download-paper-collection

> A ZCode skill for batch downloading, organizing, and validating academic papers from heterogeneous Excel literature lists — across open-access sources, institutional proxies, and browser-automated fallback.

## What it does

Given an Excel file (`.xlsx` / `.xlsm`) containing a paper list with titles, DOIs, source URLs, and metadata columns, this skill:

1. **Inspects** the workbook structure — auto-detecting header rows, title/source columns, and paper-bearing worksheets with confidence scoring.
2. **Downloads** each paper via the best available path:
   - **Direct OA**: arXiv, CVF, NeurIPS, AAAI, PMLR, ESSD, Copernicus
   - **Institutional proxy**: IEEE Xplore, ScienceDirect, ACM DL via EZproxy/CARSI (e.g., Wuhan University, NENU)
   - **Browser automation**: WebBridge + CDP stream download for JS-rendered or challenge-protected pages
   - **Manual fallback**: user downloads in browser, skill validates and archives
3. **Validates** every PDF: `%PDF` header, `%%EOF`, file size, page count, title token coverage, DOI match.
4. **Organizes** into `<worksheet>/<journal-or-conference>/<paper title>.pdf`.
5. **Audits**: produces manifests, run logs, SHA-256 hashes, and incomplete-item lists.

## Quick start

### Install

```bash
# Python dependencies
pip install -r requirements.txt

# Optional: for browser-automated downloads (Path B/C)
# 1. Install kimi-webbridge: irm https://cdn.kimi.com/webbridge/install.ps1 | iex
# 2. Install poppler-utils (pdfinfo, pdftotext)
# 3. Install Node.js 18+
```

### Basic usage

```bash
# Inspect workbook structure
python scripts/download_papers.py --input papers.xlsx --inspect-only

# Download all papers (OA sources)
python scripts/download_papers.py --input papers.xlsx --output ./collection --resume

# Institutional proxy batch (requires WebBridge)
node scripts/institutional_proxy_batch.mjs --queue ieee_queue.json --session paper-ieee

# Deep-validate a single PDF
python scripts/validate_pdf_deep.py --pdf paper.pdf --title "[EN] Some Title" --doi "10.xxx/yyy"
```

## Skill structure

```
download-paper-collection/
├── SKILL.md                              # Agent entry point + decision tree
├── README.md                             # This file
├── requirements.txt                      # Python dependencies
├── scripts/
│   ├── download_papers.py                # Core downloader (urllib, OA + cookie/auth)
│   ├── workbook_schema.py                # Excel schema auto-detection
│   ├── validate_collection.py            # Collection-level validation
│   ├── validate_pdf_deep.py              # Five-check single-PDF validation
│   ├── validate_skill.py                 # Skill format regression gate
│   ├── smoke_test.py                     # Smoke tests
│   ├── institutional_proxy_batch.mjs     # Proxy batch orchestrator (WebBridge)
│   └── lib/
│       ├── stream_from_tab.mjs           # ReadableStream chunked download (96KB)
│       └── challenge_detect.mjs          # CAPTCHA/Arkose/Cloudflare/SSO detection
├── references/
│   ├── source-resolution.md              # Source ranking and retry policy
│   ├── workbook-schema.md                # Schema detection internals
│   ├── agent-routing.md                  # Agent handoff routing
│   ├── institutional-proxy.md            # EZproxy/CARSI formats and pitfalls
│   ├── publisher-pdf-endpoints.md        # Per-publisher PDF URL patterns
│   ├── browser-download-playbook.md      # Browser automation decision tree
│   └── schema-config.example.json        # Example schema override
├── agents/
│   └── openai.yaml                        # OpenAI agent interface
└── tests/
    ├── test_download_papers.py
    └── test_skill_structure.py
```

## Download decision tree

```
Paper source?
│
├─ Open Access (arXiv/CVF/NeurIPS/AAAI/PMLR/ESSD)
│  └─ download_papers.py (urllib direct)
│
├─ Paywalled + user has institutional proxy
│  ├─ IEEE/ACM: institutional_proxy_batch.mjs (fetch in proxy tab)
│  ├─ ScienceDirect: navigate pdfft → stream (or user manual fallback)
│  └─ Challenge detected → STOP, hand to user
│
└─ No legal access
   └─ Record as manual_needed
```

See [references/browser-download-playbook.md](references/browser-download-playbook.md) for full details.

## Security boundaries

This skill is designed with strict security boundaries. The following are **non-negotiable**:

- ✅ Use only the user's legitimate institutional access
- ✅ Stop automation immediately on detecting any security challenge (CAPTCHA, Cloudflare, Arkose, SSO, OTP)
- ✅ Serial access with 8–15 second delays between papers
- ❌ Never bypass CAPTCHA, Cloudflare, Arkose, OTP, or 2FA
- ❌ Never read/export passwords, cookies, session tokens, or Authorization headers
- ❌ Never use UA spoofing, fingerprint forgery, proxy rotation, or cookie export

## Supported publishers

| Publisher | Access method | Automation level |
|-----------|--------------|-----------------|
| arXiv | Direct OA | Full |
| CVF (CVPR/ICCV/WACV) | Direct OA | Full |
| NeurIPS proceedings | Direct OA | Full |
| AAAI (OJS) | OA, galley scan | Full |
| PMLR (ICML) | Direct OA | Full |
| ESSD (Copernicus) | Direct OA | Full |
| MDPI | OA, Cloudflare | Partial |
| IEEE Xplore | Institutional proxy | Full (proxy) |
| ACM DL | Institutional proxy | Full (proxy) |
| ScienceDirect (Elsevier) | Institutional proxy | Partial (Arkose) |
| Wiley | Institutional proxy | Partial |

## Validation

```bash
# Skill format validation
python scripts/validate_skill.py .

# Smoke tests
python scripts/smoke_test.py --verbose

# Challenge detection self-test
node scripts/lib/challenge_detect.mjs --test
```

## License

MIT
