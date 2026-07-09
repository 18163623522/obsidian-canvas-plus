# Canvas Plus

增强 Obsidian 白板（Canvas）的插件。核心思路：**让 Canvas 从"画图工具"升级成"知识图谱的活体可视化"**——节点指向真实笔记，关系来自真实的链接/标签/文件夹，布局由算法自动完成。

## 功能总览

### 白板右键菜单（追加到原生菜单，无冲突）
- **插入节点 ▸** 文本 / 纯文字（无边框）/ 便签 / 代码 / 公式 / Mermaid 流程图 / 表格 / 倒计时 / 秒表 / 图片PDF视频
- **自动布局 ▸** 力导向 / 树形 / 放射 / 流程图
- **节点样式 ▸** 纯文字切换 / 便签 / 形状（圆角/椭圆/菱形）
- **连线样式 ▸** 实线/虚线/点线 / 粗细

### 浮动工具条
选中节点时在上方弹出：颜色 / 字号 / 形状 / 便签 / 对齐分布 / 删除
选中连线时切换为：线型 / 粗细 / 颜色 / 删除

### 编辑增强
- **Slash 菜单**：白板文本节点或笔记里输入 `/` 弹出块类型菜单
- **表格**：插入 / 外部粘贴识别（Excel/网页自动转 Markdown）/ 加行加列 / 对齐
- **富文本工具条**：选中文本片段时弹出加粗/斜体/高亮/代码

### 交互
- **智能吸附辅助线**：拖动节点时显示绿（边对齐）/红（中心对齐）辅助线，6px 阈值自动吸附
- **每块字号**：Ctrl+Alt+1~5 调整字号，持久化保存

### 智能功能
- **思维导图**：选中节点展开为子节点 + 连线 + 树形布局
- **Markdown ↔ Canvas 互转**：笔记标题树 + 链接边双向转换
- **批量节点操作**：从标签/文件夹/搜索结果批量创建节点并自动连边

## 安装（开发版）

```bash
git clone https://github.com/18163623522/obsidian-canvas-plus.git
cd obsidian-canvas-plus
npm install
npm run build
```

将 `main.js`、`manifest.json`、`styles.css` 复制到 vault 的 `.obsidian/plugins/canvas-plus/` 目录，然后在 Obsidian 设置中启用。

### 开发热重载

修改 `esbuild.config.mjs` 中的 `pluginDir` 指向你的 vault 插件目录，然后：
```bash
npm run dev   # watch 模式，改源码自动重建
```

## 技术栈

- TypeScript + esbuild（单文件 bundle）
- d3-hierarchy（ISC）- 树/放射布局
- @dagrejs/dagre（MIT）- DAG 布局
- monkey-around - Canvas 内部 API patch
- 手写 Fruchterman-Reingold - 力导向（零依赖）

## 技术要点

- **Canvas 内部 API**：Obsidian 官方只导出数据格式类型，运行时类型（Canvas/CanvasNode/CanvasView）用类型 shim 声明
- **节点创建**：用数据快照模式（`getData` + `setData` + `requestSave`），不依赖 `createTextNode`
- **右键菜单**：监听 DOM `contextmenu` 事件，追加到原生菜单 DOM
- **选中监听**：monkey-patch `Canvas.prototype.updateSelection` 等方法
- **白板 slash 菜单**：轮询 `node.child.editMode.cm`，给 CM6 编辑器挂 keydown 监听
- **倒计时/秒表**：text 节点写 `%%cp:countdown:...%%` 标记 + 自渲染交互 DOM

## 兼容性

- minAppVersion: 1.7.2
- 测试环境: Obsidian 1.12.7
- 桌面端 only

## License

MIT
