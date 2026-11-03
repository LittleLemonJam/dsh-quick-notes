# 随想随记 · 开发指南

本文对应 **1.0.0**（2026-11-02），面向开发者，说明目录结构、构建产物、检查与测试
命令、如何把插件装进本地 DSH profile，以及调试建议。实现契约以
[`architecture.md`](architecture.md) 为准，用户文档见 [`user-guide.md`](user-guide.md)。

## 1. 环境要求

- **Node.js >= 22.13**（构建脚本、`node --test` 与 jsdom devDependency 都依赖这个版本）。
- **npm**（随 Node.js 安装）用于安装 devDependencies。
- **DeepSeek Harness >= 0.2.0**，用于本地安装和手动验证。

插件本身没有运行时 npm 依赖：

- Client 半身只从 DSH 模块表 `require('react')`，其余代码由 esbuild 打进 `client.js`；
- Host 半身只使用 `node:` 内置模块和本包文件。

## 2. 快速开始

```bash
git clone https://github.com/LittleLemonJam/dsh-quick-notes.git
cd dsh-quick-notes

npm install        # 安装 esbuild / jsdom / prettier / react / react-dom / yaml 等 devDependencies
npm run build      # 由 src/client/index.js 生成 client.js
npm run verify     # 格式检查 + 构建产物检查 + 静态检查 + 单元测试
```

`npm run verify` 是 CI 使用的完整校验命令，提交前请确保通过。

## 3. 目录结构

```text
dsh-quick-notes/
├── index.js                    # Host 入口：inject webServer，注册路由
├── client.js                   # Client 构建产物（提交进仓库，勿手改）
├── cordis.patch.yml            # bundle patch：把插件行插入 profile
├── package.json                # bundle 清单 + dsh.bundle / dsh.client 元数据
├── icon.svg                    # 插件图标
├── market.json                 # DSH 插件市场索引（format 1）
├── locale/
│   ├── en.json                 # 插件管理器展示的英文标题/描述
│   └── zh.json                 # 插件管理器展示的中文标题/描述
├── src/
│   ├── host/
│   │   ├── paths.js            # DSH_HOME / DSH_QUICK_NOTES_DIR 路径解析
│   │   ├── store.js            # 读文件 / 校验 / 原子写
│   │   ├── fence.js            # 同源请求围栏
│   │   ├── diagnostics.js      # 客户端诊断日志（diagnostics.log）
│   │   └── routes.js           # GET/PUT /state、GET /health、POST /diagnostic
│   ├── shared/
│   │   ├── constants.js        # Client / Host 共享常量（schema 版本、上限、路由）
│   │   ├── model.js            # 纯状态模型（无 DOM、无 IO，可单测）
│   │   └── sanitize.js         # 富文本白名单清洗（纯函数，可单测）
│   └── client/
│       ├── index.js            # createPlugin()：注册样式 / locale / 两个 slot
│       ├── app.js              # App 组合根：窗口 + 目录 + 编辑器 + 分隔条
│       ├── store.js            # 便签 store（useSyncExternalStore 兼容）
│       ├── storage.js          # Host 路由 + localStorage 双层持久化
│       ├── diagnostics.js      # 向 Host 上报挂载 / 主题 / 模式 / 同步 / 错误
│       ├── theme.js            # 宿主主题探测 + 插件主题解析（跟随 / 固定）
│       ├── images.js           # 粘贴 / 拖入图片的等比缩放与 data URL 编码
│       ├── i18n.js             # 合并各模块 I18N，注册 quickNotes 命名空间
│       ├── styles.js           # BASE_CSS 与各组件 CSS 汇总
│       ├── dom.js              # h / cx / 下载与选文件等小工具
│       ├── launcher.js         # 侧栏底部入口按钮
│       └── components/
│           ├── window.js       # 窗口外壳：拖动 / 缩放 / 紧凑模式 / 恢复默认大小
│           ├── ball.js         # 最小化圆球（仅图标，无角标）
│           ├── sidebar.js      # 目录：新建 / 重命名 / 置顶 / 拖拽排序 / 删除
│           ├── settings.js     # 设置面板（字号 / 行高 / 主题 / 恢复默认位置 / 导入导出）
│           ├── trash.js        # 回收站面板
│           ├── editor.js       # contentEditable 编辑器（标题重命名 / 横线衬底）
│           ├── context-menu.js # 右键格式菜单
│           ├── format.js       # 粗体 / 斜体 / 下划线 / 剪贴板 / 清除格式 / 插入
│           └── geometry.js     # 纯几何函数（可单测）
├── scripts/
│   ├── build.mjs               # esbuild 打包并包上 ModuleLoader 外壳
│   └── check.mjs               # 清单 / patch / 产物 / 源码静态检查
├── test/unit/*.test.mjs        # Node 内置 node --test
├── docs/                       # 本目录下的文档
├── assets/                     # README 使用的截图（见 assets/README.md）
├── .github/                    # CI、Issue 模板、PR 模板
└── README.md / README.zh.md    # 英文 / 中文主文档
```

