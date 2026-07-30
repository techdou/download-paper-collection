// challenge_detect.mjs — 安全挑战与登录重定向检测
//
// 在浏览器自动化下载过程中，出版商可能弹出验证码、机器人验证、Cloudflare 挑战、
// 统一身份认证(SSO)等安全机制。命中任何一个都必须立即停止自动化，交回人工处理。
//
// 本模块提供统一的检测正则和分类函数，供批处理脚本在 navigate/evaluate 后调用。
//
// 安全边界：检测到挑战后只记录和停止，绝不尝试求解验证码、绕过 Cloudflare、
// 自动填写 OTP 或导出 Cookie。

/** 挑战类型关键字映射。
 *  覆盖：CAPTCHA / hCaptcha / reCAPTCHA / Cloudflare / Arkose FunCaptcha /
 *  统一身份认证(CAS/SSO) / OTP/2FA / 中英文机器人验证 */
const CHALLENGE_PATTERNS = [
  // CAPTCHA 系列
  { type: 'captcha', keywords: ['captcha', 'recaptcha', 'hcaptcha', 'g-recaptcha', 'g-recaptcha-response'] },
  // Cloudflare
  { type: 'cloudflare', keywords: ['cf-chl-', 'challenge-platform', 'cf-please-wait', 'cf-error-details', 'attention required | cloudflare'] },
  // Arkose Labs / FunCaptcha（ScienceDirect 常用）
  { type: 'arkose', keywords: ['arkose', 'funcaptcha', 'arkoselabs', 'enforcement.arkoselabs', 'crasolve'] },
  // 统一身份认证 / SSO / CAS
  { type: 'sso_login', keywords: ['统一身份认证', 'single sign-on', 'cas login', 'servicevalidate', 'authserver', '/login?', 'sign in to your account', 'log in to your account'] },
  // OTP / 2FA
  { type: 'otp_2fa', keywords: ['two-factor', 'two factor', '2fa', '\\botp\\b', 'verification code', 'enter the code', 'verify your identity'] },
  // 机器人验证（中英文）
  { type: 'robot_check', keywords: ['verify you are human', 'robot check', 'are you a robot', '机器人验证', '人机验证', '安全验证', 'security verification', 'please verify you are not a robot'] },
];

/** 构建编译后的正则缓存 */
const _compiledCache = new Map();

function getCompiledRegex(keyword) {
  if (!_compiledCache.has(keyword)) {
    _compiledCache.set(keyword, new RegExp(keyword, 'i'));
  }
  return _compiledCache.get(keyword);
}

/**
 * 检测页面文本中是否包含安全挑战
 *
 * @param {string} text - 页面 URL + title + body innerText 拼接的文本
 * @returns {{detected: boolean, type?: string, matchedKeyword?: string}}
 */
export function detectChallenge(text) {
  if (!text) return { detected: false };
  const sample = text.slice(0, 8000); // 只看前 8KB，挑战页通常很短

  for (const { type, keywords } of CHALLENGE_PATTERNS) {
    for (const kw of keywords) {
      if (getCompiledRegex(kw).test(sample)) {
        return { detected: true, type, matchedKeyword: kw };
      }
    }
  }
  return { detected: false };
}

/**
 * 在 WebBridge 上下文中检测当前页面是否触发安全挑战
 *
 * @param {function} command - createCommand 返回的函数
 * @returns {Promise<{detected: boolean, type?: string, page?: object}>}
 */
export async function checkCurrentPage(command) {
  const code = `(() => JSON.stringify({
    url: location.href,
    title: document.title || '',
    body: (document.body?.innerText || '').slice(0, 6000)
  }))()`;

  const data = await command('evaluate', { code }, 30000);
  const info = JSON.parse(data.value || '{}');
  const marker = `${info.url || ''} ${info.title || ''} ${info.body || ''}`;
  const challenge = detectChallenge(marker);

  return {
    detected: challenge.detected,
    type: challenge.type,
    matchedKeyword: challenge.matchedKeyword,
    page: info,
  };
}

/**
 * 检查页面 URL 是否被意外重定向（不在预期的文章页范围内）
 *
 * @param {string} currentUrl - 当前页面 URL
 * @param {string} expectedFragment - 预期 URL 中应包含的片段（如 /document/12345）
 * @returns {boolean} - true 表示被重定向走了
 */
export function isUnexpectedNavigation(currentUrl, expectedFragment) {
  if (!expectedFragment) return false;
  return !String(currentUrl || '').includes(expectedFragment);
}

// ===== 单元自测（CLI）=====
if (process.argv[1] && process.argv[1].endsWith('challenge_detect.mjs') && process.argv.includes('--test')) {
  const tests = [
    ['', { detected: false }],
    ['正常论文页 Abstract Introduction', { detected: false }],
    ['Please complete the captcha below', { detected: true, type: 'captcha' }],
    ['cf-chl- bounded by Cloudflare', { detected: true, type: 'cloudflare' }],
    ['crasolve=1 Arkose challenge', { detected: true, type: 'arkose' }],
    ['统一身份认证平台', { detected: true, type: 'sso_login' }],
    ['Enter your two-factor authentication code', { detected: true, type: 'otp_2fa' }],
    ['verify you are human', { detected: true, type: 'robot_check' }],
    ['Security verification Request Verification: In Progress', { detected: true, type: 'robot_check' }],
  ];

  let pass = 0;
  for (const [input, expected] of tests) {
    const result = detectChallenge(input);
    const ok = result.detected === expected.detected &&
               (!expected.type || result.type === expected.type);
    if (ok) {
      pass++;
    } else {
      console.error(`FAIL: input=${JSON.stringify(input.slice(0, 40))} expected=${JSON.stringify(expected)} got=${JSON.stringify(result)}`);
    }
  }
  console.log(`challenge_detect self-test: ${pass}/${tests.length} passed`);
  if (pass < tests.length) process.exit(1);
}
