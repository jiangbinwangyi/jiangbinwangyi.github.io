'use strict';

/**
 * Jekyll Markdown 可视化编辑器 —— 本地服务端
 *
 * 设计要点：
 * 1. 仅使用 Node.js 内置模块，零运行时依赖，仅监听 127.0.0.1。
 * 2. 文章 front matter 采用「行级保真合并」：保存时重新读取磁盘原始行，
 *    只替换 title / date / categories 三行，layout 及任何未知字段原样保留，
 *    同时保留原有的 EOL 风格（CRLF / LF）与 front matter 后的空行数量。
 * 3. 所有文件名 / 静态资源路径统一做纯文件名校验 + 绝对路径前缀校验，防目录穿越。
 * 4. GIT_DRY_RUN=1 时，git add / commit / push 只打印不执行，便于 QA 端到端验证。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

// ---------------------------------------------------------------------------
// 常量与路径
// ---------------------------------------------------------------------------

const EDITOR_DIR = __dirname;
const REPO_ROOT = path.resolve(EDITOR_DIR, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'docs', '_posts');
const PUBLIC_DIR = path.join(EDITOR_DIR, 'public');
const TRASH_DIR = path.join(EDITOR_DIR, '.trash');
const IMAGE_DIR = path.join(REPO_ROOT, 'docs', 'assets', 'images');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;
const GIT_DRY_RUN = process.env.GIT_DRY_RUN === '1';
const GIT_TOTAL_TIMEOUT = 120000;

/** 可编辑的 front matter 字段，其余字段一律原样保留。 */
const EDITABLE_KEYS = ['title', 'date', 'categories'];
const DEFAULT_CATEGORY = 'markdown';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
};

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

