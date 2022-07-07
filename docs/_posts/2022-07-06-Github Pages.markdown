---
layout: post
title:  "Github Pages"
date:   2022-07-06 17:10:11 +0800
categories: github
---

### 创建项目

**需要注意仓库公开（Public）**

> [url](https://docs.github.com/cn/pages/quickstart)


### 安装jekyllrb

配置更丰富的主题，配置自定义样式

> [url](https://jekyllrb.com/docs/installation/windows/)


### 下载Ruby+Devkit 环境

用于在本地运行调试

> [url](https://rubyinstaller.org/downloads/)


### 最终目录结构
- _posts (文章目录)
  - 2022-07-06-XXX.markdown (文章页，使用md格式编写，注意：标题日期要和文章内date对应)
- _site (自动生成的站点目录，可忽略)
- _config.yml (重要的配置文件，包括网站标题、个人信息、主题等。注意：修改后重启服务才能生效)
- .gitignore
- 404.html
- about.markdown (自动生成单页面，可在同级添加其他页面，导航中自动生成。如果有同名.md文件可以删除)
- Gemfile (重要的项目依赖包，如果新加主题记得要先安装主题依赖)
- Gemfile.lock
- index.markdown (入口页)


