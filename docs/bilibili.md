# B 站浏览、抽帧与字幕

## 能做什么

dsh-fish 自带 B 站工具，本项目补丁增强了画面记忆与字幕：

| 工具 | 作用 |
| --- | --- |
| `bili_look` | 看首页/搜索/相关推荐/指定视频/自己评论的回复 |
| `bili_watch` | 对一条视频抽 9 帧拼图，真正“看见”画面 |
| `bili_sub` | 读字幕，一次最多 3 句，带时间点，可翻页 |
| `her_media` | 翻自己真正看过画面的长期索引 |

`bili_look` 只读文字：标题、简介、标签、热评、弹幕。
“翻到标题”不等于“看过画面”；只有 `bili_watch` 成功抽帧才算。

## 登录（可选）

公开浏览、搜索、公开视频抽帧不需要登录。

需要个性化首页、关注动态、评论/回复时：

1. 打开 DSH Web → 设置 → 大肥鱼 → B 站。
2. 扫码登录。
3. Cookie 保存在 `~/.dsh-fish/owner.json`（0600）。

Cookie 属于私人凭据：

- 不进入公开仓库；
- 不写进 `.env.example`；
- 备份时放在加密的私有备份里。

## 配置

`~/.dsh-fish/config.json`：

```json
{
  "browse": {
    "enabled": true,
    "perDay": 1,
    "topN": 3,
    "rankingTids": 2,
    "deepRead": 3,
    "danmaku": 3,
    "keywords": ["游戏", "动画"],
    "window": null,
    "voices": true
  },
  "bili": {
    "enabled": true,
    "minIntervalMs": 800,
    "jitterMs": 500,
    "sub": true
  },
  "video": {
    "enabled": true,
    "perDay": 1,
    "frames": 9
  },
  "avoid": {
    "keywords": ["恐怖", "血腥", "鬼畜", "政治"],
    "upMids": [],
    "minDuration": 60
  }
}
```

- `perDay` 控制每天主动浏览几次。
- `minIntervalMs` / `jitterMs` 控制请求间隔，避免打扰上游。
- `avoid` 是不主动碰的题材和 UP 主。
- `video.frames` 是抽帧数量，默认 9。

## 抽帧与视觉

`bili_watch`：

1. 取视频信息和播放地址。
2. ffmpeg 按时间点抽帧。
3. 拼成一张 `sheet-<bvid>-<时间戳>-<随机>.png`，放在
   `~/.dsh-fish/media/`。
4. 返回给她，她用视觉能力看这张拼图。
5. 成功后写 `meta watched:<日期> <bvid> {json}` 与媒体索引记录。

同一 `bvid` + 同一组时间点再次请求时，补丁会命中缓存，不重复抽帧。
缓存图丢失或 SHA256 不符时视为未命中。

失败时降级为“只看文字”，不影响聊天。

## 字幕

`bili_sub`：

- 从字幕轨取句子，按标点拼成可读的整句。
- 默认给 3 句，带 `[mm:ss]` 时间点。
- 想继续读，把最后一句的时间填进 `from`，一次一页往后读。
- 支持 AI 字幕、人工字幕、未知来源；来源会标明。
- 支持 CID / 分 P；字幕轨使用协议相对 URL。
- 没有字幕就说没有，不拿几句硬凑总结。

## 长期媒体索引

`~/.dsh-fish/media/index.json`（0600）记录：

- `watchedEventId`：对应的 `watched:` 事件 id
- `bvid`、标题、UP、时长、播放量
- 观看日期、时间点
- 图片相对路径、SHA256、字节数
- 状态：`cached` / `missing` / `expired`

维护策略：

- 30 天 / 100MB，先删最旧的图。
- 图被删或丢失后，索引保留文字事实，`path` 清空，状态变 `expired`。
- `her_media` 只返回索引里的记录；图还在才给路径，不在就只说“曾经看过”。
- 不修改 `events.jsonl`，不生成 `watched` / `growth`。

详见 [memory.md](memory.md)。

## 主动材料

补丁让真实的 B 站经历进入主动回合：

- `watched:`（真看过画面）和 `looked:`（只看过文字）会成为主动材料。
- 同一条视频优先用 `watched:`，不重复算 `looked:`。
- `her_leave` 的 refs 可以指回这些记录。
- 安静浏览的 `browsed:` 不算“她自己的经历”，不进入材料。

这让她的主动留话能接上“昨天看过的那个视频”，而不是只复读聊天。

## 隐私

- B 站 Cookie、账号信息只在 `owner.json`，不公开。
- 媒体索引、图片、视频封面都在 `~/.dsh-fish/`，不公开。
- 公开仓库只有代码、补丁和模板。
- 备份时把 `.dsh-fish` 整体放进加密私有备份。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 首页是空的 | 是否登录；Cookie 是否过期 |
| 抽帧失败 | ffmpeg 是否存在；视频是否可访问 |
| 字幕没有 | 视频本身没有字幕轨；或需要登录 |
| 画面重复抽 | 时间点不同；缓存只命中完全相同的 bvid+at |
| `her_media` 说图不在 | 已过 30 天 / 100MB 清理；事实仍在，图不可读 |
| 请求太频繁 | 调大 `minIntervalMs` / `jitterMs` |

B 站接口可能变化。失败时工具会返回错误说明，她应当承认“没看到”，
而不是编造内容。
