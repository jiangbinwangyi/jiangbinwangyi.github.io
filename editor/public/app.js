'use strict';

/**
 * Markdown 可视化编辑器 —— 前端逻辑（原生 ES6，无构建、无依赖）
 *
 * 职责：文章列表 / front matter 与正文分离编辑 / 实时预览 / 自动保存 /
 *       格式工具栏与快捷键 / 图片粘贴拖拽 / Git 状态与一键推送。
 */

// ---------------------------------------------------------------------------
// DOM 引用
// ---------------------------------------------------------------------------

const els = {
  layout: document.getElementById('layout'),
  saveState: document.getElementById('saveState'),
  btnNew: document.getElementById('btnNew'),
  btnSave: document.getElementById('btnSave'),
  btnDelete: document.getElementById('btnDelete'),
  viewButtons: Array.prototype.slice.call(document.querySelectorAll('[data-view]')),

  gitBranch: document.getElementById('gitBranch'),
  gitRemote: document.getElementById('gitRemote'),
  gitRemoteUrl: document.getElementById('gitRemoteUrl'),
  gitChangeCount: document.getElementById('gitChangeCount'),
  gitDryRun: document.getElementById('gitDryRun'),
  btnGitRefresh: document.getElementById('btnGitRefresh'),
  commitMsg: document.getElementById('commitMsg'),
  btnGitPush: document.getElementById('btnGitPush'),
  gitDetails: document.getElementById('gitDetails'),
  gitChanges: document.getElementById('gitChanges'),
  gitLog: document.getElementById('gitLog'),

  postCount: document.getElementById('postCount'),
  search: document.getElementById('search'),
  postList: document.getElementById('postList'),
  listFoot: document.getElementById('listFoot'),

  title: document.getElementById('title'),
  date: document.getElementById('date'),
  categories: document.getElementById('categories'),
  fileName: document.getElementById('fileName'),
  metaHint: document.getElementById('metaHint'),
  toolbarButtons: Array.prototype.slice.call(document.querySelectorAll('[data-cmd]')),
  body: document.getElementById('body'),
  emptyHint: document.getElementById('emptyHint'),
  preview: document.getElementById('preview'),
  toast: document.getElementById('toast'),
};

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

const state = {
  posts: [],
  current: null,       // { filename, meta, body }
  filter: '',
  dirty: false,
  saving: false,
  saveTimer: null,
  toastTimer: null,
  view: 'split',
};

const AUTO_SAVE_DELAY = 1500;
const EDITABLE_KEYS = ['title', 'date', 'categories'];

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function defaultCommitMessage() {
  return 'docs: 更新文章 ' + formatLocalDateTime(new Date()).slice(0, 16);
}

/** 统一 JSON 请求；非 2xx 或 ok:false 时抛出带服务端错误信息的 Error。 */
async function api(url, options) {
  const opts = Object.assign({ headers: {} }, options || {});
  if (opts.body !== undefined && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json; charset=utf-8';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('服务器返回了非 JSON 内容（HTTP ' + res.status + '）');
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
  }
  return data;
}

function showToast(message, type) {
  const kind = type || 'info';
  els.toast.textContent = message;
  els.toast.className = 'toast ' + kind;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function () {
    els.toast.hidden = true;
  }, 3600);
}

/** 保存状态标签：clean / unsaved / saving / saved / error。 */
function setSaveState(kind, detail) {
  const now = formatLocalDateTime(new Date()).slice(11);
  const map = {
    clean: '● 就绪',
    unsaved: '● 未保存',
    saving: '⟳ 保存中…',
    saved: '✓ 已保存 ' + now,
    error: '✕ 保存失败',
  };
  els.saveState.className = 'save-state ' + kind;
  els.saveState.textContent = map[kind] || '● 就绪';
  els.saveState.title = detail ? String(detail) : (map[kind] || '');
}

function setEditorEnabled(enabled) {
  els.title.disabled = !enabled;
  els.date.disabled = !enabled;
  els.categories.disabled = !enabled;
  els.body.disabled = !enabled;
  els.btnSave.disabled = !enabled;
  els.btnDelete.disabled = !enabled;
  els.toolbarButtons.forEach(function (btn) { btn.disabled = !enabled; });
  els.emptyHint.style.display = enabled ? 'none' : 'flex';
}

