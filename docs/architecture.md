# 随想随记（dsh-quick-notes）架构契约

本文是仓库内部的**唯一实现契约**。所有模块必须按本文的导出、数据形状与命名约定实现；
新增能力先改本文，再改代码。面向用户的说明见 `README.md` / `README.zh.md`。

## 1. 项目定位

`dsh-quick-notes` 是 DeepSeek Harness Web GUI 的一个持久化插件：

- **Client 半边**：在 `shell.overlay`（全框浮动层）里渲染一个可拖动、可缩放的便签浮窗；
  同时在 `sidebar.footer.action`（侧栏底部）放一个入口按钮，用于显示 / 隐藏浮窗。
- **Host 半边**：注册同源 HTTP 路由，把便签状态原子写入
  `$DSH_HOME/quick-notes/notes.json`，让笔记跨页面刷新、跨端口、跨浏览器存活。
- **兜底**：Host 路由不可用时，Client 自动降级到 `localStorage`，功能不中断。

插件包名 / Loader 行 id / ModuleLoader id 三者**必须完全一致**：`dsh-quick-notes`。

## 2. 技术约束

- 运行环境：DSH Web GUI（Chromium/Electron），Client 半边是浏览器 bundle。
- Client bundle 的格式固定为 `window.__ModuleLoader__.load({ id, factory(require) { ... } })`；
  React 只能通过 `require('react')` 从宿主模块表取得，**禁止**打包 React。
- 源码用 ESM + `React.createElement`（不写 JSX），由 `scripts/build.mjs`（esbuild）打包成
  上述格式；`client.js` 是构建产物，必须提交进仓库。构建时通过 esbuild `define` 注入
  `__PLUGIN_VERSION__`（值为 package.json 的 version），源码用
  `typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev'` 兜底。
- Client 禁止 `import` / `require` 任何 `@deepseek-ai/*` 包；只能用 `ctx.get('slots')`、
  `ctx.get('locale')` 这类服务。组件样式只引用 `--dsw-alias-*` 变量（阴影允许 `rgba(0,0,0,.x)`）；
  例外：为支持独立主题，插件自有调色板的字面量集中在 `styles.js` 的 `.qn-root` 变量块里，
  组件 CSS 不得再新增字面量颜色。
- Host 半边只能用 `node:` 内置模块和本包文件，不得 import 安装目录里的 `@deepseek-ai/*`。
- 不写 DOM 到 `document.body`（`<style>` 注入除外，且必须挂在 `ctx.effect` 的清理里）。

## 3. 目录结构

```text
dsh-quick-notes/
├── index.js                  # Host 入口（export inject / apply）
├── client.js                 # Client 构建产物（提交进仓库，勿手改）
├── cordis.patch.yml          # bundle patch
├── package.json
├── icon.svg
├── locale/{en,zh}.json       # 插件管理器展示元数据（meta.title / meta.description）
├── src/
│   ├── host/
│   │   ├── paths.js          # DSH_HOME / 数据文件路径
│   │   ├── store.js          # 读 / 原子写 / 校验
│   │   ├── fence.js          # 同源请求围栏
│   │   ├── diagnostics.js    # 客户端诊断日志（mount ping / 渲染错误）
│   │   └── routes.js         # 路由 handler
│   ├── shared/
│   │   ├── constants.js      # Client/Host 共享常量（schema 版本、上限）
│   │   ├── model.js          # 纯状态模型（无 DOM、无 IO，可单测）
│   │   └── sanitize.js       # 富文本白名单清洗（纯函数，可单测）
│   └── client/
│       ├── index.js          # createPlugin()：注册样式 / locale / 两个 slot
│       ├── app.js            # App 组合根 + ErrorBoundary + 分隔条
│       ├── store.js          # 便签 store（useSyncExternalStore 兼容）
│       ├── storage.js        # Host 路由 + localStorage 双层持久化
│       ├── diagnostics.js    # 向 Host 诊断日志上报 mount / 模式 / 同步 / 错误
│       ├── theme.js          # 宿主主题探测 + 插件主题解析（跟随/固定）
│       ├── images.js         # 粘贴/拖入图片的等比缩放与 data URL 编码
│       ├── i18n.js           # 合并各模块 I18N，注册 locale 命名空间
│       ├── styles.js         # BASE_CSS + 汇总各组件导出的 CSS
│       ├── dom.js            # h / cx / 小工具
│       ├── launcher.js       # 侧栏底部入口按钮
│       └── components/
│           ├── window.js     # WindowFrame + 拖拽 / 缩放 / 紧凑模式
│           ├── ball.js       # 最小化圆球
│           ├── sidebar.js    # 目录：新建 / 重命名 / 置顶 / 删除
│           ├── settings.js   # 设置面板
│           ├── trash.js      # 回收站面板
│           ├── editor.js     # contentEditable 编辑器
│           ├── context-menu.js # 右键格式菜单
│           ├── format.js     # 选区格式化 / 复制 / 剪切 / 粘贴
│           └── geometry.js   # 纯几何函数（可单测）
├── scripts/{build.mjs,check.mjs}
├── test/unit/*.test.mjs      # node --test
├── docs/*.md
└── .github/workflows/ci.yml
```

