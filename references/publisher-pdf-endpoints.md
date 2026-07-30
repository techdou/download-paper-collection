# 出版商 PDF Endpoint 速查

各出版商/平台的 PDF 下载 URL 模式、访问方式和自动化可行性。按自动化难度从低到高排序。

## 直连 OA（最简单，urllib 即可）

| 来源 | PDF URL 模式 | 示例 | 备注 |
|------|-------------|------|------|
| arXiv | `https://arxiv.org/pdf/<arxiv_id>` | `arxiv.org/pdf/2311.09520` | 无限制 |
| CVF Open Access | `https://openaccess.thecvf.com/content/<YEAR>/papers/<Author>_<Title>_<Venue>_<YEAR>_paper.pdf` | 需从文章页提取 | 无限制 |
| NeurIPS proceedings | `https://proceedings.neurips.cc/paper_files/paper/<YEAR>/file/<hash>-Paper-Conference.pdf` | 注意区分 Paper 和 Supplemental | 无限制 |
| PMLR | `https://proceedings.mlr.press/v<vol>/<id>/<id>.pdf` | 从文章页提取 | 无限制 |
| ESSD (Copernicus) | `https://essd.copernicus.org/articles/<vol>/<id>/<year>/essd-<vol>-<id>-<year>.pdf` | 规律性强 | OA 期刊 |

## 代理内 fetch 直连（中等难度）

这些来源在已授权的代理页面上下文中 `fetch()` 能直接拿到 `application/pdf` 响应。

### IEEE Xplore（机构代理）

```
文章页: https://<代理>/document/<arnumber>
PDF:    https://<代理>/stampPDF/getPDF.jsp?tp=&arnumber=<arnumber>&ref=
```

**方法**：navigate 文章页 → 在该页上下文 `fetch(pdf_url)` → `response.body.getReader()` 分块读取。

**实测**：武大代理稳定可用，`content-type: application/pdf`，单篇 2–20MB。

### ACM Digital Library（机构代理）

```
文章页: https://<代理>/doi/<doi>
PDF:    https://<代理>/doi/pdf/<doi>
```

**方法**：同 IEEE，代理页内 fetch 直连。

**实测**：武大 ACM 代理可用，`content-type: application/pdf;charset=UTF-8`。

## 需要扫页面提取链接（较高难度）

### AAAI OJS（开放获取，但 PDF URL 动态）

```
文章页: https://ojs.aaai.org/index.php/AAAI/article/view/<view_id>
PDF:    https://ojs.aaai.org/index.php/AAAI/article/view/<view_id>/<file_id>
```

**关键**：`file_id` 无法从 `view_id` 推导，必须导航到文章页后从 DOM 提取：

```javascript
// 在文章页上下文
const pdfLink = Array.from(document.querySelectorAll('a'))
  .find(a => /pdf/i.test(a.innerText) && a.href.includes('/view/'))
  .href;
```

**注意**：OJS 的 PDF 链接有时因 `download/<id>` 404，用 `view/<id>/<file_id>` 格式更稳。

### MDPI（OA 但需 referer）

```
文章页: https://www.mdpi.com/<journal_id>/<volume>/<issue>/<page>
PDF:    https://www.mdpi.com/<journal_id>/<volume>/<issue>/<page>/pdf?version=<timestamp>
```

**关键**：直接 fetch PDF URL 返回 403，必须在文章页上下文中 fetch（带 referer）。

**陷阱**：MDPI 的 Cloudflare 对中国 IP 有时返回 403，浏览器导航能过但 `fetch()` 被拦。

## fetch 被拦，需浏览器导航或手动（最高难度）

### ScienceDirect / Elsevier（Arkose 挑战）

```
文章页: https://<代理>/science/article/pii/<PII>
PDF:    https://<代理>/science/article/pii/<PII>/pdfft?md5=<hash>&pid=<filename>
```

**关键差异**：
- `fetch(pdfft_url)` → 返回 `text/html`（Arkose 挑战页或 PDF viewer HTML）
- `navigate(pdfft_url)` → 有时成功（ScienceDirect 重定向到真实 PDF URL）
- 手动点 "View PDF" → 通常成功

**自动化可行方案**（成功率不稳定）：
1. navigate 到 `pdfft?isDTLRedir=true&download=true`
2. 轮询等待 `<embed>` 元素出现（表示 PDF viewer 加载完成）
3. 从 `location.href` 获取重写后的真实 PDF URL
4. stream 读取该 URL

**推荐**：自动化成功率低，优先让用户手动下载。

### Wiley Online Library

```
PDF: https://besjournals.onlinelibrary.wiley.com/doi/pdf/<doi>
```

需要 Wiley 机构授权。多数高校的通用代理可能不覆盖 Wiley。

## IGARSS 会议论文特殊处理

IGARSS 论文的 IEEE DOI 格式为 `10.1109/<proceedings>.<year>.<doc_number>`：

```
10.1109/igarss53475.2024.10641701 → document_number = 10641701
```

DOI 最后一段纯数字就是 IEEE Xplore 的 document number，可直接构造：

```
文章页: https://<代理>/document/10641701
PDF:    https://<代理>/stampPDF/getPDF.jsp?tp=&arnumber=10641701&ref=
```

## 补充材料 vs 主论文

部分来源（尤其 NeurIPS）的主论文和补充材料 URL 格式相似：

```
主论文:    .../file/<hash>-Paper-Conference.pdf
补充材料:  .../file/<hash>-Supplemental-Conference.pdf
```

**校验**：用 `validate_pdf_deep.py` 的题名 token 覆盖率检查——补充材料的正文通常以 "Supplementary Materials for..." 开头，与预期标题不匹配。
