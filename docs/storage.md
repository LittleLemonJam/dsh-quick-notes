# 随想随记 · 数据与持久化

本文对应 **1.0.0**（2026-11-02），说明便签数据存在哪里、以什么格式保存、Host 路由
契约、localStorage 兜底、并发行为，以及备份 / 恢复 / 迁移的做法。实现契约见
[`architecture.md`](architecture.md)，面向用户的操作见 [`user-guide.md`](user-guide.md)。

## 1. 总览

插件用两层持久化：

```text
┌──────────────────────────── 浏览器（Client 半身） ────────────────────────────┐
│  内存 state ──立即写──▶ localStorage["dsh-quick-notes:state:v1"]（兜底镜像）    │
│        │                                                                      │
│        └──500ms 防抖──▶ PUT /dsh-quick-notes/state ──▶ Host 写文件             │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Host 文件是共享的事实来源**：同一台机器上，任何端口、任何浏览器打开的 DSH 页面
  读到的都是同一份 `notes.json`。
- **localStorage 只是兜底镜像**：Host 路由不可用时插件照常工作；路由恢复后的下一次
  保存（或下次启动时的 `savedAt` 比较）会把较新的本地状态推回 Host。
- **诊断日志是旁路信息**：客户端挂载、主题 / 模式切换、圆球位置、同步对账与渲染错误
  写到 `diagnostics.log`，仅用于排查问题，不参与便签数据恢复。
- 浏览器只访问同源的 Host 路由，不访问外网。

## 2. 数据文件位置

### 2.1 默认路径

```text
$DSH_HOME/quick-notes/notes.json
```

`DSH_HOME` 未设置时默认是 `~/.dsh`：

| 平台          | 默认路径                                    |
| ------------- | ------------------------------------------- |
| Windows       | `%USERPROFILE%\.dsh\quick-notes\notes.json` |
| macOS / Linux | `~/.dsh/quick-notes/notes.json`             |

### 2.2 自定义目录

设置环境变量 `DSH_QUICK_NOTES_DIR` 可以整体替换数据目录（Host 进程启动时读取）：

```bash
# macOS / Linux
DSH_QUICK_NOTES_DIR=/path/to/notes <启动 DSH 的命令>