## 4. 数据模型（`src/shared/model.js`）

```ts
type NoteId = string // 'n_' + base36 时间戳 + '_' + base36 随机串

interface Note {
  id: NoteId
  title: string // trim 后 1..80 字符；UI 传空时由调用方补默认标题
  html: string // 富文本 HTML，持久化前经 sanitizeHtml
  pinned: boolean
  createdAt: number // epoch ms
  updatedAt: number
}

interface TrashedNote extends Note {
  deletedAt: number
}

interface Settings {
  fontSize: number // 13..20，默认 15
  lineHeight: number // 1.4..2.0，默认 1.75
  ruledLines: boolean // 正文横线衬底，默认 false
  theme: 'system' | 'light' | 'dark' // 默认 system = 跟随 DSH 主题
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface PersistedUi {
  mode: 'normal' | 'compact' | 'ball' | 'hidden'
  rect: Rect // 当前窗口矩形（compact 时也是 compact 后的矩形）
  compactRect: Rect | null // 进入 compact 前的正常矩形，用于还原
  sidebarWidth: number // 120..320，默认 176
  ball: { x: number; y: number } // 圆球左上角坐标
}

interface PersistedState {
  schemaVersion: 1
  savedAt: number // 客户端写入时间，Host 只存不解释
  notes: Note[]
  trash: TrashedNote[] // 最多 100 条，超出从最旧丢弃
  activeId: NoteId | null
  settings: Settings
  ui: PersistedUi
}
```

运行期 State 在 PersistedState 基础上追加：

```ts
interface State extends PersistedState {
  ready: boolean // 首次加载完成
  view: 'notes' | 'trash' | 'settings' // 侧栏当前视图，不持久化
  contentEpoch: number // 整状态替换计数：采用较新 Host 副本 / 导入 JSON 时 +1
  sync: {
    phase: 'loading' | 'local' | 'syncing' | 'synced' | 'error'
    message?: string // 仅 error 时给用户看的短文案键
    at: number
  }
}
```

`src/shared/constants.js` 导出 `SCHEMA_VERSION` / `MAX_NOTES` / `MAX_TRASH` /
`MAX_TITLE_LENGTH` / `MAX_NOTE_HTML_LENGTH` / 路由与体积常量。
`model.js` 必须导出（全部纯函数）：

```js
export const DEFAULT_SETTINGS
export function createInitialState(now = Date.now()): State
export function createNote(title, now = Date.now()): Note
export function normalizeTitle(title, fallback): string
export function sortNotes(notes): Note[] // pinned 优先；组内保持插入顺序（编辑不跳位）
export function findNote(state, id): Note | undefined
export function upsertNote(notes, note): Note[] // 更新并置顶到数组头？不，仅替换同 id 项
export function buildPersistedState(state): PersistedState // 去掉 ready/view/sync，html 清洗由 storage 负责
export function migrateState(raw): { state: PersistedState; migrated: boolean } | null
export function isValidPersistedState(raw): boolean
```

约束：`model.js` 不 import `sanitize.js`（避免循环）；清洗在 `storage.js` 的序列化
边界、`store.exportState/importState` 和编辑器渲染前完成。`contentEpoch` 让编辑器在
"整份状态被替换但当前便签 id 不变"时也重载 DOM，避免旧内容覆盖较新的 Host 数据。

## 5. Store（`src/client/store.js`）

