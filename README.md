# 前端开发-[姜斌]

需要注意仓库公开（Public）

https://docs.github.com/cn/pages/quickstart

https://jekyllrb.com/docs/installation/windows/

https://rubyinstaller.org/downloads/

## Markdown 可视化编辑器

本仓库附带一个**本机运行**的 Markdown 文章编辑器，用于可视化编写 `docs/_posts/` 下的 Jekyll 文章，并一键提交推送到 GitHub。编辑器位于仓库根目录的 `editor/`，**不会**被 GitHub Pages 发布；全程只用 Node.js 内置模块，无需 `npm install`、无需构建、不联网加载任何 CDN 脚本。

启动方式：

```bash
cd editor
npm start
```

Windows 用户也可以直接双击 `editor/start.bat`。启动后访问 <http://127.0.0.1:5173/>（默认会尝试自动打开浏览器），按 `Ctrl + C` 停止。

功能：文章列表与搜索、front matter 与正文分离编辑、三栏实时预览、格式工具栏与快捷键、1.5 秒防抖自动保存、图片粘贴拖拽上传、Git 状态查看与「一键提交并推送」。

详细说明（端口修改、GitHub 认证、`GIT_DRY_RUN=1` 调试、常见问题等）见 [editor/README.md](editor/README.md)。
