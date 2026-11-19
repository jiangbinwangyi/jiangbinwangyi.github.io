# Jekyll Markdown 可视化编辑器

一个**只在本机运行**的 Markdown 文章编辑器，用于可视化编写 `docs/_posts/` 下的 Jekyll 博客文章，并一键 `git commit` + `git push` 到 GitHub。

- **零运行时依赖**：只用 Node.js 内置模块，不需要 `npm install`。
- **零构建**：前端是原生 HTML / CSS / ES6，`<script>` 直接引入。
- **不联网**：Markdown 渲染器已内置在 `public/vendor/markdown-lite.js`，不会从 CDN 加载任何脚本。
- **不会被发布**：编辑器放在仓库根目录的 `editor/`，GitHub Pages 只发布 `docs/`，因此 `editor/` 不会出现在公网站点上。

---

## 一、启动

需要 Node.js 18 或更高版本（本项目已在 Node v22 上验证）。

```bash
cd editor
npm start
```

或者直接：

```bash
node editor/server.js
```

Windows 用户可以**双击 `editor/start.bat`**；macOS / Linux 用户可执行 `bash editor/start.sh`。

启动后控制台会打印：

```
访问地址 : http://127.0.0.1:5173/
```

服务会尝试自动打开默认浏览器；若没有自动打开，请手动访问 <http://127.0.0.1:5173/>。按 `Ctrl + C` 停止服务。若不想自动弹出浏览器（例如无头或远程环境），可设置环境变量 `EDITOR_NO_BROWSER=1`。

> 服务**只监听 127.0.0.1**，局域网内其他设备无法访问，仅供本机使用。

### 修改端口

```bash
# Windows（Git Bash / CMD）
set PORT=8080 && node editor/server.js

# macOS / Linux
PORT=8080 node editor/server.js
```

在 `start.bat` 里也可以在 `node server.js` 之前加一行 `set PORT=8080`。

---

## 二、目录说明

```
editor/
├── server.js                     本地 HTTP 服务 + 全部 API（仅 Node 内置模块）
├── public/
│   ├── index.html                页面结构（三栏布局）
│   ├── app.js                    前端交互逻辑
│   ├── style.css                 浅色主题样式
│   └── vendor/
│       └── markdown-lite.js      内置轻量 Markdown 渲染器（含 XSS 清理）
├── .trash/                       删除文章前的备份（自动创建，已 gitignore）
├── .gitignore                    忽略 .trash/ 与 node_modules/
├── package.json                  仅声明 start 脚本，无 dependencies
├── start.bat                     Windows 双击启动
├── start.sh                      macOS / Linux 启动
└── README.md                     本说明
```

编辑器读写的文件：

| 用途 | 路径 |
| --- | --- |
| 文章 | `docs/_posts/*.markdown` / `*.md` |
| 图片 | `docs/assets/images/`（粘贴或拖拽图片时自动创建） |
| 删除备份 | `editor/.trash/` |

> **重要**：不要把这个目录移动到 `docs/` 下面。Jekyll 会把 `docs/` 下非下划线开头的文件原样复制进 `_site` 并发布到公网。

---

## 三、功能说明

### 文章管理

- 左侧列表扫描 `docs/_posts/` 下的 `.md` / `.markdown`，解析 YAML front matter 得到标题、日期、分类，按日期**倒序**展示；顶部搜索框可按文件名 / 标题 / 分类 / 日期过滤。
- 「＋ 新建文章」：输入标题后自动生成 `YYYY-MM-DD-标题.markdown`，并写入规范 front matter：

  ```yaml
  ---
  layout: post
  title: "你的标题"
  date: 2022-07-06 17:10:11 +0800
  categories: markdown
  ---
  ```

  同名文件已存在时会自动追加 `-2`、`-3` 等后缀，**绝不静默覆盖**。
- **front matter 与正文分离编辑**：顶部表单只编辑「标题 / 日期 / 分类」，中间大文本框只编辑正文。保存时服务端重新读取磁盘上的原始 front matter 行，只替换这三个字段的值，`layout` 以及任何你自定义的字段（如 `tags`、`author`、`permalink`）都会**原样保留**，原有的换行风格（CRLF / LF）和缩进空格也会保留。
- 日期字段使用纯文本框而非日期选择器，以完整保留 `YYYY-MM-DD HH:mm:ss +0800` 这种 Jekyll 常用格式（不会丢失秒数和时区偏移）。
- **修改标题不会自动重命名文件名**，界面上也有提示。这是刻意设计：Jekyll 的文章 URL 由文件名决定，改文件名会导致已有链接失效。如需改名请手动重命名文件。
- 「删除」需要**两次确认**，删除前服务端会先把原文件复制到 `editor/.trash/时间戳-原文件名`，可随时手动恢复。