// ---------------------------------------------------------------------------
// 文章列表
// ---------------------------------------------------------------------------

async function loadPosts(selectFirst) {
  try {
    const data = await api('/api/posts');
    state.posts = Array.isArray(data.posts) ? data.posts : [];
    renderPostList();
    els.postCount.textContent = String(state.posts.length);
    els.listFoot.textContent = data.dir
      ? '扫描目录：' + data.dir + '（.md / .markdown，按日期倒序）'
      : '点击文章打开，或在顶部新建。';
    if (selectFirst && state.posts.length > 0 && !state.current) {
      await openPost(state.posts[0].filename, true);
    }
  } catch (err) {
    showToast('加载文章列表失败：' + err.message, 'error');
  }
}

function renderPostList() {
  const keyword = state.filter.trim().toLowerCase();
  const matched = state.posts.filter(function (p) {
    if (!keyword) return true;
    return (p.filename + ' ' + p.title + ' ' + p.categories + ' ' + p.date)
      .toLowerCase().indexOf(keyword) !== -1;
  });

  els.postList.textContent = '';
  if (matched.length === 0) {
    const li = document.createElement('li');
    li.className = 'post-empty';
    li.textContent = state.posts.length === 0 ? '暂无文章，点击「＋ 新建文章」开始。' : '没有匹配的文章。';
    els.postList.appendChild(li);
    return;
  }

  matched.forEach(function (post) {
    const li = document.createElement('li');
    li.className = 'post-item';
    li.dataset.filename = post.filename;
    if (state.current && state.current.filename === post.filename) li.classList.add('active');

    const name = document.createElement('div');
    name.className = 'post-name';
    name.textContent = post.filename;

    const title = document.createElement('div');
    title.className = 'post-title';
    title.textContent = post.title || '（无标题）';

    const meta = document.createElement('div');
    meta.className = 'post-meta';
    meta.textContent = (post.date || '无日期') + ' · ' + (post.categories || '未分类');

    li.appendChild(name);
    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener('click', function () { openPost(post.filename); });
    els.postList.appendChild(li);
  });
}

function highlightActive(filename) {
  Array.prototype.forEach.call(els.postList.children, function (li) {
    if (!li.dataset) return;
    li.classList.toggle('active', li.dataset.filename === filename);
  });
}

// ---------------------------------------------------------------------------
// 打开 / 新建 / 删除 / 保存
// ---------------------------------------------------------------------------

function collectPayload() {
  return {
    filename: state.current ? state.current.filename : '',
    isNew: false,
    title: els.title.value,
    date: els.date.value.trim(),
    categories: els.categories.value.trim() || 'markdown',
    body: els.body.value,
  };
}

/** 内容变化后调用：标记脏数据、刷新预览、排期自动保存。 */
function afterEdit() {
  if (!state.current) return;
  state.dirty = true;
  setSaveState('unsaved');
  renderPreview();
  scheduleAutoSave();
}

function scheduleAutoSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(function () {
    if (state.saving) {
      scheduleAutoSave();
      return;
    }
    savePost(false);
  }, AUTO_SAVE_DELAY);
}

async function savePost(manual) {
  if (!state.current || state.saving) return;
  clearTimeout(state.saveTimer);

  const payload = collectPayload();
  const snapshot = JSON.stringify(payload);
  state.saving = true;
  setSaveState('saving');

  try {
    const data = await api('/api/posts', { method: 'POST', body: payload });
    state.current.filename = data.filename;
    els.fileName.value = data.filename;
    highlightActive(data.filename);

    // 保存期间用户若继续输入，不能错误地把状态标成「已保存」
    if (JSON.stringify(collectPayload()) === snapshot) {
      state.dirty = false;
      setSaveState('saved');
    } else {
      state.dirty = true;
      setSaveState('unsaved');
      scheduleAutoSave();
    }
    await loadPosts(false);
    if (manual) showToast('已保存到 docs/_posts/' + data.filename, 'ok');
  } catch (err) {
    state.dirty = true;
    setSaveState('error', err.message);
    showToast('保存失败：' + err.message, 'error');
  } finally {
    state.saving = false;
  }
}