/** 构造带 HTTP 状态码的业务错误。 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** 统一 JSON 响应（所有 API 的 payload 都带 ok 字段）。 */
function sendJson(res, status, payload) {
  const buf = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

/** 读取并解析 JSON 请求体（上限 20MB，用于图片 base64 上传）。 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const LIMIT = 20 * 1024 * 1024;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > LIMIT) {
        reject(httpError(413, '请求体过大（上限 20MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(httpError(400, '请求体必须是 JSON 对象'));
          return;
        }
        resolve(parsed);
      } catch (_) {
        reject(httpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', (err) => {
      reject(httpError(400, '读取请求体失败：' + err.message));
    });
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateOnly(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 本地时间 YYYY-MM-DD HH:mm:ss（不转 UTC，配合固定 +0800 后缀）。 */
function formatLocalDateTime(d) {
  return formatDateOnly(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function defaultCommitMessage() {
  return 'docs: 更新文章 ' + formatLocalDateTime(new Date()).slice(0, 16);
}

// ---------------------------------------------------------------------------
// 路径安全
// ---------------------------------------------------------------------------

/**
 * 校验文章文件名（入参为 URL 中 percent-encoded 的原始片段）。
 * 规则：decodeURIComponent 后必须是纯文件名，不含 / \ .. 绝对路径，
 * 后缀只能是 .md / .markdown，且解析后的绝对路径必须落在 POSTS_DIR 内。
 */
function safePostName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw httpError(400, '缺少文件名');
  }

  let name = '';
  try {
    name = decodeURIComponent(rawName);
  } catch (_) {
    throw httpError(400, '文件名 URL 编码无效');
  }

  if (
    name.length > 200 ||
    name.includes('\0') ||
    /[\r\n]/.test(name) ||
    /[\\/]/.test(name) ||
    /:/.test(name) ||
    path.isAbsolute(name) ||
    name === '.' ||
    name === '..' ||
    name !== path.basename(name)
  ) {
    throw httpError(400, '非法文件名：只允许纯文件名，不得包含路径分隔符或盘符');
  }
  if (!/\.(md|markdown)$/i.test(name)) {
    throw httpError(400, '仅支持 .md / .markdown 扩展名');
  }

  const abs = path.resolve(POSTS_DIR, name);
  const base = path.resolve(POSTS_DIR) + path.sep;
  if (!abs.startsWith(base)) {
    throw httpError(400, '非法文件名：路径越界');
  }
  return { name, abs };
}

/** 清洗标题，生成可用于文件名的一段文本（保留中文，去掉 Windows 非法字符）。 */
function sanitizeTitleForFilename(title) {
  return String(title || '')
    .trim()
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
}

/** 生成 YYYY-MM-DD-标题.markdown，同名时自动追加 -2 / -3 …，绝不覆盖。 */
function generateUniqueFilename(title) {
  const stem = formatDateOnly(new Date()) + '-' + (sanitizeTitleForFilename(title) || 'untitled');
  let name = stem + '.markdown';
  let seq = 2;
  while (fs.existsSync(path.join(POSTS_DIR, name))) {
    name = stem + '-' + seq + '.markdown';
    seq += 1;
  }
  return safePostName(name);
}

// ---------------------------------------------------------------------------
// front matter 解析 / 拼装（互逆、行级保真）
// ---------------------------------------------------------------------------

/** 解析 YAML 标量：仅去掉成对引号，其余保持原字符串（含 [a, b] 等复杂值）。 */
function parseScalar(value) {
  const s = String(value).trim();
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** 从 front matter 原始行中提取 key: value 对象（忽略注释与复杂块，但仍会原样保留）。 */
function parseMetaLines(rawLines) {
  const meta = {};
  for (const line of rawLines) {
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = parseScalar(m[2]);
  }
  return meta;
}

/**
 * 解析一篇文章：
 * - eol：原始换行风格（\r\n 或 \n），写回时复用
 * - rawLines：front matter 原始行（不含首尾 ---），用于保真合并
 * - gap：front matter 结束行与正文之间的空行数量，写回时复用
 * - body：交给前端编辑的正文（已剥离前导分隔空行）
 */
function parsePost(content) {
  const eol = /\r\n/.test(content) ? '\r\n' : '\n';
  const text = String(content).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const result = {
    eol,
    hasFrontMatter: false,
    rawLines: [],
    meta: {},
    gap: 1,
    body: lines.join('\n'),
  };

  if (lines.length === 0 || lines[0].trim() !== '---') return result;

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') {
      end = i;
      break;
    }
  }
  if (end <= 0) return result;

  const after = lines.slice(end + 1);
  let gap = 0;
  while (gap < after.length && after[gap] === '') gap += 1;

  result.hasFrontMatter = true;
  result.rawLines = lines.slice(1, end);
  result.meta = parseMetaLines(result.rawLines);
  result.gap = gap;
  result.body = after.slice(gap).join('\n');
  return result;
}

/** title 使用双引号（与既有文章风格一致），其余字段原样输出。 */
function quoteMetaValue(key, value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (key === 'title') {
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return text;
}

/** 计算缺失字段应插入的位置：紧跟前一个已知字段（layout 之后兜底）。 */
function findInsertIndex(lines, key) {
  const order = EDITABLE_KEYS;
  const pos = order.indexOf(key);
  for (let p = pos - 1; p >= 0; p -= 1) {
    const re = new RegExp('^' + order[p] + '\\s*:');
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) return i + 1;
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (/^layout\s*:/.test(lines[i])) return i + 1;
  }
  return lines.length;
}

/**
 * 把可编辑字段合并进原始 front matter 行：
 * 已存在的行只替换 value（保留 key 后的空格与引号风格），其余行完全不动。
 */