### 编辑与预览

- 三栏布局：左「文章列表」/ 中「编辑区」/ 右「实时预览」。窗口宽度小于 1000px 时自动上下堆叠。
- 工具栏：H1 / H2 / H3、加粗、斜体、删除线、引用、无序列表、有序列表、链接、图片、代码块、表格、水平分割线。选中文本时包裹，未选中时插入占位语法并把光标定位到需要填写的位置。
- 快捷键：

  | 快捷键 | 功能 |
  | --- | --- |
  | `Ctrl / Cmd + S` | 立即保存 |
  | `Ctrl / Cmd + B` | 加粗 |
  | `Ctrl / Cmd + I` | 斜体 |
  | `Ctrl / Cmd + K` | 插入链接 |
  | `Tab` | 缩进（选中多行时逐行缩进） |

- 视图切换：「分栏 / 仅编辑 / 仅预览」；编辑区与预览区按滚动百分比双向同步。
- 预览渲染器覆盖标题、粗体/斜体/删除线、行内代码、围栏代码块、引用、有序/无序列表（含嵌套）、链接、图片、表格、分割线。所有用户输入先做 HTML 转义，URL 过滤掉 `javascript:` / `data:`，输出后再剥离 `<script>`、`on*` 属性等，避免预览自己写的 Markdown 时触发脚本。渲染器**不支持内嵌原始 HTML**（会显示为纯文本），这是安全取舍。

### 自动保存

- 编辑正文或修改任意元信息后，防抖 **1.5 秒**自动调用保存接口，无需手动点保存。
- 顶部状态标签实时显示：`● 就绪` / `● 未保存` / `⟳ 保存中…` / `✓ 已保存 HH:mm:ss` / `✕ 保存失败`（hover 可看失败原因）。
- 切换文章时会询问是否先保存；关闭 / 刷新页面时浏览器会提示「有未保存的修改」，同时用 `fetch(keepalive)` 尽力再保存一次。
- 保存期间若你继续输入，编辑器不会错误地标成「已保存」，会自动再排一次保存。
- 另有「立即保存」按钮（`Ctrl + S`）。

### 图片插入

- 工具栏「图片」按钮会插入 `![图片描述](/assets/images/)` 语法占位。
- 更方便的做法：**直接把图片粘贴或拖拽到编辑区**。编辑器会自动把图片保存到 `docs/assets/images/img-xxx.png`，并在光标处插入 `![文件名](/assets/images/img-xxx.png)`。
- 支持 PNG / JPEG / GIF / WebP / BMP，单张上限 15MB；出于安全考虑不接受 SVG。

---

## 四、一键提交并推送

顶部 Git 面板会显示：当前分支名、remote 名称与 URL、`git status --short` 的变更列表与数量（点「刷新状态」可重新读取）。

操作步骤：

1. 写文章（自动保存已完成）。
2. 在「提交信息」输入框填写内容，留空则自动生成 `docs: 更新文章 YYYY-MM-DD HH:mm`。
3. 点击「🚀 一键提交并推送」。

服务端会依次执行：

```
git add -A
git commit -m "<提交信息>"
git push origin <当前分支>
```

每一步的命令、退出码、stdout / stderr 都会显示在下方「推送执行日志」里，成功或失败都有明确提示。整个过程有 120 秒总超时。

边界行为：

- 工作区没有变更时，`git commit` 会报 `nothing to commit`，这**不算整体失败**，仍会继续尝试 `git push`（把已有的本地提交同步上去）。
- `git add` 失败才会直接中止。
- 推送失败会给出可读建议，例如：
  - 认证失败 → 检查 Personal Access Token / Git Credential Manager；
  - 非快进（`non-fast-forward`）→ 先执行 `git pull --rebase` 再推送；
  - 网络 / DNS / 超时 → 检查网络或 Git 代理设置；
  - SSH `Permission denied (publickey)` → 配置 SSH key 或改用 HTTPS remote。

> 注意：`git add -A` 会把**整个仓库**的变更一起提交（包括 `editor/` 自身的改动），这是预期行为，因为编辑器代码也在这个仓库里。如果只想提交文章，请手动使用 Git 命令。