async function openPost(filename, silent) {
  if (state.dirty) {
    const shouldSave = window.confirm(
      '当前文章有未保存的修改。\n\n点「确定」：先保存再切换；\n点「取消」：放弃修改并切换。'
    );
    if (shouldSave) {
      await savePost(false);
    } else {
      state.dirty = false;
    }
    clearTimeout(state.saveTimer);
  }

  try {
    const data = await api('/api/posts/' + encodeURIComponent(filename));
    state.current = {
      filename: data.filename,
      meta: data.meta || {},
      body: typeof data.body === 'string' ? data.body : '',
    };

    els.title.value = state.current.meta.title || '';
    els.date.value = state.current.meta.date || '';
    els.categories.value = state.current.meta.categories || '';
    els.fileName.value = data.filename;
    els.body.value = state.current.body;

    const extras = (data.metaKeys || []).filter(function (key) {
      return EDITABLE_KEYS.indexOf(key) === -1;
    });
    els.metaHint.textContent = extras.length > 0
      ? '原有字段（' + extras.join('、') + '）及 layout 将原样保留；修改标题不会自动重命名文件名（避免 Jekyll 链接失效）。'
      : 'layout 等 front matter 字段原样保留；修改标题不会自动重命名文件名（避免 Jekyll 链接失效）。';

    setEditorEnabled(true);
    state.dirty = false;
    setSaveState('clean');
    renderPreview();
    highlightActive(data.filename);
    if (!silent) showToast('已打开 ' + data.filename, 'info');
  } catch (err) {
    showToast('打开失败：' + err.message, 'error');
  }
}

async function newPost() {
  const input = window.prompt('请输入新文章标题：\n（将自动生成 YYYY-MM-DD-标题.markdown）', '');
  if (input === null) return;
  const title = input.trim();
  if (!title) {
    showToast('标题不能为空，已取消新建。', 'error');
    return;
  }
  if (state.dirty && !window.confirm('当前文章有未保存的修改，确定放弃并新建文章吗？')) return;

  clearTimeout(state.saveTimer);
  state.dirty = false;
  const date = formatLocalDateTime(new Date()) + ' +0800';
  try {
    const data = await api('/api/posts', {
      method: 'POST',
      body: { isNew: true, title: title, date: date, categories: 'markdown', body: '' },
    });
    showToast('已新建 ' + data.filename, 'ok');
    await loadPosts(false);
    await openPost(data.filename, true);
  } catch (err) {
    showToast('新建失败：' + err.message, 'error');
  }
}

