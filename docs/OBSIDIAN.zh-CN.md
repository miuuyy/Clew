# Obsidian 导入和导出

[English](OBSIDIAN.md) · [简体中文](OBSIDIAN.zh-CN.md) · [Clew 使用指南](USAGE_GUIDE.zh-CN.md)

## 从 Obsidian 导入

打开 **创建图谱 → 从 Obsidian 导入**，选择仓库文件夹。Clew 会将 Markdown 笔记转换为主题，并从链接读取主题间的关系。可按需从笔记正文提取简介、保留正文为学习笔记、按文件夹划分分区，或为缺失的笔记创建占位主题。

填写图谱标题、学科和图谱语言。预览会显示主题、关系、分区的数量以及验证结果。若有错误，请根据提示修改笔记，再导入。

## 标注学习关系

普通链接使用导入对话框中选择的默认关系。若需要为单个链接指定关系，可在正文中加上标注：

```markdown
[[线性代数]]::requires
[[概率论]]::supports
[[词嵌入]]::bridges
```

可用的关系包括 `requires`（先修）、`supports`（支撑）、`bridges`（关联）、`extends`（扩展）和 `reviews`（复习）。在笔记开头的 YAML 元数据中，请为包含双链的字符串加上引号：

```yaml
---
mapmind_relations:
  - "[[线性代数]]::requires"
  - "[[概率论]]::supports"
---
```

当链接匹配多篇同名笔记时，请写明文件路径，例如 `[[数学/线性代数]]`。格式错误的 YAML 或重复的元数据键会在导入预览中报错。

## 导出到 Obsidian

打开图谱的 **导出图谱** 菜单，选择 **Obsidian 文件夹**。导出包含一份图谱概览和每个主题的 Markdown 文件，可选择包含学习进度、主题简介、资源与笔记，并按主分区组织目录。

桌面版会打开文件夹选择器。在选定的位置下，Clew 会创建一个新文件夹并写入完整的导出结果。若同名文件夹已存在，请选择其他位置。浏览器开发版需要浏览器支持直接写入文件夹。

图谱包中的 `mapmind_graph_export`、`mapmind_obsidian_export` 和 `mapmind_*` 字段是数据格式的一部分。
