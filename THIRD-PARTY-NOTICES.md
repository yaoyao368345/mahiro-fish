# 第三方声明

本项目不复制第三方完整依赖目录，只通过固定版本号在部署时安装。
以下组件按各自许可证使用，署名与许可证原文归原作者所有。

| 组件 | 固定版本 | 许可证 | 上游 |
| --- | --- | --- | --- |
| DeepSeek Harness (`@deepseek-ai/dsh`) | 0.2.1-rc.3 | MIT | https://github.com/deepseek-ai/deepseek-harness |
| dsh-fish (`@ssamurias/dsh-fish`) | 0.9.9 | MIT | https://github.com/ssamurias/dsh-fish |
| dsh-plugin-subscriptions | 0.9.13 | MIT | https://github.com/V1ki/dsh-plugin-subscriptions |
| Node.js | 24.22.3 | MIT | https://nodejs.org/ |
| pnpm | 11.28.5 | MIT | https://github.com/pnpm/pnpm |
| sherpa-onnx | v1.13.8 (linux-x64 shared-no-tts) | Apache-2.0 | https://github.com/k2-fsa/sherpa-onnx |
| SenseVoice Small INT8 | 2024-07-17 | 见上游模型卡 / FunASR | https://github.com/FunAudioLLM/SenseVoice |
| FFmpeg (Debian 包) | Debian 13 仓库版本 | LGPL/GPL（取决于构建） | https://ffmpeg.org/ |

## dsh-fish

`dsh-fish/patches/` 中的补丁是对 dsh-fish 0.9.9 的修改，按上游 MIT 许可证使用。
上游完整 MIT 文本保存在 [`LICENSES/dsh-fish-MIT.txt`](LICENSES/dsh-fish-MIT.txt)。
`dsh-fish/modules/` 中的新模块同样以 MIT 发布。

补丁不包含上游完整包，只包含为适配本项目而修改的 diff 与新增文件。
部署脚本通过 npm 安装固定版本，再应用补丁。

## 角色与素材

角色原型来自《别当欧尼酱了！》（お兄ちゃんはおしまい！）。
本项目是非官方粉丝衍生实现，不代表原作官方授权。

本仓库不包含：

- 动画截图、角色插画、官方视觉图
- 动画配音、角色歌曲、音频素材
- 原作长篇台词或大段文本

`persona/mahiro-handover.md` 是为 AI 角色扮演编写的原创人格描述，
只使用角色的名字与背景设定，不复制原作台词。

## 其他

- OpenRouter、Breeze Blue、Telegram、Bilibili、ChatGPT 均为各自所有者的服务。
- 使用本项目时请遵守各服务的使用条款、速率限制和账号许可。
- 私人克隆音色、账号 Cookie、OAuth 令牌都不属于本项目，也不在仓库中。