function mergeMetaLines(rawLines, updates) {
  const lines = rawLines.slice();
  const seen = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const m = /^([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    if (EDITABLE_KEYS.includes(key) && Object.prototype.hasOwnProperty.call(updates, key)) {
      lines[i] = key + m[2] + quoteMetaValue(key, updates[key]);
      seen.add(key);
    }
  }

  for (const key of EDITABLE_KEYS) {
    if (seen.has(key) || !Object.prototype.hasOwnProperty.call(updates, key)) continue;
    const idx = findInsertIndex(lines, key);
    lines.splice(idx, 0, key + ': ' + quoteMetaValue(key, updates[key]));
  }
  return lines;
}

/** 由「原始解析结果 + 新字段值 + 新正文」拼回完整文件文本。 */
function buildPost(existing, updates, body, isNew) {
  const eol = existing ? existing.eol : '\n';
  const useTemplate = isNew || !existing || !existing.hasFrontMatter;
  const rawLines = useTemplate ? ['layout: post'] : existing.rawLines.slice();
  const gap = useTemplate ? 1 : existing.gap;

  const out = ['---', ...mergeMetaLines(rawLines, updates), '---'];
  for (let i = 0; i < gap; i += 1) out.push('');
  out.push(...String(body === null || body === undefined ? '' : body).split(/\r?\n/));
  return out.join(eol);
}

// ---------------------------------------------------------------------------
// 文章 API
// ---------------------------------------------------------------------------

/** 扫描 _posts，按 front matter 日期倒序。 */
function listPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const items = [];
  for (const entry of fs.readdirSync(POSTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
    const abs = path.join(POSTS_DIR, entry.name);
    try {
      const stat = fs.statSync(abs);
      const parsed = parsePost(fs.readFileSync(abs, 'utf8'));
      items.push({
        filename: entry.name,
        title: parsed.meta.title || entry.name.replace(/\.(md|markdown)$/i, ''),
        date: parsed.meta.date || '',
        categories: parsed.meta.categories || '',
        mtime: stat.mtimeMs,
      });
    } catch (_) {
      // 单个文件读取失败不影响列表其余项
    }
  }
  items.sort((a, b) => {
    const da = String(a.date).slice(0, 10);
    const db = String(b.date).slice(0, 10);
    if (da !== db) return db.localeCompare(da);
    return b.filename.localeCompare(a.filename, 'zh-CN');
  });
  return items;
}

function handleListPosts(res) {
  sendJson(res, 200, { ok: true, posts: listPosts(), dir: path.relative(REPO_ROOT, POSTS_DIR).replace(/\\/g, '/') });
}

function handleReadPost(res, rawName) {
  const { name, abs } = safePostName(rawName);
  if (!fs.existsSync(abs)) throw httpError(404, '文章不存在：' + name);
  const parsed = parsePost(fs.readFileSync(abs, 'utf8'));
  sendJson(res, 200, {
    ok: true,
    filename: name,
    meta: parsed.meta,
    metaKeys: Object.keys(parsed.meta),
    hasFrontMatter: parsed.hasFrontMatter,
    body: parsed.body,
  });
}

async function handleSavePost(req, res) {
  const payload = await readJsonBody(req);
  const isNew = payload.isNew === true;
  const title = typeof payload.title === 'string' ? payload.title : '';
  const date = typeof payload.date === 'string' && payload.date.trim()
    ? payload.date
    : formatLocalDateTime(new Date()) + ' +0800';
  const categories = typeof payload.categories === 'string' && payload.categories.trim()
    ? payload.categories
    : DEFAULT_CATEGORY;
  const body = typeof payload.body === 'string' ? payload.body : '';
  const updates = { title, date, categories };

  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }

  if (!isNew) {
    if (typeof payload.filename !== 'string' || !payload.filename) {
      throw httpError(400, '保存已有文章必须提供 filename');
    }
    const { name, abs } = safePostName(payload.filename);
    if (!fs.existsSync(abs)) throw httpError(404, '文章不存在：' + name);
    const existing = parsePost(fs.readFileSync(abs, 'utf8'));
    fs.writeFileSync(abs, buildPost(existing, updates, body, false), 'utf8');
    sendJson(res, 200, { ok: true, filename: name, created: false });
    return;
  }

  // 新建：显式传了 filename 则严格校验冲突，不静默覆盖；否则自动生成唯一文件名。
  let target;
  if (typeof payload.filename === 'string' && payload.filename.trim()) {
    target = safePostName(payload.filename.trim());
    if (fs.existsSync(target.abs)) {
      throw httpError(409, '同名文件已存在，未覆盖：' + target.name + '（请换一个标题）');
    }
  } else {
    target = generateUniqueFilename(title);
  }
  fs.writeFileSync(target.abs, buildPost(null, updates, body, true), 'utf8');
  sendJson(res, 201, { ok: true, filename: target.name, created: true });
}