# Windows PowerShell
$env:DSH_QUICK_NOTES_DIR="D:\notes"; <启动 DSH 的命令>
```

规则（`src/host/paths.js`）：

- 值支持 `~`、`~/`、`~\` 开头的路径展开；
- 非空时优先于 `<DSH_HOME>/quick-notes`；
- 目录在第一次保存时自动递归创建。

### 2.3 目录里的文件

| 文件                   | 说明                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `notes.json`           | 正式状态文件                                                                        |
| `notes.json.tmp`       | 写入过程中的临时文件，正常完成后会被 rename 掉                                      |
| `notes.json.tmp.stale` | 极端情况下（rename 反复失败后降级为直接写）留下的清理残留，可安全删除               |
| `diagnostics.log`      | 客户端诊断日志（JSON Lines，挂载 / 主题 / 模式 / 圆球 / 同步 / 错误），256 KiB 截断 |

## 3. 文件格式

`notes.json` 是一个 JSON 对象，带一层信封：

```json
{
  "ok": true,
  "state": {
    "schemaVersion": 1,
    "savedAt": 1793500000000,
    "notes": [],
    "trash": [],
    "activeId": null,
    "settings": { "fontSize": 15, "lineHeight": 1.75, "ruledLines": false, "theme": "system" },
    "ui": {
      "mode": "normal",
      "rect": { "x": 96, "y": 96, "width": 560, "height": 440 },
      "compactRect": null,
      "sidebarWidth": 176,
      "ball": { "x": 1184, "y": 680 }
    }
  }
}
```

文件末尾带一个换行。Host 写入时总是带 `ok: true` 信封；读取时只要求 `state` 是
合法的 persisted state（`ok` 字段会被忽略，方便手工修复文件），没有 `state` 的
文件视为损坏。

### 3.1 字段说明

| 字段                  | 类型                                  | 说明                                        |
| --------------------- | ------------------------------------- | ------------------------------------------- |
| `schemaVersion`       | `1`                                   | 当前唯一支持的 schema 版本                  |
| `savedAt`             | number                                | 客户端写入时间（epoch ms），Host 只存不解释 |
| `notes`               | `Note[]`                              | 目录中的便签，最多 500 条                   |
| `trash`               | `TrashedNote[]`                       | 回收站，最多 100 条，超出时从最旧丢弃       |
| `activeId`            | `string \| null`                      | 当前选中的便签 id                           |
| `settings.fontSize`   | number                                | 字号 13–20，默认 15                         |
| `settings.lineHeight` | number                                | 行高 1.4–2.0，默认 1.75                     |
| `settings.ruledLines` | boolean                               | 正文横线衬底开关，默认 false                |
| `settings.theme`      | `system \| light \| dark`             | 主题偏好，默认 system（跟随 DSH）           |
| `ui.mode`             | `normal \| compact \| ball \| hidden` | 窗口模式                                    |
| `ui.rect`             | `{x,y,width,height}`                  | 当前窗口矩形（compact 时是紧凑后的矩形）    |
| `ui.compactRect`      | `Rect \| null`                        | 进入紧凑模式前的正常窗口矩形，用于还原      |
| `ui.sidebarWidth`     | number                                | 目录宽度 120–320，默认 176                  |
| `ui.ball`             | `{x,y}`                               | 最小化圆球位置                              |

`Note` 字段：

| 字段                      | 类型    | 说明                                                 |
| ------------------------- | ------- | ---------------------------------------------------- |
| `id`                      | string  | `n_<base36 时间戳>_<base36 随机串>`                  |
| `title`                   | string  | 1–80 字符；空标题由调用方补默认文案                  |
| `html`                    | string  | 富文本 HTML，最多 600,000 字符，持久化前经白名单清洗 |
| `pinned`                  | boolean | 是否置顶                                             |
| `createdAt` / `updatedAt` | number  | epoch ms                                             |

`TrashedNote` 在 `Note` 基础上多一个 `deletedAt`（删除时间，epoch ms）。

### 3.2 大小与数量上限

| 限制                                 | 值             | 位置                      |
| ------------------------------------ | -------------- | ------------------------- |
| 便签数量 `MAX_NOTES`                 | 500            | `src/shared/constants.js` |
| 回收站数量 `MAX_TRASH`               | 100            | `src/shared/constants.js` |
| 单条便签 HTML `MAX_NOTE_HTML_LENGTH` | 600,000 字符   | `src/shared/constants.js` |
| 标题长度 `MAX_TITLE_LENGTH`          | 80 字符        | `src/shared/constants.js` |
| PUT 请求体 `MAX_REQUEST_BYTES`       | 8 MiB          | `src/shared/constants.js` |
| 诊断请求体 `MAX_DIAGNOSTIC_BYTES`    | 8 KiB          | `src/shared/constants.js` |
| 单张内嵌图片 `MAX_IMAGE_SRC_LENGTH`  | 500,000 字符   | `src/shared/sanitize.js`  |
| 诊断日志上限                         | 256 KiB        | `src/host/diagnostics.js` |
| Host 接受的文件大小                  | 8 MiB + 64 KiB | `src/host/store.js`       |

超过上限的写入会被拒绝，当前数据保持不变。

图片以 `data:image/(png|jpeg|jpg|webp|gif);base64,...` 形式内嵌在 `note.html` 中，
**没有独立附件文件**：`<img>` 只保留 `src`，外链地址、SVG、事件属性和其他属性都会被
清洗掉。客户端插入图片前还会把最长边缩到 ≤1024 px，并尽量把单张 data URL 控制在
450,000 字符以内；粘贴/拖入的多张图片累计超过单条便签 600,000 字符上限时，后面的图片会被
跳过。其他入口（粘贴 `text/html` 富文本、导入 JSON）不做图片级跳过，超过 600,000 字符的
HTML 会在写入时按上限截断，因此带多张图片的超大内容可能丢掉尾部。带图片的便签也会明显
增大状态文件，并计入一次保存请求的 8 MiB 上限。

## 4. Host HTTP 契约

路由命名空间是 `/dsh-quick-notes`，三条路径（四个方法端点）都注册在 DSH 的 Web 服务上
（`ctx.webServer.register({ kind: 'exact', path, handler })`）。

### 4.1 路由一览

| 方法   | 路径                          | 说明                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| `GET`  | `/dsh-quick-notes/state`      | 读取状态，返回 `{ ok: true, state, corrupt }`                 |
| `PUT`  | `/dsh-quick-notes/state`      | 整体替换状态，成功返回 `{ ok: true, savedAt }`                |
| `GET`  | `/dsh-quick-notes/health`     | 健康检查，返回 `{ ok: true, version, storage: 'file', path }` |
| `POST` | `/dsh-quick-notes/diagnostic` | 追加一条客户端诊断日志（write-only），成功返回 `{ ok: true }` |

### 4.2 GET /dsh-quick-notes/state

成功（文件不存在或合法）：

```json
{ "ok": true, "state": { "schemaVersion": 1, "...": "..." }, "corrupt": false }
```

- `state` 为 `null` 表示文件不存在；
- `corrupt: true` 表示文件存在但读不出来（JSON 损坏、结构非法、超过大小上限），此时
  `state` 也是 `null`；
- 文件读取失败（权限、IO 错误）按空状态处理并继续：返回 `200` + `state: null`
  （必要时 `corrupt: true`），客户端会用本地镜像重建；只有 handler 自身抛出
  意外异常时才返回 `500 text/plain`（防御分支，正常路径不可达）。

### 4.3 PUT /dsh-quick-notes/state

请求：

- `Content-Type` 必须是 `application/json`（否则 `415`）；
- 请求体上限 8 MiB（超过返回 `413`）；带内嵌图片的便签也受这个上限约束；
- 请求体结构：

  ```json
  { "ok": true, "state": { "schemaVersion": 1, "...": "..." } }
  ```

Host 的校验（`validateStatePayload`）：

1. 请求体是对象，`state` 是对象（不是数组）；
2. `state.schemaVersion === 1`；
3. `state.notes`、`state.trash` 是数组；
4. `state.activeId` 是字符串或 `null`；
5. `state.settings`、`state.ui` 是对象；
6. 序列化后不超过 8 MiB。

成功：

```json
{ "ok": true, "savedAt": 1793500000000 }
```

失败：

| 状态码 | 场景                                   |
| ------ | -------------------------------------- |
| `400`  | 请求体不是合法 JSON、结构校验失败      |
| `403`  | 请求围栏拒绝（见 4.6）                 |
| `405`  | 方法不是 GET / PUT                     |
| `413`  | 请求体超过 8 MiB                       |
| `415`  | `Content-Type` 不是 `application/json` |
| `500`  | 写文件失败                             |

### 4.4 POST /dsh-quick-notes/diagnostic

客户端（`src/client/diagnostics.js`）用它把挂载、主题 / 模式切换、圆球位置、同步对账
和错误写进 `diagnostics.log`，便于在没有浏览器可观察的环境里排查问题。这是一个
**只写**接口，不会返回日志内容，也不会包含便签正文。

请求体（JSON，上限 8 KiB）：

```json
{
  "kind": "mounted",
  "message": "optional short message",
  "stack": "optional stack trace",
  "componentStack": "optional React component stack",
  "version": "1.0.0",
  "mode": "normal",
  "theme": "light",
  "preference": "system",
  "hostTheme": "dark"
}
```

- `kind` 必须是以下之一，未知的 `kind` 会被 Host 拒绝（`400`）：
  - `mounted`：浮窗首次挂载；
  - `theme`：主题解析结果（`theme` / `preference` / `hostTheme`）；
  - `mode`：窗口模式切换（normal / compact / ball / hidden）；
  - `ball.mounted`：圆球挂载位置（坐标摘要放在 `message`；结构化坐标不在 Host 白名单，
    不会落盘）；
  - `sync.start` / `sync.retry`：启动时 Host 对账与自动重试（`host`、`usedRemote`、
    `localSavedAt`、`remoteSavedAt`、`attempt`、`ok`）；
  - `window.error` / `unhandledrejection` / `render.error` / `client.warning`：错误。
- Host 只保留白名单字段：`message`、`stack`、`componentStack`、`version`、`mode`、
  `theme`、`preference`、`hostTheme`、`build`、`host`、`usedRemote`、`ok`、
  `attempt`、`localSavedAt`、`remoteSavedAt`；
- `message` 最长 2000 字符，`stack` / `componentStack` 最长 6000 字符；
- Host 追加一行 `{ at, ...entry }` 到 `$DSH_HOME/quick-notes/diagnostics.log`，
  文件超过 256 KiB 时截断到约一半；
- 成功返回 `{ ok: true }`；未知 `kind` 或条目过大返回 `400`。

### 4.5 GET /dsh-quick-notes/health

```json
{
  "ok": true,
  "version": "1.0.0",
  "storage": "file",
  "path": "/dsh-quick-notes/health"
}
```

`version` 取自安装包的 `package.json`；读取失败时是 `0.0.0`。这个路由常用于确认 Host
半身是否已加载、插件版本是否正确。

### 4.6 请求围栏与安全头

这些路由挂在本地、带 cookie 的 Web 服务上，请求围栏（`src/host/fence.js`）负责挡住
DNS rebinding 和跨站浏览器请求：

- `Host` 头必须存在且主机名合法；
- 主机名必须是 loopback（`127.0.0.1`、`localhost`、`::1`）、DSH Web 服务声明的
  origin，或 `DSH_QUICK_NOTES_ALLOWED_HOSTS` 里列出的主机；
- 有 `Origin` 头时必须与 `Host` 同源；
- 没有 `Origin` 但有 `Referer` 时，`Referer` 也必须同源；
- `Sec-Fetch-Site: cross-site` 直接拒绝；
- 拒绝时返回 `403 text/plain`。

响应头固定带：

| 头                             | 值            |
| ------------------------------ | ------------- |
| `x-content-type-options`       | `nosniff`     |
| `cross-origin-resource-policy` | `same-origin` |
| `referrer-policy`              | `no-referrer` |
| `cache-control`                | `no-store`    |

`DSH_QUICK_NOTES_ALLOWED_HOSTS`（逗号分隔）用于远程访问 / 反向代理改写 `Host` 的
场景；值为 `*` 时关闭主机名检查。该变量会放宽围栏，日常使用不要设置。

### 4.7 手动验证

在本机浏览器或 curl 里访问（端口换成 DSH 的实际端口）：

```bash
curl http://127.0.0.1:58587/dsh-quick-notes/health
curl http://127.0.0.1:58587/dsh-quick-notes/state
```

curl 不带 `Origin`，Host 是 `127.0.0.1`，可以正常通过围栏。

## 5. 原子写入与故障恢复

### 5.1 写入流程

1. `mkdir -p` 确保数据目录存在；
2. 把完整内容写入 `notes.json.tmp`；
3. `rename(notes.json.tmp, notes.json)` 原子替换旧文件；
4. Windows 上文件可能被杀毒 / 索引进程短暂占用，rename 失败会按 40 / 80 / 120 ms
   重试，最多 4 次；
5. 如果仍然失败，退化为直接覆盖写 `notes.json`（避免丢更新），并对临时文件做
   尽力清理；
6. 所有写入在 Host 内部串行排队，并发 PUT 不会交错写坏文件。

### 5.2 失败与损坏

- **rename 前失败**：旧文件保持不变，浏览器收到 `500`，保留本地数据并进入
  `sync.phase = 'error'`；30 秒后自动重试，期间有新变更也会重新调度。
- **文件不存在**：按 `state: null` 处理，浏览器会把自己的本地镜像推上去。
- **文件损坏 / 非法 / 过大**：按 `state: null` + `corrupt: true` 处理；Host 不会删除
  或改写损坏文件，**下一次成功的 PUT 会把它整体替换掉**。
- **浏览器侧写 localStorage 失败**（隐私模式、配额满）：忽略该失败，继续走内存 +
  Host；同步状态会显示为本地 / 失败。

## 6. localStorage 兜底与迁移

### 6.1 键与内容

| 项目 | 值                                                        |
| ---- | --------------------------------------------------------- |
| 键名 | `dsh-quick-notes:state:v1`                                |
| 内容 | `PersistedState` 的 JSON（**不带** `{ ok, state }` 信封） |

localStorage 是同步 API，读取/写入都包在 try/catch 里；不可用时静默降级为「仅内存 +
Host」。

适配器（`src/client/storage.js`）暴露四个方法，纯函数版本同时导出供单测：

| 方法                                | 说明                                 |
| ----------------------------------- | ------------------------------------ |
| `readLocalState()`                  | 读镜像并 `migrateState` 成运行期状态 |
| `writeLocalState(state)`            | 清洗 HTML 后写镜像                   |
| `loadRemoteState()`                 | `GET` Host 并 `migrateState`         |
| `saveRemoteState(state, keepalive)` | 清洗 HTML 后 `PUT` Host              |

Host 请求带 `credentials: 'same-origin'`、`cache: 'no-store'`，默认 8 秒超时
（`REQUEST_TIMEOUT_MS`）；页面卸载时的最后一次写入使用 `keepalive`。持久化常量：
`SAVE_DEBOUNCE_MS = 500`、`SAVE_RETRY_MS = 30_000`。

### 6.2 启动流程

1. 同步读 localStorage，有数据就先渲染，避免白屏；
2. `GET /dsh-quick-notes/state`：
   - Host 有数据且 `savedAt` 比本地新：采用 Host 数据，并把它写回本地镜像；
   - Host 没有更新数据（本地更新或两边都没有）：以本地/初始状态为准；
   - 本地状态较新时，随后 `PUT` 到 Host；
3. Host 路由不可用：`sync.phase = 'local'`，继续使用 localStorage；
4. 启动时 Host 路由尚未就绪（典型：插件热重载与路由注册竞态）会自动重试对账，等待
   1 s / 3 s / 8 s 各一次；每次重试写 `sync.retry`，成功对账写 `sync.start`；
5. 首次保存会创建数据目录和 `notes.json`。

### 6.3 变更流程

1. 任何 action 同步更新内存并通知订阅者；
2. 变更进入 500 ms 防抖（`scheduleSave`），期间连续输入只触发一次持久化；
3. 防抖到期后：先把清洗过 HTML 的 `PersistedState` 写入 localStorage 镜像，再 `PUT`
   Host；成功后 `sync.phase = 'synced'`；
4. 失败时 `sync.phase = 'error'`，保留本地数据；30 秒后自动重试，期间有新变更也会
   重新调度；
5. 页面 `pagehide` 或 `flush()` 时取消防抖，立即写盘（Host 请求带 `keepalive`）。

同步状态枚举：`loading` / `local` / `syncing` / `synced` / `error`。

### 6.4 schema 迁移

- 当前 `schemaVersion` 固定为 `1`；
- 客户端用 `migrateState(raw)` 做归一化：丢弃未知字段、跳过非法便签、限制数量与长度、
  把越界的设置 / 窗口几何拉回合法范围、`activeId` 失效时回退到第一条便签；
- 旧备份 / 旧状态缺少 `settings.ruledLines` 或 `settings.theme` 时自动补默认值
  （`false` / `'system'`），不会因为新增设置项导致导入失败；
- Host 在 PUT 时只接受 `schemaVersion === 1`；未来升级 schema 必须同时在
  `src/shared/model.js` 里加迁移逻辑并同步修改 Host 校验；
- 文件损坏或版本不认识时，插件不会崩溃，而是按空状态启动并用浏览器镜像兜底。

## 7. 并发与多标签页

插件**没有**跨标签页 / 跨窗口的实时同步，也没有文件锁：

- 每个标签页有各自的内存状态和防抖计时器，启动时只读一次 Host；
- Host 侧用写队列串行化 PUT，保证单个文件不会被并发写交错；
- 多个标签页同时编辑时，**最后写入的标签页覆盖前面的**（last write wins）；
- 同一台机器上多个 DSH 实例 / 多个端口共用一个 `DSH_HOME` 时同理；
- 需要看到其他标签页的新内容时刷新页面；重要编辑前建议只保留一个标签页。

## 8. 备份与恢复

### 8.1 备份

**方式 A：设置里导出（推荐）**

设置 → 导出 JSON，浏览器下载一份完整的 `PersistedState`（文件名形如
`quick-notes-2026-11-01.json`）。文件是纯 JSON，可放到任何地方保存，也可用于迁移到
另一台机器。导出 / 导入与持久化使用同一套 HTML 白名单；缺新字段的旧备份在导入时会
自动补默认值。便签里的图片是内嵌 data URL，会让导出的 JSON 明显变大。

**方式 B：直接复制数据文件**

关闭 DSH（或至少确认没有正在输入）后复制：

```text
$DSH_HOME/quick-notes/notes.json
```

连同文件名一起保存即可。

### 8.2 恢复

**方式 A：设置里导入**

设置 → 导入 JSON，选择之前导出的文件，二次确认后覆盖当前状态。导入失败会给出提示，
当前数据不变。

**方式 B：直接替换文件**

1. 关闭 DSH；
2. 备份当前的 `notes.json`（如果还在）；
3. 用备份文件替换 `notes.json`；
4. 重启 DSH。

文件必须符合第 3 节的信封与字段格式，否则会被当作损坏文件忽略（并可能被浏览器的
localStorage 镜像覆盖）。

### 8.3 重置 / 彻底清空

只删数据文件是不够的：浏览器里还有 localStorage 镜像，下次启动可能把它推回去。彻底
清空需要两步都做：

1. 关闭 DSH，删除或改名 `$DSH_HOME/quick-notes/` 目录；
2. 清除该站的 localStorage：DevTools → Application → Local Storage，删除
   `dsh-quick-notes:state:v1`，或清除站点数据；
3. 重启 DSH。

建议先导出 JSON 备份，确认不需要后再删。

## 9. 安全与隐私

- 数据文件是**明文 JSON**，插件不做加密；文件权限由操作系统的默认 umask 决定。便签
  敏感时请开启磁盘加密。
- 插件不向外网发请求、不做遥测、不读取便签以外的东西；Host 路由只写本地文件。
- 路由带同源围栏与安全响应头，拒绝跨站页面读取或修改便签。
- 诊断日志只记录挂载 / 主题 / 模式 / 圆球 / 同步 / 错误等固定字段，Host 按白名单
  过滤并限制长度，不接收便签正文。
- 富文本 HTML 在持久化边界统一做白名单清洗：脚本、事件属性、外链、iframe 等会被
  剥离；图片只保留 `data:image/(png|jpeg|jpg|webp|gif);base64,` 且 ≤500,000 字符的
  内嵌位图，SVG 和远程图片地址一律丢弃。

## 10. 相关文档

- [`architecture.md`](architecture.md) —— 实现契约
- [`user-guide.md`](user-guide.md) —— 用户手册
- [`faq.md`](faq.md) —— 常见问题（数据在哪、如何备份、如何卸载清理）
- [`development.md`](development.md) —— 开发与调试