```js
export function createNotesStore({ storage, now = Date.now }): Store

interface Store {
  getState(): State // 引用稳定：无变化必须返回同一对象
  subscribe(listener: () => void): () => void
  actions: {
    createNote(title: string): NoteId | null // null = 达到 MAX_NOTES
    renameNote(id: NoteId, title: string): void
    setNoteHtml(id: NoteId, html: string): void
    togglePin(id: NoteId): void
    moveNote(id: NoteId, toIndex: number): void // 显示顺序索引；只在置顶/普通组内移动
    trashNote(id: NoteId): void
    restoreNote(id: NoteId): void
    purgeNote(id: NoteId): void
    emptyTrash(): void
    selectNote(id: NoteId | null): void
    setView(view: 'notes' | 'trash' | 'settings'): void
    updateSettings(patch: Partial<Settings>): void
    updateUi(patch: Partial<PersistedUi>): void // 浅合并；嵌套对象整体替换
    setMode(mode: PersistedUi['mode']): void // hidden 仅由侧栏入口切换
    resetWindowSize(): void // 恢复默认 560×440，保留位置并退出 compact
    resetWindowPosition(): void // 移到右侧中间默认位置，保留尺寸并退出 compact
    importState(raw: unknown): { ok: boolean; message?: string }
    exportState(): PersistedState
    flush(): Promise<void> // 立即把待写内容写盘
  }
  start(): Promise<void> // 读缓存 -> 读 Host -> 合并 -> ready
  dispose(): void
}
```

- 所有 action 同步更新内存并触发 `subscribe`；`savedAt` 与 `sync.phase` 由 store 维护。
- 持久化：`storage.save(state)` 由 store 做 500ms debounce；`flush()` 取消防抖立即写。
- 空标题回退：`renameNote` / `createNote` 收到空串时用调用方传入的兜底标题（UI 传
  `t('note.untitled')`）；store 本身不依赖 i18n。
- `MAX_NOTES` / `MAX_TRASH` 上限：新建超过 `MAX_NOTES` 时 `createNote` 返回 `null`，
  目录静默拒绝（无 toast；文档化为已知限制）；回收站超过 `MAX_TRASH` 时从最旧条目丢弃。

## 6. 持久化（`src/client/storage.js` + Host）

### 6.1 Host HTTP 契约

