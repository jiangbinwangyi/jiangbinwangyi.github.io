---
layout: post
title:  "Yarn Workspaces"
date:   2022-08-31 14:17:11 +0800
categories: vue
---

### 需求

如果多个项目使用多个相同的依赖包，无法同时维护，管理起来十分繁琐。所以采用了Menorepo的做法，即把所有的包放在一个仓库中管理。可统一构建，跨package调试、依赖管理、版本发布都十分方便，搭配工具还能统一生成CHANGELOG；

### 解决方案：Yarn Workspaces

package.json文件添加两行

```javascript
{
  "private": true,
  "workspaces": [
    "packages/*"
  ]
}
```

目录结构

-node_modules
-packages
  --applicationA
    ---src
    ---packages.json
    ---README.md
  --applicationB
  --...
-package.json
-README.md
-yarn.lock


[官方介绍](https://classic.yarnpkg.com/en/docs/workspaces)

### Lerna

仅将项目分离到各自文件夹是不够的，Jest、build等配置项很快会变得复杂，需要进一步引入Lerna解决这些问题

> [Lerna官方介绍](https://classic.yarnpkg.com/blog/2017/08/02/introducing-workspaces/)


