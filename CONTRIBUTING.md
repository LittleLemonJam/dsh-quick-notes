# 贡献指南

感谢你愿意改进「随想随记」（`dsh-quick-notes`，当前版本 1.0.0）。本文说明环境、
代码风格、测试要求和提交约定。实现契约以 [`docs/architecture.md`](docs/architecture.md)
为准，开发细节见 [`docs/development.md`](docs/development.md)。

## 1. 环境准备

- Node.js **>= 22.13** 与 npm；
- Git；
- 可选：本地安装的 DeepSeek Harness **>= 0.2.0**，用于手动验证；
- 推荐编辑器开启 EditorConfig 与 Prettier 支持（仓库已提供 `.editorconfig` /
  `.prettierrc.json`）。

```bash
git clone https://github.com/LittleLemonJam/dsh-quick-notes.git
cd dsh-quick-notes
npm install
npm run build
npm run verify
```

`npm run verify` 会跑格式检查、构建产物检查、静态检查和单元测试，是提交前的最低要求。

## 2. 先读契约

- [`docs/architecture.md`](docs/architecture.md) 是唯一实现契约：数据模型、store
  actions、组件行为、Host 路由、持久化与文件所有权都以它为准；
- 新增能力先改契约，再改代码与测试；
- 并行开发时按契约里的「文件所有权」表划分写作用域，避免互相覆盖。

## 3. 代码风格

仓库使用 Prettier 统一格式，配置在 `.prettierrc.json`：

| 选项            | 值         |
| --------------- | ---------- |
| `singleQuote`   | `true`     |
| `semi`          | `false`    |
| `printWidth`    | `100`      |
| `trailingComma` | `all`      |
| `arrowParens`   | `always`   |
| `endOfLine`     | `lf`       |
| `proseWrap`     | `preserve` |

```bash
npm run format        # 写入格式
npm run format:check  # 只检查（CI 使用）
```

其他约定：

- 每个模块顶部一段块注释说明职责与边界；导出函数写 JSDoc（参数 / 返回）；
- 命名：`camelCase` 变量与函数、`PascalCase` 组件、`SCREAMING_SNAKE_CASE` 常量；
  CSS 类名统一 `qn-` 前缀，测试钩子属性统一 `data-qn-*`；
- 一个文件一个职责，超过 500 行先考虑拆分；
- 禁止：`var`、隐式全局变量、把未清洗内容直接写进 `innerHTML`、`console.log`
  （调试用 `console.debug` 且必须可移除）、魔法数字（进 `constants.js`）；
- 所有可见文案必须走 `t()`，并同时补英文和中文两份 `I18N`；
- CSS 只引用 `--dsw-alias-*` 变量，阴影允许 `rgba(0,0,0,.x)`；唯一例外是 `src/client/styles.js`
  里插件自有调色板的字面量（主题独立性需要），组件 CSS 不得新增字面量色值。

### 两半的边界

- **Client 半身**：不能用 `import` / `require` 任何 `@deepseek-ai/*` 包；React 只通过
  `require('react')` 从宿主模块表取得，禁止打包 React；不向 `document.body` 写 DOM
  （`<style>` 注入除外，且要挂在 `ctx.effect` 的清理里）；源码用 ESM +
  `React.createElement`，不写 JSX。
- **Host 半身**：只能用 `node:` 内置模块和本包文件，不得 import 安装目录里的
  `@deepseek-ai/*`。
- **构建产物**：`client.js` 由 `scripts/build.mjs` 生成，**不要手改**；改完
  `src/client/**` 后运行 `npm run build` 并一起提交。

## 4. 测试要求

- 框架：Node 内置 `node --test`，文件放在 `test/unit/*.test.mjs`；DOM 相关用例可用
  devDependency `jsdom`；
- 必须覆盖：model 的迁移 / 排序 / 上限、sanitize 的 XSS 用例、geometry 的
  clamp / 缩放、format 的选区命令、Host store 的读写与损坏文件恢复、fence 的拒绝
  分支、diagnostics 的字段白名单与截断、storage 的 Host / localStorage 合并；
- 新增行为必须有测试，或在 `docs/architecture.md` §10 说明为什么不可测；
- 提交前运行：

  ```bash
  npm run verify
  ```

  其中 `npm test` 会依次验证 `client.js` 是最新的、静态契约通过、所有单测通过。

## 5. 提交信息约定