### GitHub 认证说明

本工具不存储、也不处理任何账号密码，只是调用你本机已配置好的 `git`：

- HTTPS remote（如本仓库）：首次推送时 Windows 的 **Git Credential Manager** 会弹出登录窗口；若使用密码推送被 GitHub 拒绝（GitHub 已停用密码认证），请改用 **Personal Access Token (PAT)** 作为密码，或在凭据管理器里更新已保存的凭据。
- SSH remote：需要本机已配置好 SSH key 并添加到 GitHub 账户。

如果推送时长时间卡住或报认证错误，建议先在终端手动执行一次 `git push origin gh-pages`，把凭据问题在 Git 层面解决后再回到编辑器点按钮。

---

## 五、DRY-RUN 调试模式

设置环境变量 `GIT_DRY_RUN=1` 后，所有 **git 写命令**（`add` / `commit` / `push`）只打印「将要执行什么」，**不会真正执行**，也不会产生任何真实提交或推送；只读命令（`rev-parse` / `remote` / `status`）仍然真实执行，界面上会显示 `DRY-RUN` 标记。

```bash
# Windows（Git Bash）
GIT_DRY_RUN=1 node editor/server.js

# Windows CMD
set GIT_DRY_RUN=1 && node editor/server.js

# macOS / Linux
GIT_DRY_RUN=1 node editor/server.js
```

这个模式用于端到端验证按钮流程、日志展示和错误处理，不影响仓库状态。

---

## 六、常见问题

**Q：启动后浏览器没自动打开？**
手动访问 <http://127.0.0.1:5173/>。某些精简版 Windows 或远程桌面环境不允许 `start` 命令打开浏览器，属正常现象，服务本身不受影响。

**Q：端口被占用？**
用 `PORT=8080 npm start` 换一个端口，或先关掉占用 5173 的程序。

**Q：中文文件名能正常读写吗？**
可以。前端用 `encodeURIComponent` 编码文件名，服务端用 `decodeURIComponent` 解码，所有文件读写统一 UTF-8。Git 状态也加了 `-c core.quotepath=false`，中文文件名不会被转义成八进制。

**Q：Jekyll 文章命名规范是什么？**
必须是 `YYYY-MM-DD-标题.markdown`（或 `.md`），例如 `2022-07-06-需求文档.markdown`。日期前缀决定了文章 URL 和发布时间，不要随意改动。文件开头必须有一段用 `---` 包裹的 YAML front matter，至少包含 `layout: post`、`title`、`date`。

**Q：我自定义的 front matter 字段会丢吗？**
不会。服务端按「行」合并，只替换 `title` / `date` / `categories` 三行，其它行原样写回。但如果你的 front matter 里用了复杂的多行 YAML 块且恰好把这三个键写进块里，建议手动检查一下保存结果。

**Q：预览里写的 HTML 标签不生效？**
渲染器出于安全考虑会把原始 HTML 转义成纯文本。请改用 Markdown 语法。

**Q：删除的文章还能找回吗？**
能，在 `editor/.trash/` 下按时间戳命名的备份文件，复制回 `docs/_posts/` 并去掉时间戳前缀即可。

**Q：为什么图片路径是 `/assets/images/xxx.png`？**
因为 GitHub Pages 从 `docs/` 目录发布，`docs/assets/images/` 对应站点根路径 `/assets/images/`。这样在项目页和个人主页两种部署方式下都能正确显示。

---

## 七、API 一览（供二次开发）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/posts` | 文章列表 `[{ filename, title, date, categories, mtime }]` |
| `GET` | `/api/posts/:filename` | `{ filename, meta, body }` |
| `POST` | `/api/posts` | `{ filename?, title, date, categories, body, isNew }` |
| `DELETE` | `/api/posts/:filename` | 备份到 `.trash/` 后删除 |
| `POST` | `/api/images` | `{ dataUrl }` → 保存图片并返回站内 URL |
| `GET` | `/api/git/status` | `{ branch, remote, remoteUrl, changes, dryRun }` |
| `POST` | `/api/git/push` | `{ message }` → `{ steps, ok, ... }` |

所有响应统一为 JSON 且带 `ok` 字段；错误时返回 `{ ok: false, error: "..." }` 与相应 HTTP 状态码。文件名参数会做纯文件名校验 + 绝对路径前缀校验，静态资源同样防目录穿越。
