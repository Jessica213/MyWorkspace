# 成长工作台 · 云端版 — 部署与使用说明

## 简介

在原「成长工作台」单文件 PWA 基础上，新增了 **Supabase 云端持久化 + 跨设备同步** 能力。
UI、功能、数据结构、PWA 能力全部保留，仅在数据层做了最小侵入式改造。

核心特性：
- 离线优先：localStorage 始终是数据源，断网照常使用
- 自动同步：联网后自动把本地改动推到云端，同时拉取其他设备的更新
- 用户登录：邮箱+密码，同一账号手机电脑共享同一份数据
- 智能迁移：首次登录自动判断上传/下载/合并，合并时按 id 合并不丢数据
- PWA 离线缓存：Service Worker 缓存核心资源，无网络也能打开

---

## 文件清单

| 文件 | 说明 |
|---|---|
| `index.html` | 主应用（已内联同步引擎，直接部署即可） |
| `config.js` | 连接配置（可选预置，也可在应用内填写） |
| `supabase_schema.sql` | Supabase 建表 + 安全策略 + 实时推送 |
| `sw.js` | Service Worker（PWA 离线缓存） |
| `manifest.webmanifest` | PWA 清单（添加到主屏幕） |
| `icon.svg` | 应用图标 |
| `sync.js` | 同步引擎源码（已内联进 index.html，留作参考） |
| `index_orig.html` | 原始未改造版备份（可对照回归） |

---

## 第一步：创建 Supabase 项目

1. 打开 https://app.supabase.com/ ，用 GitHub 或邮箱登录
2. 点击 **New Project**
3. 填写：
   - **Name**：随便起，比如 `growth-workbench`
   - **Database Password**：设置一个强密码（记下来，后面可能用到）
   - **Region**：选离你近的，比如 `Southeast Asia (Singapore)` 或 `West US`
   - **Pricing Plan**：选 Free 免费版
4. 点击 **Create new project**，等待约 1-2 分钟初始化完成

---

## 第二步：执行建表 SQL

1. 左侧菜单 → **SQL Editor**
2. 点击 **New query**
3. 把 `supabase_schema.sql` 文件里的全部内容复制粘贴进去
4. 点击 **Run**（右下角绿色按钮）
5. 看到 "Success. No rows returned" 就表示建表成功

这个 SQL 做了三件事：
- 创建 `sync_items` 表（存各业务键的数据）和 `sync_backups` 表（手动备份）
- 启用 **行级安全（RLS）**：每个用户只能读写自己的数据
- 启用 **Realtime 实时推送**：数据变化时主动通知其他设备

---

## 第三步：获取连接信息

1. 左侧菜单 → **Project Settings**（最底部齿轮图标）→ **API**
2. 复制两个值：
   - **Project URL**：形如 `https://xxxxxxxx.supabase.co`
   - **anon public** key：形如 `eyJhbGciOi...`（很长的一串）

> ⚠️ 注意：用的是 **anon public** key，不是 service_role key。
> anon key 是公开的、可以放在前端的，配合 RLS 保证安全。

### 配置方式（二选一）

**方式 A：部署前预置（推荐）**
- 打开 `config.js`
- 把 `supabaseUrl` 和 `anonKey` 填进去
- 保存后再部署，用户打开就自动连上，不用再填

**方式 B：部署后在应用内填写**
- 直接部署空的 `config.js`
- 用户打开应用后，点右上角「云同步」→「连接 Supabase」
- 填入 URL 和 Key → 保存
- 配置会存在浏览器本地，换设备需要重新填（或用方式 A 预置）

---

## 第四步：部署（必须 HTTPS）

PWA 和 Service Worker 要求 HTTPS 环境（localhost 除外）。
以下任选一种免费方案：

### 方案 1：GitHub Pages（最简单）
1. 在 GitHub 新建一个仓库（Public 或 Private 都行）
2. 把整个文件夹的文件上传到仓库根目录
3. 仓库 Settings → Pages → Build and deployment → Source 选 **Deploy from a branch**
4. Branch 选 `main` / `root` → Save
5. 等 1-2 分钟，会得到一个 `https://你的用户名.github.io/仓库名/` 的地址

### 方案 2：Vercel（推荐，速度快）
1. 注册 https://vercel.com/ （可用 GitHub 登录）
2. 点击 **Add New → Project** → 导入你的 GitHub 仓库
3. Framework Preset 选 **Other**，其他默认
4. 点击 **Deploy**，几十秒就好，会给你一个 `xxx.vercel.app` 的地址

### 方案 3：Netlify / Cloudflare Pages
操作类似，拖拽文件夹即可部署，都有免费额度。

