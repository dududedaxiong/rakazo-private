# Agent Note: 语音对话的轮次检测：本机 VAD + Smart-Turn

Status: proposed

## Problem

网页 / App 的语音实时对话一直暂缓，其中一个难点是轮次检测：什么时候算用户说完了、该模型接话。靠服务端等静音超时会卡（首字 60s、断流 30s 是聊天用的阈值，不适合语音对话）；靠云端 ASR 流式识别又多一跳、还得多花钱。

## Proposal

借鉴 dsh-Go 的做法，轮次检测放本机做（只定设计，不定实现）：

- **VAD**：Silero VAD（ONNX，16kHz，512 采样帧）判断有没有人在说话，单线程跑在手机上。
- **Smart-Turn**：Smart-Turn v3.2（ONNX，输入为 Whisper mel 80x800）判断这句话说完了没有。
- 录音为 16kHz 单声道 PCM16 WAV，整段录完再送识别（DeepSeek ASR / OpenAI 兼容 `/audio/transcriptions` / 引擎自带语音模型三选一，按配置回退）；识别是整段出结果，不边说边出。
- 单麦克风仲裁：同一时间只有一个语音功能占麦，别的先停。

实现路径按省事程度排：**服务端 VAD**（onnxruntime-node 跑在服务端，一处实现、网页和 App 都能用；要补一条音频流通道，现在语音输入是整段文件上传）→ **网页 WASM**（onnxruntime-web + getUserMedia，纯前端、原型最快）→ **App 本机**（onnxruntime-react-native 有官方包，Expo 走 prebuild + config plugin 能接；难点在 Expo 里拿实时 PCM 音频流，现在按住说话是录完整段再发）。模型本身不用训，是现成的 ONNX 文件；难在音频管道和阈值调参，不在模型。

只借鉴设计，不搬代码（AGPL-3.0）。

## Alternatives considered

- **服务端静音超时切轮次** — 实现最简单；但延迟大、误切多，语音对话体验差。
- **云端流式 ASR 边说边识别** — 实时性好；但多一跳、按量计费，且识别服务本身要稳定。
- **系统语音识别（Android SpeechRecognizer）** — 零成本、带 partial 结果；但依赖厂商服务、行为不可控，只适合语音输入，不适合通话。

## Acceptance criteria

- 用户说完后，模型在可感知的短时间内接话，不靠固定超时硬等。
- 安静时不误触发，嘈杂时不把半句话切成两段。
- 麦克风同一时间只被一个功能占用。

## Risks

- 本机 ONNX 模型要进 App 包，体积与耗电要评估。
- Smart-Turn 对中文的切分效果需实测，不能默认和英文一样准。
- 整段识别意味着通话里仍有「录完再识别」的延迟，实时性不如流式。