| 方法 | 路径                          | 说明                                                                                                                                                      |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/dsh-quick-notes/state`      | 返回 `{ ok: true, state: PersistedState \| null, corrupt: boolean }`（`corrupt` 表示磁盘文件不可用，客户端会用本地镜像覆盖）                              |
| PUT  | `/dsh-quick-notes/state`      | 请求体 `{ ok: true, state: PersistedState }`，成功返回 `{ ok: true, savedAt }`                                                                            |
| GET  | `/dsh-quick-notes/health`     | `{ ok: true, version, storage: 'file', path }`，用于安装验证                                                                                              |
| POST | `/dsh-quick-notes/diagnostic` | 追加一条客户端诊断（`mounted`/`theme`/`mode`/`ball.mounted`/`sync.start`/`sync.retry`/错误类 kind），写入 `diagnostics.log`，供无浏览器环境验证与运维排查 |

- 请求围栏：`Host` 头必须是 loopback / 监听地址；有 `Origin` 时必须与 `Host` 同源；
  `Sec-Fetch-Site: cross-site` 拒绝；错误返回 403。`DSH_QUICK_NOTES_ALLOWED_HOSTS`
  是远程/反向代理场景的高级开关（逗号分隔的额外主机名，`*` 关闭 Host 校验），会放宽围栏，默认不设置。
- 请求体上限 8 MiB（diagnostic 8 KiB；便签可携带缩放后的 data URL 图片）；只接受 `application/json`；`PUT` 校验
  `schemaVersion === 1` 且 `state` 是对象；写入前做基本结构校验（notes/trash/settings/ui 存在）。
  写入方总带 `{ ok: true, state }`；读取只要求合法的 `state`（`ok` 可省略，便于手工修复）。
- 数据文件：`$DSH_HOME/quick-notes/notes.json`（`DSH_QUICK_NOTES_DIR` 可覆盖目录），
  先写 `notes.json.tmp` 再 rename 替换；写失败保留旧文件。诊断日志
  `$DSH_HOME/quick-notes/diagnostics.log` 按 256 KiB 上限截断。
- 安全响应头：`x-content-type-options: nosniff`、`cross-origin-resource-policy: same-origin`、
  `referrer-policy: no-referrer`、`cache-control: no-store`。

### 6.2 Client 双层策略

1. 启动：先同步读 `localStorage`（键 `dsh-quick-notes:state:v1`）渲染，再 GET Host。
   - Host 有数据且 `savedAt` 更新 → 用 Host；本地更新 → 把本地 PUT 上去。
   - Host 不可用 → `sync.phase = 'local'`，继续用 localStorage。
2. 变更：内存更新后 500ms debounce 写 localStorage + PUT Host；
   成功 `synced`，失败 `error` 并保留本地数据，30s 后随下一次变更重试。
3. 序列化边界统一 `sanitizeHtml` 清洗每条 note.html。
4. 适配器方法名：`readLocalState()` / `writeLocalState(state)` /
   `loadRemoteState()` / `saveRemoteState(state, keepalive)`；`storage.js` 同时导出
   这些操作的纯函数版本供单测。

## 7. 组件契约（Client）

所有组件是**普通函数组件**，通过 props 拿数据，不直接 import store 单例：

```js
WindowFrame({ t, state, actions, children })
MinimizedBall({ t, state, actions })
Sidebar({ t, state, actions })
NoteEditor({ t, state, actions, note }) // note 可为 null
SettingsPanel({ t, state, actions }) // Sidebar 内部渲染
TrashPanel({ t, state, actions }) // Sidebar 内部渲染
```

- `t`：slot 注册时传 `locale: 'quickNotes'` 后由宿主注入的翻译函数，签名 `t(key, params?)`。
- `state` / `actions`：见 §4 / §5；组件内部用 `React.useSyncExternalStore(store.subscribe, store.getState)`
  **不允许**（store 不在 props 里），统一由 App 注入最新 `state`。局部 UI 状态（草稿标题、
  菜单坐标、确认态）用组件自己的 `useState`。
- 每个组件模块必须额外导出：
  - `export const CSS = '...'`：该组件全部样式，类名统一 `qn-` 前缀；
  - `export const I18N = { en: {...}, zh: {...} }`：该组件文案，key 统一 `组件名.` 前缀
    （如 `sidebar.newNote`、`editor.titleInput`）。
- `src/client/i18n.js` 负责合并所有 `I18N` 并注册 `quickNotes` 命名空间。
- 事件处理：拖动 / 缩放用 Pointer Events + `setPointerCapture`；所有全局监听
  （pointermove/pointerup、click、keydown）必须在 `useEffect` 里注册并返回清理。

### 7.1 窗口行为（`window.js` / `ball.js` / `geometry.js`）

- 标题栏拖动移动整个窗口；拖动/缩放期间整窗完整保留在视口内（clamp；视口小于
  最小尺寸时以视口为准）。
- 8 个缩放手柄（四边 + 四角）；最小 320×240，最大不超过视口；缩放时对边固定。
- 标题栏右上角按钮**从左到右**：
  1. `仅便签`：进入 compact（隐藏目录，保留标题栏与按钮；窗口宽度收缩到 ≤460，
     原矩形存 `ui.compactRect`）；compact 下同一按钮变为 `显示目录`，恢复原矩形与 normal。
  2. `缩成圆球`：进入 ball，窗口消失，显示可拖动的圆球；点圆球恢复 normal。
  3. `恢复默认大小`：调用 `actions.resetWindowSize()`，窗口宽高恢复默认 560×440，
     位置保持不变并 clamp，退出 compact 回 normal。
- 圆球：56px 圆形，只带便签图标（**不再有便签数角标**）；拖动后位置持久化到 `ui.ball`；
  单击（位移 < 4px）恢复窗口。点击「缩成圆球」时圆球放到**窗口右上角**（clamp 到视口），
  而不是旧的右下角默认位置——右下角被侧栏鲸鱼/费用挂件占用，圆球会被挡住。
  ball 模式下 `.qn-root[data-qn-mode='ball']` 提升到 `z-index: 2147483640`，
  保证 56px 圆球浮在其他插件挂件之上；normal/compact 模式仍是普通层级，不遮挡宿主弹窗。
  非法/缺失的 `ui.ball` 坐标回退到右下角并 clamp，绝不渲染到不可见区域。
- 窗口几何持久化到 `ui.rect` / `ui.compactRect` / `ui.sidebarWidth`；页面加载时
  `geometry.clampRect` 把越界矩形拉回视口（显示器分辨率变化时仍可见）。
- **顶部安全区**：DSH 桌面标题栏是原生拖拽区，窗口拖到最顶部会把整个 DSH 窗口拖走。
  `geometry.clampRect` 的 y 下限为 `WINDOW_TOP_INSET = 64`（视口过矮时取
  `min(inset, 视口高 - 窗口高)` 保证完整可见）；`resizeRect` 的 n/nw/ne 顶边同样受限。
- **默认位置**：`createInitialState` 把窗口放在 DSH 帧的**右侧中间**
  （x = 视口宽 - 窗口宽 - 24，y = max(64, (视口高 - 窗口高)/2)）；设置面板的
  「恢复默认位置」调用 `actions.resetWindowPosition()` 回到这里（保留当前尺寸）。
- 目录/编辑器之间的分隔条：pointerdown 后拖动改变 `ui.sidebarWidth`（clamp 120..320）。

### 7.2 目录（`sidebar.js`）

- 顶部：标题「便签」+ 新建按钮（`+`）。
- 新建：插入一行草稿输入框并**立即聚焦**，Enter 确认创建（名称可空 → 默认「未命名便签」），
  Esc 取消；创建后自动选中。
- 列表：`sortNotes` 顺序；行内显示标题、置顶标记；hover 显示置顶/删除按钮；
  双击行进入重命名输入框（Enter 确认 / Esc 取消 / blur 确认）。
- 拖拽排序：按住行上下拖动可调整顺序（Pointer Events，4px 阈值区分点击/双击；
  按钮、输入框上不启动）。拖动期间被拖行跟手，其余行用 FLIP（测量前后位置 +
  transform 过渡）平滑让位；松手调用 `actions.moveNote(id, targetIndex)`。
  排序只允许在置顶组/普通组内部进行，跨组目标由 store clamp 到组边界。
- 删除：软删除进回收站；当前选中项被删后选中列表首项或 `null`。
- 底部左端：设置齿轮按钮 + 回收站按钮（带数量徽标）+ 横线衬底开关（回收站右侧，
  图标三横线，`aria-pressed` 反映 `settings.ruledLines`）；右侧显示同步状态小圆点。
- 回收站面板：列表（标题 + 删除时间）、还原、彻底删除（两段确认）、清空回收站（两段确认）。
- 设置面板：字号（13–20 步进）、行高（1.4–2.0 步进）、主题（跟随系统/浅色/深色）、
  「恢复默认位置」（`actions.resetWindowPosition()`，见 §7.1）、导出 JSON、
  导入 JSON（两段确认）、同步状态、版本号与项目链接。
- 空态：无便签时给一句引导文案 + 新建按钮。

### 7.3 编辑器（`editor.js` / `context-menu.js` / `format.js`）

- 顶部：当前便签标题（**双击可重命名**：变输入框、自动聚焦全选，Enter 提交 /
  Esc 取消 / 失焦提交，空值保持原名，提交走 `actions.renameNote`）、字数、更新时间。
- 主体：`contentEditable` 区域，`white-space: pre-wrap; word-break: break-word;`，
  字号/行高取 `settings`；**空便签不显示占位提示**（无 placeholder 文案）；
  `onInput` 把 `editor.innerHTML` 交给 `actions.setNoteHtml(id, html)`，并在输入
  过程中**不**回写 innerHTML、**不**改动选区（避免光标跳动）。
- 横线衬底：`settings.ruledLines === true` 时正文加 `qn-editor-ruled` 类，用
  `repeating-linear-gradient` 按 `--qn-line-height`（= fontSize × lineHeight）画横线，
  颜色 `--qn-rule-color`；纸面背景用 `--qn-paper-bg`（浅色主题为浅米黄）。
- 切换便签：用 `sanitizeHtml(note.html)` 设置 innerHTML；保存当前便签无需额外动作（onInput 已写）。
- 粘贴：拦截 `paste`，`text/html` 走 `sanitizeHtml` 后 `insertHTML`，纯文本走 `insertText`；
  剪贴板里的 `image/*` 文件优先走图片路径（见下）。
- 图片：`src/client/images.js` 把粘贴/拖入的图片文件用 canvas **等比缩放**到最长边 ≤1024px，
  再编码为 data URL：源 MIME 为 `image/jpeg`/`image/jpg` 时用 JPEG（质量 0.82），
  其余（PNG/WebP/GIF 等可能带透明的格式）用 PNG，GIF 动图只取首帧；若超过 450k 字符
  预算继续按 0.75 缩小（下限 320px），失败则忽略。`sanitize.js` 只保留 `src` 为
  `data:image/(png|jpeg|jpg|webp|gif);base64,` 且 ≤500k 字符的 `<img>`，外链/SVG/事件属性全部丢弃。
  CSS `.qn-editor-body img { max-width: 100%; height: auto; }` 保证大图不会撑破窗口。
- 拖放：拦截 `drop`（`dragover` 也 preventDefault），`image/*` 文件走图片路径，
  `text/html` 走 `sanitizeHtml` 后插入、纯文本走 `insertPlainText`；浏览器默认的 drop
  会把外部 HTML 直接插进实时 DOM，必须拦。
- 右键菜单：选区非空时拦截 `contextmenu`，在鼠标位置弹出菜单（clamp 到视口），
  只提供 **复制 / 剪切 / 粘贴 / 清除格式** 四项：
  - 复制 / 剪切 / 粘贴：`format.copySelection` / `format.cutSelection` / `format.pasteAtCaret`；
  - 清除格式：去掉选区内的粗体/斜体/下划线与粘贴带入的行内样式。
  - 菜单 `mousedown` 必须 `preventDefault` 以保住选区；点击外部 / Esc / 滚动时关闭；
    剪贴板失败时菜单保持打开并显示 `role="status"` 状态行。
- **高亮与字体颜色功能已按用户要求移除**：`format.js` 不再导出高亮/字色色板与命令，
  编辑器也不再有光标锚点/格式退出逻辑；已存在便签里旧的高亮/颜色标记仍按
  `sanitize.js` 白名单渲染，但不能再新加。
- 键盘：Ctrl/Cmd+B/I/U 走 `format` 的粗体/斜体/下划线（优先 `execCommand`，失败回退
  Range 包裹），其余保持浏览器默认；所有变更命令派发一次 `input` 事件并恢复编辑器焦点。

### 7.4 主题（`theme.js` + `styles.js`）

- 插件拥有自己的调色板：`styles.js` 在 `.qn-root` 内覆盖组件用到的 `--dsw-alias-*`
  变量（浅色默认，`[data-qn-theme='dark']` 覆盖深色），因此宿主主题变化不会穿透到
  便签 UI；同时定义 `--qn-paper-bg`（浅色浅米黄）/ `--qn-rule-color`。
- `settings.theme`：`'system'` 跟随 DSH 主题；`'light'` / `'dark'` 固定插件主题，
  此时用户在 DSH 设置里切换主题不影响便签。
- `theme.js` 通过宿主实际绘制背景的亮度判断明暗（body → documentElement 依次取
  computed background），属性 `data-ds-dark-theme` 与 `prefers-color-scheme` 只作兜底；
  用 MutationObserver 监听 documentElement/body 属性变化，`matchMedia` 监听系统配色。
- `App` 把解析后的结果写到 `.qn-root` 的 `data-qn-theme` 与 `data-qn-mode` 上。

### 7.5 入口按钮（`launcher.js`）

- 注册到 `sidebar.footer.action`，图标按钮 + `title`/`aria-label`；
- 点击：`state.ui.mode === 'hidden'` → `setMode('normal')`（恢复普通窗口）；
  否则 → 设为 hidden（窗口与圆球都消失，侧栏入口仍在）。
- 视觉与侧栏底部其他动作一致：透明底、hover 用 `--dsw-alias-bg-layer-2`。

## 8. 文案与 i18n

- 命名空间：`quickNotes`；locale 文件 `locale/{en,zh}.json` 只放插件管理器展示的
  `meta.title` / `meta.description`；界面文案在各组件 `I18N` 里。
- 组件 key 前缀：`app.` `window.` `ball.` `sidebar.` `editor.` `menu.` `settings.` `trash.`
  `note.` `sync.` `limit.`。
- 所有可见文案必须走 `t()`，禁止硬编码中英文。

## 9. 代码风格（Prettier 统一）

- Prettier：`singleQuote: true`、`semi: false`、`printWidth: 100`、`trailingComma: 'all'`、
  `arrowParens: 'always'`；提交前 `npm run format`，CI 跑 `format:check`。
- 文件头注释：每个模块顶部一段块注释，说明职责与边界；导出函数写 JSDoc（参数/返回）。
- 命名：`camelCase` 变量/函数、`PascalCase` 组件、`SCREAMING_SNAKE_CASE` 常量、
  `qn-` 前缀 CSS 类、`data-qn-*` 前缀测试钩子属性。
- 禁止：`var`、隐式全局、`innerHTML` 直接拼接未清洗内容、`console.log`（调试用
  `console.debug` 且必须可移除）、魔法数字（进 `constants.js`）。
- 一个文件一个职责；超过 500 行先拆分。

## 10. 测试

- 框架：Node 内置 `node --test`（`test/unit/*.test.mjs`）；DOM 相关用 devDependency `jsdom`。
- 必须覆盖：model 的迁移/排序/上限、sanitize 的 XSS 用例、geometry 的 clamp/缩放、
  format 的选区命令（jsdom）、Host store 的读写/损坏文件恢复、fence 的拒绝分支、
  storage 的 Host/localStorage 合并。
- `npm test` = `node scripts/build.mjs --check && node scripts/check.mjs && node --test "test/unit/*.test.mjs"`。
- 集成测试 `test/unit/end-to-end.test.mjs` 用进程内 fetch shim 把 Client storage 适配器、
  Host 路由与状态文件串起来，验证"一个页面写入 → 磁盘 → 另一个页面读取"以及损坏文件恢复。
- 组件测试 `test/unit/editor.test.mjs` 用 jsdom + react-dom 验证 contentEpoch 触发的
  DOM 重载、drop 的 HTML 清洗、图片粘贴降级、标题重命名与横线衬底；`test/unit/format.test.mjs`
  覆盖粗体/斜体/下划线的包裹与取消、剪贴板命令、清除格式与插入清洗；
  `test/unit/sanitize.test.mjs` 覆盖 data:image 白名单；`test/unit/images.test.mjs`
  覆盖等比缩放计算与降级；
  `test/unit/host-entry.test.mjs` 验证 `index.js` 路由注册与 handler 直连；
  `test/unit/theme.test.mjs` 覆盖主题探测/解析与 App 的 `data-qn-theme`/`data-qn-mode`；
  `test/unit/ball.test.mjs` 覆盖圆球无角标/位置回退/clamp/点击恢复与 z-index 提升；
  `test/unit/window.test.mjs` 覆盖最小化放置、compact 还原与恢复默认大小按钮；
  `test/unit/window-style.test.mjs` 锁定窗口边框、标题栏分隔线与按钮顺序。
- 新增行为必须有测试或在本文件说明为何不可测。

## 11. 文件所有权（并行开发时的写作用域）

| 作用域                                                                                                                                                                                                                                                                               | 负责人                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `package.json`、`cordis.patch.yml`、`index.js`、`src/host/**`、`src/shared/model.js`、`src/shared/constants.js`、`src/client/{index,app,store,storage,i18n,styles,dom,launcher,diagnostics}.js`、`scripts/**`、`test/unit/{model,host-*,storage-*,client-bundle}.test.mjs`、仓库配置 | Lead                             |
| `src/client/components/{editor,context-menu,format}.js`、`src/shared/sanitize.js`、`test/unit/{sanitize,format}*.test.mjs`                                                                                                                                                           | editor-dev                       |
| `src/client/components/{window,ball,geometry}.js`、`test/unit/geometry*.test.mjs`                                                                                                                                                                                                    | window-dev                       |
| `src/client/components/{sidebar,settings,trash}.js`、`test/unit/sidebar*.test.mjs`                                                                                                                                                                                                   | sidebar-dev                      |
| `README*.md`、`docs/*.md`（architecture 除外）、`CHANGELOG.md`、`CONTRIBUTING.md`、`market.json`、`.github/**`                                                                                                                                                                       | docs-dev                         |
| 独立审查报告                                                                                                                                                                                                                                                                         | reviewer（只读代码，不修改源码） |