采用 Conventional Commits 风格：

```text
<type>(<scope>): <summary>

<optional body>

<optional footer>
```

- **type**：`feat`、`fix`、`docs`、`test`、`refactor`、`style`、`build`、`ci`、
  `chore`、`perf`；
- **scope**（可选）：`client`、`host`、`model`、`storage`、`editor`、`window`、
  `sidebar`、`docs`、`ci`、`release` 等；
- **summary**：祈使句、简短、不以句号结尾；
- **body**：说明动机与行为变化，必要时列出兼容性影响；
- **footer**：关联 issue（`Closes #12`），破坏性变更写 `BREAKING CHANGE:`。

示例：

```text
feat(editor): add right-click formatting menu

fix(host): retry rename when Windows locks the state file

docs: document the localStorage mirror
```

约定：

- 一个提交只做一件事，不混入无关的格式化或重构；
- 不提交 `node_modules/`、`.tmp/`、`dist/` 等本地产物；
- `client.js` 是必须提交的构建产物，源码变更时同步更新；
- 提交前确认没有调试输出和临时文件。

## 6. 分支与 Pull Request

- 从 `main` 切分支：`feat/<short-name>`、`fix/<short-name>`、`docs/<short-name>`；
- PR 前先 rebase 到最新 `main`，保证 `npm run verify` 通过；
- 按 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) 填写：
  变更说明、测试情况、影响范围；
- UI 变更请附截图或录屏（仓库文档里不伪造截图，PR 里可以放真实截图）；
- PR 描述请说明是否更新了契约、文档、`CHANGELOG.md` 和 `market.json`；
- 维护者可能会要求补充测试或拆分提交。

### PR 自检清单

提交 PR 前逐项确认：

- [ ] `npm run verify` 本地通过（格式、构建产物、静态检查、单元测试）；
- [ ] 改了 `src/client/**` 时，已 `npm run build` 并把 `client.js` 一起提交；
- [ ] 新行为有测试，或说明了为什么不可测；
- [ ] 遵循 `docs/architecture.md`；契约有变化时同一 PR 内更新契约；
- [ ] 新增界面文案同时补了英文和中文 `I18N`；
- [ ] 更新了 `CHANGELOG.md`（新变更写入 `Unreleased` 或下一版本段）和受影响的文档；
- [ ] 没有调试输出、无关格式化或临时文件；
- [ ] 没有把便签内容、token 等隐私数据带进 PR。

## 7. 文档约定

- 英文 `README.md` 是主入口，`README.zh.md` 是中文版，两份结构保持一致；
- `docs/*.md`（除 `architecture.md` 外）使用中文，面向用户的手册保持可读、可操作；
- 链接一律用相对路径，不要指向不存在的文件；不要编造截图或不存在的下载链接；
- 新增功能同步更新：`README` 功能列表、`docs/user-guide.md`、`CHANGELOG.md`
  （新变更写入 `Unreleased` 或下一版本段）；涉及数据格式时更新 `docs/storage.md`；
- 文档改动同样要过 `npm run format:check`。

## 8. 发布（维护者）

发布流程见 [`docs/development.md`](docs/development.md) 的「发布流程」一节，1.0.0 的
仓库/npm/插件市场文案见 [`docs/release-notes-1.0.0.md`](docs/release-notes-1.0.0.md)。
简要步骤：

1. 更新 `package.json` 版本号与 `CHANGELOG.md`；
2. `npm run build` 并提交 `client.js`；
3. `npm run verify`；
4. `npm publish --access public`；
5. 更新 `market.json` 的版本信息（`version` + `publishTimestamp`）；
6. 打 tag、创建 GitHub Release，并更新 awesome-dsh-plugin 的条目；
7. 推送后 CI 会在 Node 22 / 24 上验证。

## 9. 相关文档

- [`docs/architecture.md`](docs/architecture.md) —— 实现契约
- [`docs/development.md`](docs/development.md) —— 开发与调试
- [`docs/storage.md`](docs/storage.md) —— 数据与持久化
- [`docs/faq.md`](docs/faq.md) —— 常见问题
- [`docs/release-notes-1.0.0.md`](docs/release-notes-1.0.0.md) —— 1.0.0 发布文案
- [`SECURITY.md`](SECURITY.md) —— 安全策略
- [`README.zh.md`](README.zh.md) —— 项目介绍
