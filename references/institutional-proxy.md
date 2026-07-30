# 机构代理接入指南

当论文不在开放获取（OA）范围内时，需要通过用户所在机构的代理服务器访问出版商全文。本指南记录已验证的代理格式、各出版商差异和常见陷阱。

## EZproxy / CARSI 代理格式

国内高校图书馆普遍使用 EZproxy 或 CARSI（联邦认证）体系。代理 URL 的通用格式：

```
https://<图书馆代理域名>/s/<路径编码>/<出版商域名>/G.https/<实际路径>
```

或更简单的路径前缀式：

```
http://<图书馆代理域名>/https/<加密路径>/<实际路径>
```

### 已验证的代理实例

| 学校 | 代理域名 | 格式 |
|------|----------|------|
| 武汉大学 | `ersp.lib.whu.edu.cn` | `https://ersp.lib.whu.edu.cn/s/<org>/<publisher>/G.https/<path>` |
| 东北师范大学 | `wrd.library.nenu.edu.cn` | `http://wrd.library.nenu.edu.cn/https/<加密token>/<path>` |

### 各出版商代理路径前缀

同一学校对不同出版商用不同的代理路径段：

| 出版商 | 武大代理路径段 | 示例 |
|--------|---------------|------|
| IEEE Xplore | `/s/org/ieee/ieeexplore/G.https` | `.../document/12345` |
| ScienceDirect | `/s/com/sciencedirect/www/G.https` | `.../science/article/pii/S0924271624004076` |
| ACM DL | `/s/org/acm/dl/G.https` | `.../doi/10.1145/3664647.3681563` |

> **关键**：代理路径段对每个出版商不同，不能混用。用 IEEE 段访问 ScienceDirect 会 404。

## ScienceDirect PII 反查

ScienceDirect 用 PII（Publisher Item Identifier）而非 DOI 构造文章 URL：

```
https://<代理>/science/article/pii/<PII>
```

PII 无法从 DOI 直接推出，需要通过 Crossref 查询：

```python
import hashlib, json, urllib.request

def get_pii(doi):
    url = f"https://api.crossref.org/works/{doi}"
    data = json.loads(urllib.request.urlopen(url).read())
    for link in data["message"].get("link", []):
        link_url = link.get("URL", "")
        if "PII" in link_url.upper():
            # URL 形如 ...api.elsevier.com/content/article/PII:S0924271624004076?...
            import re
            m = re.search(r"PII:([^/?]+)", link_url, re.I)
            if m:
                return m.group(1)
    return None
```

## 常见陷阱

### 1. Arkose 拦截 fetch 但不拦浏览器导航

ScienceDirect 的 `pdfft` endpoint 对 `fetch()` 请求触发 Arkose Labs 反机器人挑战（返回 `text/html` 挑战页），但浏览器原生导航（地址栏输入、链接点击）可能通过。

**表现**：
- `fetch(pdfft_url)` → `status: 200, content-type: text/html`（挑战页 HTML）
- `navigate(pdfft_url)` → 有时成功加载 PDF viewer（`<embed>` 元素出现）
- 手动点击 "View PDF" 按钮 → 正常打开 PDF

**处理**：自动化 fetch 失败时，退回让用户手动下载，不绕过挑战。

### 2. 代理 session 过期跳转 SSO

机构代理的授权有时效。过期后访问任何页面都会 302 到学校的统一身份认证平台。

**表现**：
- `location.href` 变为 `https://cas.whu.edu.cn/authserver/login?...`
- `document.title` = "统一身份认证平台"

**处理**：检测到 SSO 重定向后立即停止批次，提示用户在浏览器中重新登录。

### 3. 东师 VPN 加密路径每个出版商不同

东北师范大学的 WRD 代理用加密 token 标识出版商：

- Scopus: `...21e7e056d2343367406b1bc7af9758`
- ScienceDirect: `...21e7e056d234336155700b8ca891472636a6d29e640e`

这些 token 是代理服务器配置的，无法推导，只能从图书馆资源页面获取。

### 4. PDF CDN 可能不走代理

ScienceDirect 的 PDF 文件实际托管在 AWS（`1-s2.0-...amazonaws.com`），部分代理只代理 HTML 页面，不代理 PDF CDN 流量。表现：文章页能打开，但 View PDF 一直加载（转圈）。

**处理**：换代理入口，或让用户在浏览器中手动下载。

## 安全边界

- 只使用用户合法的机构授权通道
- 不导出、不读取 Cookie / session token / Authorization header
- 遇到任何安全挑战（验证码、SSO、OTP、Cloudflare）立即停止自动化
- 同一站点低频串行访问，不并发
- 不使用 UA 伪装、指纹伪装、代理轮换等反爬规避手段
