# SRT / LRC Maker

纯前端工具：上传音频或视频 → 调用云端 AI → 生成带时间戳的 **SRT 字幕** 和 **LRC 歌词**，
可直接给同仓库的 *Music Video Creator* 使用。原生 HTML / CSS / JS，无构建、无依赖。

## 使用

1. 用静态服务器打开本目录（例如在本目录运行 `python3 -m http.server 8000`）。
2. **API 配置**
   - **Google AI Studio**：填 API Key 后，模型下拉框会调用 `GET /v1beta/models` 自动列出支持
     `generateContent` 的 Gemini 模型（已排除 TTS、图像、Embedding 等无关模型），无需手输
     模型 ID；默认接口随所选模型自动生成。
   - **Cloudflare Workers AI**：填 API Token 和 Account ID。官方 `api.cloudflare.com`
     **不允许浏览器跨域直连**，需要部署随附的 `worker.js`，并把它的地址
     （如 `https://srtlrc-proxy.<subdomain>.workers.dev/whisper`）填入「API 地址」。
     模型下拉框通过 Worker 的 `GET /models` 查询可用的语音识别模型（如 Whisper）。
   - 模型列表在填写 Key（Cloudflare 还需 Account ID）后自动获取，也可点「刷新」重新拉取；
     获取失败时会保留当前模型，不影响继续使用。
3. 上传 MP3 / OGG / AAC / M4A / WAV / FLAC / MP4 / WebM。
   - 视频会先由浏览器解码并**自动抽取音频流**（需要浏览器支持该文件格式的解码）。
   - 统一转成 16 kHz 单声道 WAV 后发送，以控制请求体积。
4. 点击「生成字幕 / 歌词」。结果可在文本框里直接修改，再下载 `.srt` / `.lrc`。

## 部署 Cloudflare 代理 Worker

```bash
npx wrangler deploy worker.js --name srtlrc-proxy
```

也可以直接把 `worker.js` 内容粘贴到 Cloudflare Dashboard → Workers → 创建 Worker。
无需任何绑定或密钥，Token 与 Account ID 由页面通过请求头传入，Worker 只做转发与 CORS。

## 关于 Key 的保存

勾选「在本机浏览器保存以上配置」后，配置（含 API Key）会写入 `localStorage`，
下次打开自动填充；取消勾选会立即删除。公共电脑请勿勾选。

## 已知限制（后续迭代）

- 当前是「整段音频识别」，没有「先提供原文再做精确时间戳对齐」的模式。
- Gemini 的内联音频上限约 20 MB；超长音频建议先裁剪或压缩。
- 浏览器能否解码某个视频取决于本机浏览器对该编码的支持；不支持时可先用 ffmpeg 转成音频。
