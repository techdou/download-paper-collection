# Adaptive workbook schema reference

## Supported files

The parser accepts `.xlsx` and `.xlsm` files readable by `openpyxl`. It does not directly support legacy `.xls`, encrypted workbooks, cloud-only spreadsheet URLs, or CSV.

## Internal paper record

Every accepted row is normalized to this internal shape before download:

```json
{
  "record_id": "论文总表!12",
  "sheet": "论文总表",
  "row": 12,
  "title": "English title or deterministic fallback",
  "title_en": "optional",
  "title_zh": "optional",
  "venue": "optional; defaults to 未分类",
  "year": "optional",
  "source_urls": ["ranked URL list"],
  "source_details": ["original columns and raw values"],
  "dedupe_key": "doi:... | arxiv:... | title:...",
  "schema_confidence": 0.0
}
```

Workbook layout is therefore an adapter concern. Download logic never assumes a fixed column letter.

## Automatic detection

The detector scans the first 40 rows and evaluates header spans of one to three rows. Merged cells are expanded logically, so hierarchical headers such as the following are supported:

```text
| 论文标题 |       公开来源       | 期刊/会议 |
|          | PDF链接 | DOI字段     |           |
```

It recognizes common Chinese and English aliases for:

- generic, English, and Chinese titles;
- venue;
- direct PDF source;
- DOI;
- arXiv;
- OpenReview;
- generic paper/source URL;
- year.

Venue and year are optional. At least one title field and one source field are needed for automatic acceptance.

## Confidence model

Each candidate schema combines:

- semantic header-match strength;
- title-column data profile;
- source-column URL/DOI profile;
- ambiguity penalties;
- header-span penalties.

Default acceptance threshold: `0.72`.

Possible sheet states:

| State | Meaning | Agent action |
|---|---|---|
| `accepted` | Mapping is sufficiently reliable | Continue |
| `low_confidence` | Likely columns exist but headers are ambiguous | Use explicit mapping |
| `unrecognized` | No defensible title/source mapping | Inspect or skip |
| `empty` | No usable data | Skip |
| `hidden` | Hidden and excluded by default | Skip unless explicitly required |

Profile-only inference is intentionally capped below automatic acceptance. It produces candidate columns for the Agent, but never authorizes downloading by itself.

## Sheet routing

Without `--sheets`, the parser evaluates every visible worksheet and processes only accepted paper-bearing sheets. Explanation, statistics, charts, metadata, and unrelated sheets are skipped without blocking useful sheets.

When `--sheets` explicitly selects a sheet, low confidence or unrecognized structure is an error. This prevents the Agent from silently ignoring a sheet the user specifically requested.

Use `--strict-schema` to make every nonempty unrecognized selected/default sheet fail preflight.

## Supported title layouts

Single bilingual cell:

```text
[EN] English paper title
[中文] 中文标题
```

Inline bilingual cell:

```text
[EN] English paper title [中文] 中文标题
```

Separate columns:

```text
英文题名 | 中文题名
```

Plain title:

```text
English paper title
```

The preferred filename title is English, then generic title, then Chinese title. If the title is missing but a DOI/arXiv/URL exists, the parser creates a deterministic fallback such as `DOI_10.1234_example` and records `title_derived=true`.

## Supported source layouts

A record may contain any number of source columns. The parser merges and ranks:

- PDF direct links;
- publisher or repository landing pages;
- Excel hyperlink targets;
- Excel `HYPERLINK()` formulas;
- one or more URLs in a cell;
- bare DOI strings;
- arXiv IDs in an arXiv-labelled column;
- OpenReview IDs in an OpenReview-labelled column.

Ordinary project, code, dataset, video, and supplementary links are not considered paper sources unless they are direct PDFs.

## Explicit CLI mapping

Use column names, Excel letters, or one-based indices:

```bash
python3 scripts/download_papers.py \
  --input papers.xlsx \
  --sheets "论文总表" \
  --title-column A \
  --venue-column "发表刊物" \
  --source-columns C D F \
  --inspect-only
```

Direct CLI mappings apply to each selected sheet. Select the intended sheets when different sheets use different layouts.

## Reusable JSON configuration

Use `--schema-config`. See [schema-config.example.json](schema-config.example.json).

Top-level fields:

```json
{
  "aliases": {},
  "global": {},
  "sheets": {}
}
```

`aliases` extends built-in aliases rather than replacing them:

```json
{
  "aliases": {
    "title": ["作品名"],
    "pdf_url": ["公开获取"]
  }
}
```

`global` provides defaults:

```json
{
  "global": {
    "header_row": 2,
    "header_span": 2
  }
}
```

`sheets` provides per-sheet overrides:

```json
{
  "sheets": {
    "论文总表": {
      "header_row": 2,
      "columns": {
        "title_en": "英文题名",
        "title_zh": "中文题名",
        "venue": "期刊或会议",
        "year": "年份",
        "sources": ["PDF入口", "DOI字段"],
        "source_kinds": {
          "PDF入口": "pdf_url",
          "DOI字段": "doi"
        }
      }
    }
  }
}
```

Supported `source_kinds`:

```text
pdf_url, doi, arxiv, openreview, source
```

## Precedence

The effective mapping order is:

```text
per-sheet JSON mapping
> CLI column mapping
> global JSON mapping
> custom aliases
> built-in automatic detection
```

## When code changes are justified

Patch the parser only when the workbook uses a repeatable structure that cannot be represented by configuration, such as:

- one logical paper record spans several physical rows;
- title/source values are embedded in comments, shapes, custom XML, or formulas requiring evaluation;
- a table is transposed;
- a workbook contains nested subtables in one sheet;
- source URLs must be generated from nonstandard identifiers.

Any parser patch must include a regression test. Never hardcode a user's filename or worksheet name into general logic.