function handleDeletePost(res, rawName) {
  const { name, abs } = safePostName(rawName);
  if (!fs.existsSync(abs)) throw httpError(404, '文章不存在：' + name);
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(TRASH_DIR, stamp + '-' + name);
  fs.copyFileSync(abs, backup);
  fs.unlinkSync(abs);
  sendJson(res, 200, {
    ok: true,
    filename: name,
    backup: path.relative(EDITOR_DIR, backup).replace(/\\/g, '/'),
  });
}

/** 粘贴 / 拖拽图片：保存 base64 到 docs/assets/images/ 并返回站内相对 URL。 */
async function handleImageUpload(req, res) {
  const payload = await readJsonBody(req);
  const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : '';
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw httpError(400, '图片数据无效（需要 image/* 的 base64 DataURL）');

  const subtype = m[1].toLowerCase();
  if (subtype.includes('svg')) throw httpError(400, '出于安全考虑不支持 SVG 图片');
  const extMap = {
    png: 'png', jpg: 'jpg', jpeg: 'jpeg', gif: 'gif',
    webp: 'webp', bmp: 'bmp', 'x-icon': 'ico',
  };
  const ext = extMap[subtype] || 'png';
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) throw httpError(400, '图片内容为空');
  if (buffer.length > 15 * 1024 * 1024) throw httpError(413, '图片过大（上限 15MB）');

  if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const name = 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  fs.writeFileSync(path.join(IMAGE_DIR, name), buffer);
  sendJson(res, 200, { ok: true, filename: name, url: '/assets/images/' + name });
}

// ---------------------------------------------------------------------------
// Git API
// ---------------------------------------------------------------------------

function formatGitCmd(args) {
  return 'git ' + args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/**
 * 执行一条 git 命令，返回结构化步骤。
 * options.write=true 的命令在 GIT_DRY_RUN=1 下只模拟不执行。
 */
function runGit(args, options) {
  const opts = options || {};
  const cmd = formatGitCmd(args);
  if (opts.write === true && GIT_DRY_RUN) {
    return Promise.resolve({
      cmd,
      code: 0,
      stdout: '[DRY-RUN] 仅模拟，未真实执行：' + cmd,
      stderr: '',
      skipped: true,
    });
  }

  const timeout = Math.max(1000, Math.min(opts.timeout || 60000, GIT_TOTAL_TIMEOUT));
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      let code = 0;
      if (err) code = typeof err.code === 'number' ? err.code : 1;
      resolve({
        cmd,
        code,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        timedOut: !!(err && err.killed),
      });
    });
  });
}

/** commit 报「没有可提交内容」属于预期情况，不应中断后续 push。 */
function detectNoChanges(step) {
  const text = (step.stdout + '\n' + step.stderr).toLowerCase();
  return text.includes('nothing to commit') ||
    text.includes('no changes added to commit') ||
    text.includes('working tree clean');
}

