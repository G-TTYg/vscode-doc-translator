# ADR 2026-07-13：共享 Core 与 Sidecar Cache

状态：Accepted
日期：2026-07-13

## 背景

项目需要支持 VS Code 插件流程，还需要接入多个翻译服务、多个文档格式，并让翻译产物可复用、可校验、可安全打开。

如果把 VS Code UI、provider、格式解析和缓存处理都写在一个入口里，后续行为很容易分叉。缓存命名和新鲜度规则也是用户可感知的产品契约，应从一开始就稳定。

## 决策

使用共享 TypeScript translation core，由 VS Code extension 调用。core 负责翻译流程、format adapter、provider adapter 和 metadata/cache store；VS Code extension 负责命令、菜单、设置面板、SecretStorage、状态栏和打开译文。

Provider 集成隐藏在 provider adapter interface 后面。文档解析与重建隐藏在 format adapter interface 后面。Metadata/cache 操作隐藏在 metadata store interface 后面。

传统机器翻译 provider 使用 `segmented-units` 请求：格式适配器抽取段落或语义块，provider 返回对应译文。OpenAI-compatible LLM provider 使用 `ordered-json-context` 请求：模型拿到按原文顺序排列、带稳定 id 的全文 JSON 上下文，但必须返回扁平 JSON 译文列表。最终文件重建始终由格式适配器完成。

每次完成翻译后写入两类产物：

1. 源文件同目录下的可见译文文档：

   ```text
   <sourceBase>.auto.<targetLanguage>.<timestamp><sourceExtension>
   ```

2. 源文件同目录 `.vscode-doc-translator-cache/` 下的隐藏 metadata JSON：

   ```text
   <sourceBase>.auto.<targetLanguage>.<timestamp>.src-<sourceHash8>.dst-<translatedHash8>.meta.json
   ```

新鲜度和覆盖安全都通过 metadata 中的完整 SHA-256 hash 判断。

## 备选方案

1. 把翻译流程直接写在 VS Code extension 层。
   - 优点：最快做出 UI demo。
   - 缺点：provider、格式重建和 cache 规则会被 UI 细节耦合，后续维护成本更高。

2. 把整份文件直接发给翻译服务，并让 provider 输出最终文件。
   - 优点：流程最简单。
   - 缺点：很容易破坏 Markdown、代码块、frontmatter、URL、placeholder 和机器可读内容；LLM 也更容易漏段、改格式或生成不可校验的最终文档。

3. 把译文也放进隐藏 cache 目录。
   - 优点：源目录更清爽。
   - 缺点：用户希望译文像普通文档一样在原文旁边被 VS Code 打开；隐藏输出会降低可发现性。

4. 把 metadata 放进 workspace 中央缓存。
   - 优点：源目录里更少文件。
   - 缺点：可移植性差；单独看译文 artifact 时更难判断它来自哪个源文件和哪个版本。

## 后果

### 正面

- VS Code 插件通过 core 获得稳定的翻译、缓存和格式重建行为。
- Provider 和格式支持可以独立增长。
- 输出文件对用户可见，并清楚标记为自动翻译。
- Metadata sidecar 让源文档 stale 检测和译文编辑检测直接可靠。
- 传统 MT 和 AI/LLM 的请求形态不同，但都回到同一个 unit-id-based 重建流程。
- 同目录产物可随源目录一起移动。

### 负面 / 权衡

- 共享 core 比插件原型需要更多前期结构。
- 同目录译文文件仍然会增加可见文件，虽然命名能降低混淆。
- 隐藏 sidecar metadata 是额外需要维护的 artifact。
- 部分文件类型需要真实 parser 后才能承诺格式保真。

### 后续

- 决定第一批 provider 实现顺序。
- 决定 segment-level cache 是否默认保存译文文本，还是 opt-in。
- 决定是否在后续提供“译文也隐藏输出”的可选设置；MVP 默认让译文可见地放在源文件旁。
- 继续保持 TypeScript package layout 中 extension、core、provider、format 和 persistence 边界清晰。

## 参考

- `docs/design.md`
- `docs/architecture.md`
- `logs/2026-07-13.md`
