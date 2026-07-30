# 浏览器自动化下载手册

当 `download_papers.py` 的 urllib 方式无法获取论文（因机构代理、反爬、JS 渲染等原因）时，使用浏览器自动化作为补充手段。本手册记录已验证的方案和决策流程。

## 何时用浏览器自动化

满足以下条件之一时考虑浏览器自动化：

1. 论文在付费墙后，需要机构代理授权
2. 出版商用 JS 渲染 PDF 链接（ScienceDirect SPA）
3. 站点对非浏览器 User-Agent 返回挑战页
4. 需要"点击按钮"才能触发下载（OJS galley、MDPI referer 绑定）

不适用场景：纯 OA 来源（arXiv、CVF、NeurIPS）——urllib 直连更快更稳。

## 前置依赖

### WebBridge daemon

安装：`irm https://cdn.kimi.com/webbridge/install.ps1 | iex`

启动后监听 `127.0.0.1:10086`，浏览器扩展（Edge 或 Chrome）自动连接。

健康检查：
```bash
curl -s http://127.0.0.1:10086/health  # 或
kimi-webbridge status
```

确认 `extension_connected: true` 后才能操作浏览器。

### poppler-utils

PDF 校验依赖 `pdfinfo` 和 `pdftotext`：
- Windows: 下载 poppler-windows 并加入 PATH
- Linux: `apt install poppler-utils`

## 核心技术：ReadableStream 分块传输

### 问题

在浏览器标签页上下文中 `fetch(pdf_url)` 拿到 PDF 响应后，如果整块调用 `response.arrayBuffer()`，当 PDF > 2MB 时 CDP（Chrome DevTools Protocol）的 `Runtime.evaluate` 会超时。

### 方案

用 `response.body.getReader()` 分块读取，每块约 96KB（98304 字节），转 base64 回传 Node 端写盘：

```
浏览器侧                          Node 侧
─────────                        ────────
fetch(pdf_url)                   
reader = body.getReader()        
window.__reader = reader         1. 发起 evaluate(init)
                                 2. 收到 {ok, contentType}
                                 
reader.read() → pending buffer   
pending > 96KB → 切出 96KB       
btoa(96KB) → base64              3. 循环 evaluate(read)
                                 4. 解码 base64 写 .part 文件
                                 5. done=true 时结束
                                 
rename .part → 最终.pdf          6. 校验 %PDF 签名
```

### 为什么是 96KB

- 太大（>128KB）：base64 编码后单次 evaluate 响应可能超 CDP 传输限制
- 太小（<32KB）：轮询次数过多，网络往返开销大
- 96KB（98304）：实测在 2–25MB PDF 范围内稳定

### 为什么用 base64

CDP 的 `Runtime.evaluate` 返回值必须是 JSON 可序列化的。二进制数据不能直接传，base64 是最简单的编码。每 96KB → 128KB base64 字符串，单次传输安全。

## 下载决策树

```
论文来源是什么？
│
├─ OA（arXiv/CVF/NeurIPS/PMLR/ESSD）
│  └─ urllib 直连下载（最简单）
│
├─ IEEE（机构代理）
│  └─ institutional_proxy_batch.mjs
│     navigate 文章页 → fetch getPDF.jsp → stream
│
├─ ACM（机构代理）
│  └─ stream_from_tab.mjs
│     navigate 文章页 → fetch /doi/pdf/ → stream
│
├─ AAAI（OA 但需扫 galley 链接）
│  └─ navigate view 页 → evaluate 提取 galley URL → stream
│
├─ ScienceDirect（Arkose 挑战）
│  ├─ 尝试 navigate pdfft → 等 embed → stream（成功率低）
│  └─ fallback: 用户手动下载 → validate_pdf_deep.py 校验 → 归档
│
├─ MDPI（Cloudflare）
│  ├─ 尝试文章页内 fetch（可能被拦）
│  └─ fallback: 用户手动下载
│
└─ 未知来源
   └─ 先查 OpenAlex/Unpaywall 有无 OA 副本
      有 → OA 直连
      无 → 走机构代理或用户手动
```

## 安全挑战处理

遇到以下任一情况，**立即停止自动化**，记录状态并交给用户：

| 挑战类型 | 检测关键字 | 表现 |
|----------|-----------|------|
| CAPTCHA | `captcha`, `recaptcha`, `hcaptcha` | 验证码图片或复选框 |
| Cloudflare | `cf-chl-`, `challenge-platform` | "Checking your browser" |
| Arkose | `arkose`, `funcaptcha`, `crasolve` | ScienceDirect 安全验证 |
| SSO 登录 | `统一身份认证`, `authserver`, `single sign-on` | 跳转到学校登录页 |
| OTP/2FA | `two-factor`, `verification code` | 要求输入手机验证码 |
| 机器人验证 | `verify you are human`, `机器人验证` | "请验证你不是机器人" |

检测方法见 `scripts/lib/challenge_detect.mjs`。

**绝不**：
- 尝试求解验证码
- 自动填写 OTP
- 导出 Cookie 绕过登录
- 切换 IP 或代理轮换

## 低频串行原则

- 同一出版商：篇间延迟 8–15 秒（随机化）
- 同一批次：最多 5–8 篇
- 遇 429：等 `Retry-After` 或 60 秒后降频
- 遇 503/502：等 30 秒重试一次，失败即停
- 遇安全挑战：立即停整个批次

## 归档和校验

每篇 PDF 下载后必须通过 `validate_pdf_deep.py` 五重校验：

1. `%PDF` 文件头
2. `%%EOF` 文件尾
3. 文件大小 ≥ 50KB
4. `pdfinfo` 页数 ≥ 2
5. 前 3 页文本的题名 token 覆盖率 ≥ 72%（或 DOI 匹配）

校验失败 → 移入 `_quarantine/validation_failed/`，不计入成功。

## Unicode 路径兼容（Windows）

Windows 上 Poppler 的 `pdfinfo`/`pdftotext` 对部分 Unicode 路径（上标 `²`、en-dash `–`、中文）报 "No such file"。

解决：读原文件 bytes → 复制到 ASCII 临时目录 → 对临时路径执行校验 → 哈希基于原文件。

已内置在 `validate_pdf_deep.py` 中。