async function deleteCurrentPost() {
  if (!state.current) return;
  const filename = state.current.filename;
  if (!window.confirm('确定删除文章「' + filename + '」吗？\n\n删除前会自动备份到 editor/.trash/，可手动恢复。')) return;
  if (!window.confirm('请再次确认：真的要删除「' + filename + '」吗？此操作不可撤销（但有备份）。')) return;

  clearTimeout(state.saveTimer);
  try {
    const data = await api('/api/posts/' + encodeURIComponent(filename), { method: 'DELETE' });
    state.dirty = false;
    state.current = null;
    els.title.value = '';
    els.date.value = '';
    els.categories.value = '';
    els.fileName.value = '';
    els.body.value = '';
    els.metaHint.textContent = '文章已删除，请从左侧选择或新建一篇文章。';
    setEditorEnabled(false);
    setSaveState('clean');
    renderPreview();
    await loadPosts(false);
    showToast('已删除 ' + filename + '，备份：' + data.backup, 'ok');
  } catch (err) {
    showToast('删除失败：' + err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// 预览与滚动同步
// ---------------------------------------------------------------------------

function renderPreview() {
  const renderer = window.MarkdownLite;
  if (!renderer || typeof renderer.render !== 'function') {
    els.preview.innerHTML = '<p class="preview-empty">预览渲染器未加载，请检查 /vendor/markdown-lite.js。</p>';
    return;
  }
  const html = renderer.render(els.body.value);
  els.preview.innerHTML = html || '<p class="preview-empty">（正文为空）</p>';
}

let scrollLockUntil = 0;

function bindScrollSync() {
  function sync(from, to) {
    if (Date.now() < scrollLockUntil) return;
    const maxFrom = Math.max(1, from.scrollHeight - from.clientHeight);
    const maxTo = Math.max(0, to.scrollHeight - to.clientHeight);
    scrollLockUntil = Date.now() + 90;
    to.scrollTop = (from.scrollTop / maxFrom) * maxTo;
  }
  els.body.addEventListener('scroll', function () { sync(els.body, els.preview); });
  els.preview.addEventListener('scroll', function () { sync(els.preview, els.body); });
}

function switchView(view) {
  state.view = view;
  els.layout.className = 'layout view-' + view;
  els.viewButtons.forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

// ---------------------------------------------------------------------------
// 格式工具栏：在光标处插入 / 包裹语法
// ---------------------------------------------------------------------------

/** 用 prefix/suffix 包裹选中文本；无选中时插入占位文本并选中它。 */
function wrapSelection(prefix, suffix, placeholder) {
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end) || placeholder || '';
  ta.value = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
  ta.focus();
  ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  afterEdit();
}

/** 在选中区域涉及的每一行的行首插入前缀。 */
function linePrefix(prefix, placeholder, numbered) {
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const replaced = block.split('\n').map(function (line, index) {
    const head = numbered ? String(index + 1) + '. ' : prefix;
    return line.trim() === '' ? head + placeholder : head + line;
  }).join('\n');

  ta.value = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
  ta.focus();
  ta.setSelectionRange(lineStart + prefix.length, lineStart + replaced.length);
  afterEdit();
}

/** 在光标处插入一段文本。 */
function insertAtCursor(text) {
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  ta.value = value.slice(0, start) + text + value.slice(end);
  const caret = start + text.length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  afterEdit();
}

function insertLink() {
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end);
  const label = selected || '链接文字';
  const snippet = '[' + label + '](https://)';
  ta.value = value.slice(0, start) + snippet + value.slice(end);
  const urlStart = start + 1 + label.length + 2;
  ta.focus();
  ta.setSelectionRange(urlStart, urlStart + 'https://'.length);
  afterEdit();
}

function insertImageSyntax() {
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const alt = value.slice(start, end) || '图片描述';
  const snippet = '![' + alt + '](/assets/images/)';
  ta.value = value.slice(0, start) + snippet + value.slice(end);
  const urlStart = start + 2 + alt.length + 2;
  ta.focus();
  ta.setSelectionRange(urlStart, urlStart);
  afterEdit();
  showToast('已插入图片语法。可直接粘贴或拖拽图片文件到编辑区，会自动上传到 docs/assets/images/。', 'info');
}

function insertCodeBlock() {
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end);
  const snippet = selected
    ? '```\n' + selected + '\n```'
    : '```\n// 在此输入代码\n```';
  ta.value = value.slice(0, start) + snippet + value.slice(end);
  const innerStart = start + 4;
  ta.focus();
  ta.setSelectionRange(innerStart, innerStart + (selected || '// 在此输入代码').length);
  afterEdit();
}

function insertTable() {
  insertAtCursor('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |');
}

const FORMAT_ACTIONS = {
  h1: function () { linePrefix('# ', '一级标题', false); },
  h2: function () { linePrefix('## ', '二级标题', false); },
  h3: function () { linePrefix('### ', '三级标题', false); },
  bold: function () { wrapSelection('**', '**', '加粗文字'); },
  italic: function () { wrapSelection('*', '*', '斜体文字'); },
  strike: function () { wrapSelection('~~', '~~', '删除线文字'); },
  quote: function () { linePrefix('> ', '引用内容', false); },
  ul: function () { linePrefix('- ', '列表项', false); },
  ol: function () { linePrefix('1. ', '列表项', true); },
  link: insertLink,
  image: insertImageSyntax,
  code: insertCodeBlock,
  table: insertTable,
  hr: function () { insertAtCursor('\n---\n'); },
};

function runFormat(cmd) {
  const action = FORMAT_ACTIONS[cmd];
  if (!action) return;
  if (!state.current) {
    showToast('请先从左侧打开一篇文章，或点击「＋ 新建文章」。', 'error');
    return;
  }
  action();
}

/** Tab 缩进：选中多行时每行加两个空格，未选中时在光标处插入两个空格。 */
function handleTabKey(event) {
  event.preventDefault();
  const ta = els.body;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;

  if (start !== end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end);
    const indented = block.replace(/^/gm, '  ');
    ta.value = value.slice(0, lineStart) + indented + value.slice(end);
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + indented.length);
  } else {
    ta.value = value.slice(0, start) + '  ' + value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + 2, start + 2);
  }
  afterEdit();
}