## 4. `client.js` 的生成方式

`client.js` 是**构建产物**，由 `scripts/build.mjs` 生成，必须提交进仓库（DSH 安装
bundle 后直接加载它，不会在用户机器上构建）。

构建流程：

1. esbuild 从 `src/client/index.js` 出发，打包成 CommonJS，`platform: browser`，
   `target: chrome120, safari16`；
2. **React 设为 external**，运行时从 DSH 宿主模块表 `require('react')` 取得，绝不打包
   React；
3. `package.json` 的 `version` 通过 `__PLUGIN_VERSION__` 常量注入 bundle；
4. 产物再包上 DSH 要求的加载器外壳：

   ```js
   window.__ModuleLoader__.load({
     id: 'dsh-quick-notes',
     factory(require) {
       // ...esbuild 产物...
       return module.exports.createPlugin()
     },
   })
   ```

5. 构建脚本会检查产物里没有 `require('@deepseek-ai/...')`，防止 Client 半身依赖
   安装目录里的包。

相关命令：

| 命令                   | 作用                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run build`        | 重建 `client.js`                                                      |
| `npm run build:check`  | 只比较：`client.js` 与源码生成结果不一致时失败                        |
| `npm run check`        | 校验 `package.json`、`cordis.patch.yml`、locale、icon、产物和源码规则 |
| `npm run test:unit`    | `node --test "test/unit/*.test.mjs"`                                  |
| `npm test`             | `build:check` + `check` + 单元测试                                    |
| `npm run format`       | Prettier 写入整个仓库                                                 |
| `npm run format:check` | Prettier 只检查                                                       |
| `npm run verify`       | `format:check` + `npm test`（CI 使用）                                |

改了 `src/client/**` 之后一定要重新 `npm run build` 并提交新的 `client.js`，否则
`build:check` 和 CI 会失败。

## 5. 本地安装到 profile

### 5.1 构建

```bash
npm install
npm run build
```

### 5.2 安装到 DSH profile

三种方式任选其一：

**方式 A：命令行 link 安装（推荐开发时使用）**

```bash
dsh plugin --profile desktop add link:/本仓库的绝对路径
```

`link:` 指向仓库目录，改完源码重新 `npm run build` 后重启 DSH（或刷新页面）即可生效，
不需要重新安装。

**方式 B：DSH Desktop / Web 界面**

打开左侧栏 **Plugins（插件）** 页 → **Add plugin（添加插件）**（或箭头 →
**Install a third-party plugin**），把本仓库目录的绝对路径（包含 `package.json`
的文件夹）粘贴到包名输入框并安装。**设置 → 插件** 只是只读清单，不能安装。
安装后通常立即生效；没有出现时重启一次 DSH。

**方式 C：Agent / 自动化**

调用 `plugin_manager` 工具：

- `action` = `install_bundle`
- `target` = 本仓库的绝对路径

安装后可能需要在插件列表里启用「随想随记」。

### 5.3 重启与验证

1. **重启 DSH**：Host 半身（`index.js`、`src/host/**`）只在启动时加载，改完必须重启；
   Client 半身改完刷新页面即可。
2. 打开 `http://127.0.0.1:<DSH 端口>/dsh-quick-notes/health`，应返回：

   ```json
   { "ok": true, "version": "1.0.0", "storage": "file" }
   ```

3. 确认浮窗显示、目录可以新建便签；窗口被隐藏时点侧栏底部的便签图标恢复。
4. 检查数据文件：默认在 `~/.dsh/quick-notes/notes.json`（Windows 为
   `%USERPROFILE%\.dsh\quick-notes\notes.json`）。

### 5.4 用独立目录做隔离测试

不想污染日常便签时，给 DSH 启动进程设置环境变量，再用带该环境变量的方式重启 DSH：

```bash
# macOS / Linux
DSH_QUICK_NOTES_DIR=/tmp/dsh-quick-notes-dev <启动 DSH 的命令>

# Windows PowerShell
$env:DSH_QUICK_NOTES_DIR="C:\temp\dsh-quick-notes-dev"; <启动 DSH 的命令>
```

Host 在启动时读取这个变量，路径支持 `~` 开头；换目录后需要重启 DSH。测试结束可以
直接删掉该目录。

## 6. 调试建议

### Client 半身

- 改 `src/client/**` 后：`npm run build` → 刷新页面。浏览器控制台会显示模块加载或
  渲染错误。
- 样式类名统一 `qn-` 前缀，测试钩子属性统一 `data-qn-*`，方便在 DevTools 里定位元素。
- 检查持久化请求：DevTools → Network，过滤 `dsh-quick-notes`，应能看到
  `GET /dsh-quick-notes/state` 和（输入停止约 500 ms 后的）`PUT /dsh-quick-notes/state`。
- 检查本地镜像：DevTools → Application → Local Storage，键名
  `dsh-quick-notes:state:v1`。
- 如果窗口在刷新后位置异常，检查 `state.ui.rect` 是否越界；加载时几何会被拉回视口。
- 浮窗出现「随想随记渲染失败」说明错误边界拦到了渲染异常：刷新页面复现，错误堆栈会
  由 `diagnostics.js` 上报到 Host 的 `diagnostics.log`。
- 主题：`.qn-root` 上有 `data-qn-theme` / `data-qn-mode` 属性。固定浅色 / 深色时切换
  DSH 主题，`data-qn-theme` 应保持不变；选「跟随系统」时才跟随。`diagnostics.log` 的
  `theme` 条目会记录解析结果（`theme` / `preference` / `hostTheme`）。
- 模式与圆球：`setMode` 会写 `mode` 诊断；圆球挂载会写 `ball.mounted`（坐标摘要放在
  `message` 里）。圆球应出现在窗口右上角，并在其他插件挂件之上。
- 窗口几何：`geometry.js` 的 `clampRect`/`resizeRect` 把窗口限制在视口内，顶部还有一个
  `WINDOW_TOP_INSET = 64` 的安全区（避免压到 DSH 原生标题栏拖拽区）；默认位置是 DSH
  窗口右侧中间。调试按钮时注意 `window.resetSize`（560×440，保留位置、退出 compact）
  与 `settings.resetPosition`（右侧中间，保留尺寸）的区别。
- 图片：`images.js` 的 `readImageFile` 用 canvas 等比缩放（最长边 1024、data URL 预算
  450k、下限 320），只接受 png/jpeg/webp/gif；`sanitize.js` 回读时只保留
  `data:image/(png|jpeg|jpg|webp|gif);base64,` 且 ≤500,000 字符的 `img src`。插入是
  异步的：先 `preventDefault`，解码完成后插入到当时的光标位置；失败 / 超预算静默跳过。
  `test/unit/images.test.mjs` 覆盖缩放纯函数与降级路径。
- 整状态替换（启动时采用较新的 Host 副本、导入 JSON）通过 `contentEpoch` 触发编辑器
  重载 DOM：当前便签 id 不变时内容也会刷新。

### Host 半身

- 改 `index.js` / `src/host/**` / `src/shared/**` 后必须重启 DSH。
- Host 日志会打印数据文件位置（`dsh-quick-notes: state file ...`）；读写失败、文件
  损坏、改名重试等会以警告形式输出，前缀是 `quick-notes:`。
- 无浏览器可观察时（headless / 远程部署），用诊断日志确认客户端确实挂载过：
  `$DSH_HOME/quick-notes/diagnostics.log` 里会有 `mounted` 条目，以及 `theme` /
  `mode` / `ball.mounted` / `sync.start` / `sync.retry` 记录和错误堆栈。日志只记录
  白名单字段，按 256 KiB 截断。
- 启动竞态：Host 路由还没就绪时（插件热重载可能和路由注册赛跑），对账会自动重试
  1 s / 3 s / 8 s（`HOST_RETRY_DELAYS`），每次尝试写 `sync.retry`。若日志里反复出现
  `ok: false`，先确认 `/dsh-quick-notes/health` 是否可达，再排查 Host 半身是否加载。
- `GET /dsh-quick-notes/state` 返回 `{ ok: true, state, corrupt }`；`corrupt: true`
  表示文件存在但读不出来，此时按空状态处理。
- `PUT /dsh-quick-notes/state` 的失败状态码：
  - `400`：请求体不是 JSON 对象、`schemaVersion` 不是 1、字段缺失；
  - `403`：请求围栏拒绝（Host 不在白名单、Origin/Referer 与 Host 不同源、跨站请求）；
  - `413`：请求体超过 8 MiB；
  - `415`：`Content-Type` 不是 `application/json`；
  - `500`：磁盘写入失败。
- `POST /dsh-quick-notes/diagnostic` 只接受 `application/json`、上限 8 KiB；未知
  `kind` 或条目过大返回 `400`，成功返回 `{ ok: true }`。
- 反向代理或远程访问导致 Host 头被改写时，可以用
  `DSH_QUICK_NOTES_ALLOWED_HOSTS` 追加受信主机名（逗号分隔，`*` 关闭主机名检查）。
  这会放宽同源围栏，仅供明确需要远程访问的场景，日常使用不要设置。

### 手动验证清单

改完 UI 或持久化后，按下面的清单过一遍：

1. 新建、重命名、置顶、拖拽排序（含 `Alt` + `↑`/`↓`）、删除、还原、彻底删除、
   清空回收站；
2. 字号 / 行高 / 主题调整（固定浅色后切 DSH 主题，便签不应变化），导入 / 导出；
3. 选区右键：复制 / 剪切 / 粘贴、清除格式；`Ctrl/Cmd` + B / I / U 可用；
4. 双击编辑器标题重命名（`Enter` / `Esc` / 失焦 / 清空保持原名）；横线衬底开关；
5. 粘贴和拖入 PNG / JPEG / WebP / GIF 图片：应等比压缩并适配窗口宽度；外链图片 / SVG
   应被忽略；大图或超预算时后面的图片静默跳过；
6. 标题栏拖动、8 向缩放、最小尺寸、越界后加载恢复；窗口顶部不能进入 64 px 安全区；
7. 标题栏第三个按钮恢复默认大小（560 × 440，保留位置、退出 compact）；设置里的
   「恢复默认位置」把窗口移到右侧中间（保留尺寸、退出 compact）；
8. 紧凑模式进出、缩成圆球（圆球应出现在窗口右上角、只显示图标、无角标，浮在其他
   挂件之上）/ 点击恢复 / 拖动圆球；
9. 侧栏入口隐藏 / 恢复；刷新页面后窗口模式、主题、横线、顺序和内容保持；
10. 把 `DSH_QUICK_NOTES_DIR` 指到不可写路径，确认同步状态变成「失败」，内容仍在
    浏览器里，恢复可写后继续保存；
11. 清空数据文件（或换成空目录）重启，确认 localStorage 兜底会把较新的本地状态推回
    Host；再同时清掉 localStorage 重启，确认空态引导；
12. 刷新页面后确认 `diagnostics.log` 里出现新的 `mounted` 记录（headless 环境可用它
    验证客户端确实挂载）。

### 单元测试

- 框架是 Node 内置 `node --test`，测试文件在 `test/unit/*.test.mjs`；全仓单元测试
  （当前 231 个用例，具体数量以 `npm test` 输出为准）应全部通过。
- 纯逻辑模块（`model.js`、`geometry.js`、`sanitize.js`、`format.js`、`theme.js`、
  `images.js` 的缩放辅助函数、`sidebar.js` 的拖拽辅助函数、Host store 与 fence）优先
  覆盖；DOM 相关用例使用 devDependency `jsdom` + `react-dom`。
- 本次新增/扩展的重点用例：
  - `images.test.mjs`：等比缩放 `fitDimensions`、图片类型过滤、预算降级与 canvas
    不可用时的降级；
  - `theme.test.mjs`：宿主主题探测、`resolvePluginTheme` 与 App 的
    `data-qn-theme` / `data-qn-mode`；
  - `ball.test.mjs`：圆球无角标、位置回退 / clamp、点击恢复与 z-index 提升；
  - `window.test.mjs`：最小化放置、compact 还原与「恢复默认大小」按钮；
  - `window-style.test.mjs`：窗口边框、标题栏分隔线与按钮顺序；
  - `editor.test.mjs`：`contentEpoch` 触发的 DOM 重载、drop 走 HTML 白名单、粘贴图片；
  - `format.test.mjs`：粗体 / 斜体 / 下划线的包裹与取消、剪贴板命令、清除格式、插入
    清洗；
  - `sanitize.test.mjs`：图片 `data:` 白名单、外链 / SVG 拒绝；
  - `sidebar.test.mjs`：拖拽排序辅助函数（阈值、组内索引、FLIP 位移）；
  - `host-diagnostics.test.mjs`：诊断 `kind` 白名单与字段截断。
- 新增行为要补测试，或按 [`architecture.md`](architecture.md) §10 说明不可测原因。

```bash
node --test "test/unit/*.test.mjs"
node --test "test/unit/sanitize.test.mjs"   # 只跑单个文件
```

## 7. 发布流程

以 1.0.0 为例（历史版本记录见 [`CHANGELOG.md`](../CHANGELOG.md)）。

### 7.1 版本与构建

1. 更新 `package.json` 的 `version`（语义化版本），并确认 `repository` / `homepage` /
   `bugs` 指向 `https://github.com/LittleLemonJam/dsh-quick-notes`；
2. 在 `CHANGELOG.md` 里加对应版本条目；
3. `npm run build`，提交更新后的 `client.js`；
4. `npm run verify` 全绿；
5. 更新 `market.json` 的 `versions`（新版本号 + `publishTimestamp`，格式 1 要求该字段）；
6. 打 tag `vX.Y.Z`、创建 GitHub Release（正文参考
   [`release-notes-1.0.0.md`](release-notes-1.0.0.md)），并把 `npm pack` 产出的 `.tgz`
   附到 Release 上；
7. 推送后 GitHub Actions 会在 Node 22 / 24 上各跑一遍 `npm ci && npm run verify`。

### 7.2 三个分发渠道（每个版本都要覆盖）

| 渠道                   | 每个版本要做什么              | 说明                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm**                | `npm publish --access public` | 必须做。DSH 插件页 **Add plugin → Install a third-party plugin** 里填包名 `dsh-quick-notes` 就是装它，也是插件市场一键安装的来源                                                                                                  |
| **awesome-dsh-plugin** | 通常**无需操作**              | 条目 `data/plugins/LittleLemonJam__dsh-quick-notes.yml` 不锁版本；仓库每天探测 npm 最新版本并重建索引 `https://awesome-dsh-plugin.com/index.json`（DSH「发现」页可添加的索引源）。只在改描述 / 分类 / 图标，或条目被移除时才提 PR |
| **dsh-plugin.org**     | 通常**无需操作**              | 收录后按 `dsh-plugin` topic 定期刷新版本与 README；首次收录走 GitHub Issue（模板见 <https://dsh-plugin.org/zh/submit>）。只在条目信息需要修正时才重新提 Issue                                                                     |

发布后自查三项：`npm view dsh-quick-notes version` 已是新版本；GitHub Release
附件可下载；awesome 索引里能搜到新版本（索引每日重建）；dsh-plugin.org 的插件页版本
号已刷新。

> npm 发布凭据：账号未启用 2FA 时，需要在 npm 网站生成带 **Bypass two-factor
> authentication** 的 Granular Access Token，并用
> `npm publish --access public --//registry.npmjs.org/:_authToken=<token>` 发布；不带
> 该开关的 token 会被 registry 以 403 拒绝。发布完成后立即 `npm token revoke` 撤销。

## 8. 相关文档

- [`architecture.md`](architecture.md) —— 唯一实现契约
- [`storage.md`](storage.md) —— 数据文件、路由、备份与恢复
- [`user-guide.md`](user-guide.md) —— 用户操作手册
- [`faq.md`](faq.md) —— 常见问题
- [`release-notes-1.0.0.md`](release-notes-1.0.0.md) —— 1.0.0 发布文案与清单
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) —— 贡献指南
- [`../SECURITY.md`](../SECURITY.md) —— 安全策略
