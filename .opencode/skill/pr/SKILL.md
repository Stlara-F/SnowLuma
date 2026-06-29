---
name: pr
description: >-
  创建或更新 Pull Request 时使用。验证 diff 合理性、行尾一致性、
  使用 `.github/pull_request_template.md` 生成 body，然后提交。
  Use ONLY when the user asks to create or update a PR on GitHub.
---

## 规则

1. **Diff 合理性验证**：`git diff origin/dev..HEAD --stat` 的 +/- 行数不得出现整文件替换。
   如果某文件的 additions + deletions 接近该文件总行数 → 拒绝提交，改用 `git push` 而非 Git Data API。
2. **行尾一致性**：`git ls-files --eol | Select-String 'w/eol=crlf'` 应为空。
   若检出 CRLF → 执行 `git add --renormalize .` 修复后再提交。
3. **lockfile 一致性**：`pnpm-lock.yaml` 的变更必须与 `package.json` 的依赖变更匹配。
   如果 `package.json` 新增了依赖但 lockfile 无对应变更 → 拒绝，要求先执行 `pnpm install`。
4. **PR body**：使用 `.github/pull_request_template.md` 格式，将 `<!-- ... -->` 注释替换为实际内容。
   无乱码、无英文（代码引用和标识符除外）。
5. **提交方式**：优先使用 `git push`（保留正确 blob SHA）。
   仅当 `git push` 网络不可达时，才回退到 Git Data API 方式，并在提交后验证 diff stat。

## 步骤

### 第 1 步：Diff 验证
```powershell
git diff origin/dev..HEAD --stat
```
检查每个文件的 additions + deletions 之和不超过该文件实际行数的 1.2 倍。
若超限 → 说明整文件被替换，阻止提交。

### 第 2 步：行尾检查
```powershell
git ls-files --eol | Select-String 'w/eol=crlf'
```
若有输出 → `git add --renormalize .` 修复。

### 第 3 步：类型检查 + Lint
```powershell
pnpm typecheck
pnpm lint
```

### 第 4 步：生成 PR body
读取 `.github/pull_request_template.md`，填充内容。

### 第 5 步：提交
```powershell
git push origin <branch> --force
gh pr create --base dev --head <branch> --title "<title>" --body-file <body-file>
```