function bindShortcuts() {
  document.addEventListener('keydown', function (event) {
    const mod = event.ctrlKey || event.metaKey;
    const key = String(event.key || '').toLowerCase();
    const active = document.activeElement;
    const inInput = active && active.tagName === 'INPUT';

    if (mod && key === 's') {
      event.preventDefault();
      savePost(true);
      return;
    }
    if (event.key === 'Tab' && active === els.body) {
      handleTabKey(event);
      return;
    }
    if (!mod || inInput) return;

    if (key === 'b') { event.preventDefault(); runFormat('bold'); return; }
    if (key === 'i') { event.preventDefault(); runFormat('italic'); return; }
    if (key === 'k') { event.preventDefault(); runFormat('link'); }
  });
}

// ---------------------------------------------------------------------------
// 图片：粘贴 / 拖拽 -> docs/assets/images/
// ---------------------------------------------------------------------------

function readFileAsDataURL(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result)); };
    reader.onerror = function () { reject(new Error('读取图片文件失败')); };
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(file) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
  if (!state.current) {
    showToast('请先打开或新建文章，再插入图片。', 'error');
    return;
  }
  showToast('正在上传图片…', 'info');
  try {
    const dataUrl = await readFileAsDataURL(file);
    const data = await api('/api/images', { method: 'POST', body: { dataUrl: dataUrl } });
    const alt = (file.name || '图片').replace(/[\[\]]/g, '');
    insertAtCursor('![' + alt + '](' + data.url + ')');
    showToast('图片已保存到 docs/assets/images/' + data.filename, 'ok');
  } catch (err) {
    showToast('图片上传失败：' + err.message, 'error');
  }
}

function bindImageInput() {
  els.body.addEventListener('paste', function (event) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type && item.type.indexOf('image/') === 0) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          uploadImageFile(file);
          return;
        }
      }
    }
  });

  els.body.addEventListener('dragover', function (event) { event.preventDefault(); });
  els.body.addEventListener('drop', function (event) {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length > 0 && files[0].type.indexOf('image/') === 0) {
      event.preventDefault();
      uploadImageFile(files[0]);
    }
  });
}

// ---------------------------------------------------------------------------
// Git：状态与一键推送
// ---------------------------------------------------------------------------

async function refreshGitStatus() {
  els.btnGitRefresh.disabled = true;
  try {
    const data = await api('/api/git/status');
    els.gitBranch.textContent = data.branch || '（未知）';
    els.gitRemote.textContent = data.remote || '（未配置）';
    els.gitRemoteUrl.textContent = data.remoteUrl || '（无远端 URL）';
    els.gitRemoteUrl.title = data.remoteUrl || '';
    const changes = Array.isArray(data.changes) ? data.changes : [];
    els.gitChangeCount.textContent = String(changes.length);
    els.gitDryRun.hidden = !data.dryRun;
    els.gitChanges.textContent = changes.length > 0
      ? changes.join('\n')
      : '工作区干净，没有未提交的变更。';
    if (!els.commitMsg.value.trim()) els.commitMsg.value = defaultCommitMessage();
  } catch (err) {
    els.gitChanges.textContent = '获取 Git 状态失败：' + err.message;
    showToast('获取 Git 状态失败：' + err.message, 'error');
  } finally {
    els.btnGitRefresh.disabled = false;
  }
}