/** 把常见 push 错误翻译成可读的中文建议。 */
function pushHint(step) {
  if (step.skipped) return 'DRY-RUN 模式：未真实推送，可用于验证流程。';
  if (step.code === 0) {
    return /everything up-to-date/i.test(step.stdout)
      ? '远端已是最新，无需推送。'
      : '推送成功，GitHub Pages 稍后会自动重新构建。';
  }
  const s = (step.stderr + ' ' + step.stdout).toLowerCase();
  if (/authentication failed|could not read username|invalid username or password|bad credentials|403|401|logon failed/.test(s)) {
    return '认证失败：请检查 GitHub 凭据（推荐 Personal Access Token 或 Git Credential Manager），然后重试。';
  }
  if (/permission denied \(publickey\)|publickey/.test(s)) {
    return 'SSH 密钥认证失败：请配置 SSH key，或把 remote 改为 HTTPS 地址。';
  }
  if (/non-fast-forward|fetch first|rejected|updates were rejected|behind its remote/.test(s)) {
    return '推送被拒绝（非快进）：远端有更新，请先执行 git pull --rebase 再推送。';
  }
  if (/could not resolve host|timed out|network is unreachable|failed to connect|unable to access|connection reset|ssl|proxy/.test(s)) {
    return '网络异常：请检查网络或 Git 代理设置后重试。';
  }
  if (step.timedOut) return '命令执行超时：请检查网络或稍后重试。';
  return '推送失败：请查看上方日志中的原始错误信息。';
}

async function handleGitStatus(res) {
  const branchStep = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchStep.code === 0 ? branchStep.stdout.trim() : '';

  const remoteStep = await runGit(['remote']);
  const remotes = remoteStep.code === 0
    ? remoteStep.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] || 'origin');

  const urlStep = await runGit(['remote', 'get-url', remote]);
  const remoteUrl = urlStep.code === 0 ? urlStep.stdout.trim() : '';

  // -c core.quotepath=false 保证中文文件名不被转义成八进制序列
  const statusStep = await runGit(['-c', 'core.quotepath=false', 'status', '--short']);
  const changes = statusStep.code === 0 && statusStep.stdout
    ? statusStep.stdout.split('\n').filter((line) => line.trim().length > 0)
    : [];

  sendJson(res, 200, {
    ok: true,
    branch,
    remote,
    remoteUrl,
    changes,
    dryRun: GIT_DRY_RUN,
  });
}

async function handleGitPush(req, res) {
  const payload = await readJsonBody(req);
  const message = (typeof payload.message === 'string' && payload.message.trim())
    ? payload.message.trim()
    : defaultCommitMessage();
  const steps = [];
  const started = Date.now();

  const remaining = () => Math.max(5000, GIT_TOTAL_TIMEOUT - (Date.now() - started));

  const branchStep = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchStep.code === 0 ? branchStep.stdout.trim() : '';
  if (!branch || branch === 'HEAD') {
    steps.push(Object.assign({}, branchStep, { note: '无法获取有效分支名，已中止推送' }));
    sendJson(res, 200, { ok: false, steps, error: '无法获取有效分支名（可能处于 detached HEAD），已中止推送', dryRun: GIT_DRY_RUN });
    return;
  }

  const remoteStep = await runGit(['remote']);
  const remotes = remoteStep.code === 0
    ? remoteStep.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : [];
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] || '');
  if (!remote) {
    steps.push(Object.assign({}, remoteStep, { note: '仓库未配置任何 remote，已中止推送' }));
    sendJson(res, 200, { ok: false, steps, error: '仓库未配置 remote，请先用 git remote add origin <url> 配置', dryRun: GIT_DRY_RUN });
    return;
  }

  // 步骤 1：git add -A
  const addStep = await runGit(['add', '-A'], { write: true, timeout: Math.min(30000, remaining()) });
  steps.push(addStep);
  if (addStep.code !== 0) {
    sendJson(res, 200, {
      ok: false, steps, branch, remote, message, dryRun: GIT_DRY_RUN,
      error: 'git add 失败：' + (addStep.stderr || '未知错误'),
    });
    return;
  }

  // 步骤 2：git commit（无变更时属于预期，不中断）
  const commitStep = await runGit(['commit', '-m', message], { write: true, timeout: Math.min(30000, remaining()) });
  const noChanges = detectNoChanges(commitStep);
  steps.push(Object.assign({}, commitStep, {
    note: noChanges
      ? '没有需要提交的变更，已跳过 commit（非致命），继续尝试 push。'
      : (commitStep.code === 0 ? '已创建提交。' : 'commit 未成功，继续尝试 push 以便把已有本地提交同步到远端。'),
  }));

  // 步骤 3：git push
  const pushStep = await runGit(['push', remote, branch], { write: true, timeout: Math.min(60000, remaining()) });
  steps.push(Object.assign({}, pushStep, { hint: pushHint(pushStep) }));

  const ok = pushStep.code === 0;
  sendJson(res, 200, {
    ok,
    steps,
    branch,
    remote,
    message,
    dryRun: GIT_DRY_RUN,
    noChanges,
    error: ok ? '' : (pushStep.hint || '推送失败'),
  });
}

