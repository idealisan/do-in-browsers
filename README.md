# do-in-browsers

纯前端的在线工具集合，所有工具都只依赖浏览器能力（File API、Canvas、Web Audio 等），
无后端、无构建步骤，可直接部署到 GitHub Pages 或 Cloudflare（Workers / Pages）。

所有数据都在本地浏览器内处理，不上传任何文件。

## 工具列表

| 工具 | 说明 |
| --- | --- |
| **[Music Viewer 音乐可视播放器](music-viewer/index.html)** | 上传音乐、封面、歌词，生成带「唱片封面 + 自动滚词 + 音频极光」效果的播放页，方便直接录屏桌面制作音乐视频 |

## 目录结构

```
do-in-browsers/
├── index.html            # 工具入口页（browser.tools 首页）
├── music-viewer/         # 音乐可视播放器
│   ├── index.html
│   ├── style.css
│   └── app.js
└── README.md
```

每个工具都是自包含的独立目录，互不依赖，可以单独部署、单独修改。

## 本地运行

工具本身是纯静态页面，双击 HTML 即可打开。为保证稳妥（部分浏览器对 `file://` 下的
AudioContext / 文件读取有限制），建议用任意静态服务器启动：

```bash
npx serve .
# 或
python -m http.server 8080
```

然后访问 http://localhost:8080 。

## 部署

### GitHub Pages

1. 推送代码到 GitHub 仓库 `main` 分支。
2. `Settings → Pages` → Branch 选 `main`、目录选 root → 保存。
3. 访问 `https://<user>.github.io/<repo>/`。

工具入口就是仓库根目录的 `index.html`。

### Cloudflare Workers / Pages

纯静态站点推荐用 **Cloudflare Pages**：

- **Pages（推荐）**：连接 GitHub 仓库 → 构建命令留空 → 输出目录留空即可。
  每次推送自动发布。
- **Workers + Static Assets**：把 `wrangler.jsonc` 放到根目录，用
  `npx wrangler deploy` 发布，适合把工具有机结合到一个 Worker 里。

> 本仓库刻意保持零构建、零依赖，两条路都能直接跑，无需任何配置。

## 开发约定（新增工具时请遵守）

- **纯前端、零构建**：只用原生 HTML / CSS / JS，不引入 npm 依赖和打包器。
- **可移动端适配，不留死角**：每个工具都使用 fluid 布局（`flex` / `grid` + `clamp()` /
  相对单位），不写死像素宽高；从第一天就保证桌面与手机都能完整使用。
- **自包含目录**：一个工具 = 一个目录，`index.html` + `style.css` + `app.js`。
- **本地优先**：文件一律用 `FileReader` / `URL.createObjectURL` 在浏览器内处理，
  不生成任何网络请求。
- **录制友好**：为方便录屏（如制作音乐视频），工具提供全屏、控件临时隐藏、循环播放
  等录制相关能力。
- 资源引用一律使用**相对路径**，保证部署在任何子路径下都能工作。