### 方案 4：仍用 workbuddy 原地址
如果你想继续用原来的 `agentos-app.net` 地址，把改造后的文件替换掉原来的即可。

> 💡 部署完成后，用浏览器打开地址，确认能正常加载、功能正常。

---

## 第五步：添加到主屏幕（PWA）

### 手机端（Edge / Safari / Chrome）
1. 用浏览器打开部署后的 URL
2. **Edge**：底部菜单 → 添加到手机 / 添加到主屏幕
3. **Safari**：分享按钮 → 添加到主屏幕
4. **Chrome**：右上角菜单 → 添加到主屏幕
5. 桌面会出现「Free」图标，点击就是全屏 App 体验

### 电脑端（Edge / Chrome）
1. 打开 URL
2. 地址栏右侧会出现「安装应用」图标（一个方框加向下箭头）
3. 点击安装，会出现在开始菜单/启动台

---

## 第六步：跨设备使用流程

### 手机端（第一次）
1. 打开 App → 右上角「云同步」
2. 点「登录 / 注册」→ 选「注册」→ 填邮箱密码 → 注册
3. 首次登录会自动检测：
   - 如果你手机上已经有真实数据 → 自动上传到云端
   - 如果是全新安装 → 云端空的，直接用本机数据
4. 看到「云同步」按钮变绿点 → 同步成功

### 电脑端（第二次）
1. 打开同一个 URL → 右上角「云同步」→ 登录同一账号
2. 首次登录自动检测到云端有数据 → 自动从云端恢复
3. 恢复完成后，电脑上就有手机的全部数据了

### 之后
- 任意一端增删改，另一端几秒内自动同步
- 断网时照常使用，联网后自动补同步

---

## 迁移模式说明

首次登录时，如果云端和本机都检测到真实数据，会弹出「数据合并」选择：

| 模式 | 说明 | 适用场景 |
|---|---|---|
| **上传本机** | 把本机数据全部推到云端，覆盖云端 | 手机是主设备，电脑刚装，想以手机为准 |
| **从云端下载** | 用云端数据覆盖本机 | 换了新手机，想从云端恢复 |
| **智能合并**（推荐） | 列表型数据按 id 合并、记录型按键合并，两端都保留 | 两边都用过、都有数据，不想丢任何一边 |

> 💡 合并后建议去各 Tab 检查一下，确认数据完整。
> 也可以在「云同步」→「手动备份」里先备份一份，再合并。

---

## 离线使用说明

- **完全离线可用**：所有数据存在本地 localStorage，断网照常增删改查
- **状态指示**：右上角云同步按钮的小圆点
  - 🟢 绿色：已同步
  - 🟡 黄色闪烁：同步中
  - 🔴 红色：同步失败（点进去看详情）
  - 🟠 橙色：离线模式（待同步 N 项）
- **恢复联网**：自动检测上线，自动把离线期间的改动推到云端

---

## 常见问题

**Q：数据安全吗？别人能看到我的数据吗？**
A：安全。Supabase 启用了行级安全（RLS），每个用户只能读写自己的数据。anon key 是公开的，但配合 RLS 不会越权。

**Q：换了邮箱/忘记密码怎么办？**
A：Supabase 自带重置密码功能。在登录页点「忘记密码」（后续版本可加），或在 Supabase 后台 Authentication → Users 里管理。

**Q：免费版够用吗？**
A：完全够用。Supabase 免费版有 500MB 数据库空间、每月 5GB 带宽。你的数据都是文本，几百条任务也才几十 KB。

**Q：可以导出数据备份吗？**
A：可以。右上角「导出」按钮可以导出全部数据为 JSON 文件。云同步里也有「手动备份」功能，会存到云端 `sync_backups` 表。

**Q：同步不生效怎么办？**
A：点右上角「云同步」→「立即同步」手动触发。如果还不行，检查：① 网络是否正常 ② URL 和 Key 是否填对 ③ Supabase 后台 Database → Realtime 是否启用了 `sync_items` 表。

**Q：可以换数据库吗？**
A：当前版本绑定 Supabase。如果以后想换后端，需要改 `sync.js` 里的 API 调用部分。

---

## 技术细节（可选阅读）

- 同步键：13 个业务键（tasks / habits / habitRecords / studySubject / media / happy / countdown / wisdomIndex / currentGrowth / currentStudy / studyRecords / dailyPointers / initialized）
- 同步策略：本地优先 + 防抖推送（1.2s）+ 实时拉取 + 30秒轮询兜底
- 冲突策略：按键「最后提交者获胜」，本地未推送的编辑优先（不丢数据）
- 每日智慧锦囊的日期标记（wisdomDate）不同步，仅本地（每天各设备自己更新）