function renderPushResult(data) {
  const lines = [];
  if (data.dryRun) lines.push('[DRY-RUN 模式] 所有 git 写命令仅模拟，未产生真实提交或推送。');
  if (data.branch) lines.push('分支：' + data.branch + '    remote：' + (data.remote || '—'));
  if (data.message) lines.push('提交信息：' + data.message);
  lines.push('');

  const steps = Array.isArray(data.steps) ? data.steps : [];
  steps.forEach(function (step, index) {
    lines.push('── 步骤 ' + (index + 1) + ' ──');
    lines.push('$ ' + (step.cmd || ''));
    lines.push('退出码：' + String(step.code));
    if (step.stdout) lines.push(step.stdout);
    if (step.stderr) lines.push('[stderr] ' + step.stderr);
    if (step.note) lines.push('* ' + step.note);
    if (step.hint) lines.push('=> ' + step.hint);
    lines.push('');
  });

  lines.push(data.ok ? '结果：✅ 推送流程完成。' : '结果：❌ ' + (data.error || '推送失败'));
  els.gitLog.textContent = lines.join('\n');
  els.gitDetails.open = true;
}

async function doPush() {
  if (state.dirty) {
    if (!window.confirm('当前文章有未保存的修改，是否先保存再推送？')) return;
    await savePost(false);
    if (state.dirty) {
      showToast('保存未完成，已中止推送以免遗漏内容。', 'error');
      return;
    }
  }

  const message = els.commitMsg.value.trim() || defaultCommitMessage();
  els.btnGitPush.disabled = true;
  els.btnGitPush.textContent = '⏳ 正在执行 Git 操作…';
  els.gitLog.textContent = '正在执行 git add / commit / push，请稍候（最长 120 秒）…';
  els.gitDetails.open = true;

  try {
    const res = await fetch('/api/git/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: message }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      throw new Error('服务器返回了非 JSON 内容（HTTP ' + res.status + '）');
    }
    renderPushResult(data);
    if (data.ok) {
      showToast('一键提交并推送完成。' + (data.noChanges ? '（无新提交，工作区本来就是干净的）' : ''), 'ok');
    } else {
      showToast('推送未成功：' + (data.error || '请查看日志'), 'error');
    }
  } catch (err) {
    els.gitLog.textContent = '请求 /api/git/push 失败：' + err.message;
    showToast('推送请求失败：' + err.message, 'error');
  } finally {
    els.btnGitPush.disabled = false;
    els.btnGitPush.textContent = '🚀 一键提交并推送';
    await refreshGitStatus();
  }
}

// ---------------------------------------------------------------------------
// 事件绑定与初始化
// ---------------------------------------------------------------------------

function bindEvents() {
  els.btnNew.addEventListener('click', newPost);
  els.btnSave.addEventListener('click', function () { savePost(true); });
  els.btnDelete.addEventListener('click', deleteCurrentPost);

  els.viewButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view); });
  });

  els.search.addEventListener('input', function () {
    state.filter = els.search.value;
    renderPostList();
  });

  [els.title, els.date, els.categories].forEach(function (input) {
    input.addEventListener('input', afterEdit);
  });
  els.body.addEventListener('input', afterEdit);

  els.toolbarButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { runFormat(btn.dataset.cmd); });
  });

  els.btnGitRefresh.addEventListener('click', refreshGitStatus);
  els.btnGitPush.addEventListener('click', doPush);

  window.addEventListener('beforeunload', function (event) {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '有未保存的修改，确定离开吗？';
    // 尽力用 keepalive 再发一次保存，主保障仍是上面的离开确认
    try {
      if (!state.current) return;
      fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(collectPayload()),
        keepalive: true,
      });
    } catch (_) {
      // 页面正在关闭，忽略
    }
  });

  bindShortcuts();
  bindScrollSync();
  bindImageInput();
}

function init() {
  setEditorEnabled(false);
  setSaveState('clean');
  els.commitMsg.value = defaultCommitMessage();
  switchView('split');
  bindEvents();
  loadPosts(true);
  refreshGitStatus();
}

init();