// ---------------------------------------------------------------------------
// 静态资源
// ---------------------------------------------------------------------------

function serveStatic(res, pathname, isHead) {
  let rel = '';
  try {
    rel = decodeURIComponent(pathname);
  } catch (_) {
    throw httpError(400, '资源路径编码无效');
  }
  rel = rel.replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  if (rel.includes('\0')) throw httpError(400, '非法资源路径');

  const abs = path.resolve(PUBLIC_DIR, rel);
  const base = path.resolve(PUBLIC_DIR) + path.sep;
  if (!abs.startsWith(base)) throw httpError(403, '禁止访问：路径越界');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw httpError(404, '资源不存在：' + rel);
  }

  const ext = path.extname(abs).toLowerCase();
  const data = fs.readFileSync(abs);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(isHead ? undefined : data);
}

/** 启动时尝试打开默认浏览器，失败静默忽略。 */
function openBrowser(url) {
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch (_) {
    // 打不开浏览器不影响服务，用户可手动访问
  }
}

// ---------------------------------------------------------------------------
// 路由与服务器
// ---------------------------------------------------------------------------

async function route(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://' + HOST).pathname;
  } catch (_) {
    throw httpError(400, '无效的请求 URL');
  }

  const POST_PREFIX = '/api/posts/';

  if (pathname === '/api/posts' && method === 'GET') return handleListPosts(res);
  if (pathname === '/api/posts' && method === 'POST') return handleSavePost(req, res);
  if (pathname.startsWith(POST_PREFIX) && method === 'GET') {
    return handleReadPost(res, pathname.slice(POST_PREFIX.length));
  }
  if (pathname.startsWith(POST_PREFIX) && method === 'DELETE') {
    return handleDeletePost(res, pathname.slice(POST_PREFIX.length));
  }
  if (pathname === '/api/git/status' && method === 'GET') return handleGitStatus(res);
  if (pathname === '/api/git/push' && method === 'POST') return handleGitPush(req, res);
  if (pathname === '/api/images' && method === 'POST') return handleImageUpload(req, res);

  if (pathname.startsWith('/api/')) throw httpError(404, '未知 API：' + pathname);
  if (method !== 'GET' && method !== 'HEAD') throw httpError(405, '不支持的请求方法：' + method);
  return serveStatic(res, pathname, method === 'HEAD');
}

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => route(req, res))
    .catch((err) => {
      const status = Number(err && err.status) || 500;
      const message = (err && err.message) ? err.message : '服务器内部错误';
      if (status >= 500) console.error('[error]', err);
      if (!res.headersSent) {
        sendJson(res, status, { ok: false, error: message });
      } else {
        res.end();
      }
    });
});

server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  const url = 'http://' + HOST + ':' + PORT + '/';
  console.log('====================================================');
  console.log('  Jekyll Markdown 可视化编辑器已启动');
  console.log('  访问地址 : ' + url);
  console.log('  文章目录 : ' + POSTS_DIR);
  console.log('  静态资源 : ' + PUBLIC_DIR);
  console.log('  Git 模式 : ' + (GIT_DRY_RUN ? 'DRY-RUN（写命令仅模拟）' : '正常'));
  console.log('  停止服务 : 按 Ctrl + C');
  console.log('====================================================');
  if (!fs.existsSync(POSTS_DIR)) {
    console.warn('[warn] 未找到 docs/_posts/，请确认编辑器位于仓库根目录的 editor/ 下。');
  }
  if (process.env.EDITOR_NO_BROWSER !== '1') openBrowser(url);
});
