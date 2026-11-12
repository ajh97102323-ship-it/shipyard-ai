#!/usr/bin/env node
// PreToolUse hook: data/ 아래 원본 파일의 수정을 차단한다.
//  - Write / Edit / NotebookEdit : file_path 가 data/ 안이면 차단
//  - Bash / PowerShell           : data/ 를 가리키면서 쓰기 동작이 있는 명령이면 차단
//                                  (명령이 실행하는 .py/.js/.ps1/.sh 파일 내용도 함께 검사)
// 읽기 전용 명령(열람, 목록, 읽기 모드 분석)은 통과시킨다.
const fs = require("fs");
const path = require("path");

const FILE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

// data/ 또는 data\ 경로 (metadata/ 같은 이름은 제외) + data 폴더 안 원본 파일명
const DATA_REF = /(^|[^A-Za-z0-9_])data[\\/]|(조립팀|품질팀)_[^\s"'`]*검사기록\.xlsx/i;

// 쓰기/삭제/이동/변환 동작을 나타내는 패턴
const WRITE_OP = new RegExp(
  [
    ">",                                   // 리다이렉션 (아래에서 무해한 형태는 먼저 제거)
    "\\btee\\b",
    "Set-Content", "Add-Content", "Out-File", "Clear-Content",
    "Remove-Item", "Copy-Item", "Move-Item", "Rename-Item", "New-Item", "Set-ItemProperty",
    "\\b(rm|rmdir|del|erase|mv|move|cp|copy|ren|rename|touch|truncate|xcopy|robocopy|attrib|icacls|chmod|dd)\\b",
    "sed\\s+(-[A-Za-z]*i|--in-place)",
    "\\.save\\s*\\(", "\\.save_as", "SaveAs", "SaveCopyAs",
    "to_excel", "to_csv", "to_parquet", "ExcelWriter",
    "\\.write\\w*\\s*\\(", "write_text", "write_bytes", "writeFile", "writeFileSync", "appendFile",
    "WriteAllText", "WriteAllBytes", "WriteAllLines",
    "open\\s*\\([^)]*,\\s*['\"][^'\"]*[wax+]",
    "Compress-Archive", "Expand-Archive", "git\\s+(checkout|restore|apply|stash|clean|mv|rm)",
  ].join("|"),
  "i"
);

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

// 2>&1, >/dev/null, >$null 처럼 파일을 바꾸지 않는 리다이렉션은 제거
function stripHarmlessRedirects(s) {
  return s
    .replace(/\d*>&\d+/g, " ")
    .replace(/\d*>>?\s*(\/dev\/null|\$null|NUL)\b/gi, " ");
}

function looksLikeWrite(text) {
  return WRITE_OP.test(stripHarmlessRedirects(text));
}

// 명령에 나온 스크립트 파일(.py/.js/.mjs/.ps1/.sh) 내용을 읽어 온다
function referencedScripts(cmd, baseDir) {
  const out = [];
  const re = /["']?([^\s"'|;&<>]+\.(?:py|js|mjs|cjs|ps1|sh))["']?/gi;
  let m;
  while ((m = re.exec(cmd))) {
    try {
      const p = path.resolve(baseDir, m[1]);
      const st = fs.statSync(p);
      if (st.isFile() && st.size < 512 * 1024) out.push({ p, text: fs.readFileSync(p, "utf8") });
    } catch {
      /* 없는 파일은 무시 */
    }
  }
  return out;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    process.exit(0); // 입력을 해석할 수 없으면 개입하지 않는다
  }

  const tool = input.tool_name;
  const ti = input.tool_input || {};
  const cwd = path.resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || cwd);
  const dataDir = path.join(projectDir, "data");
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

  if (FILE_TOOLS.has(tool)) {
    const target = ti.file_path || ti.notebook_path;
    if (!target) process.exit(0);
    const abs = path.resolve(cwd, target);
    const rel = path.relative(norm(dataDir), norm(abs));
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      deny("data/ 아래 파일은 원본 검사 기록이라 편집할 수 없습니다: " + abs);
    }
    process.exit(0);
  }

  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(ti.command || "");
    if (!cmd) process.exit(0);

    // 1) 명령 자체가 data/ 를 가리키면서 쓰기 동작을 포함
    if (DATA_REF.test(cmd) && looksLikeWrite(cmd)) {
      deny("data/ 아래 원본 파일을 수정할 수 있는 명령이라 차단했습니다. 읽기 전용 명령만 허용됩니다.");
    }
    // 2) 실행하는 스크립트 파일이 data/ 를 가리키면서 쓰기 동작을 포함
    for (const s of referencedScripts(cmd, cwd)) {
      if (DATA_REF.test(s.text) && looksLikeWrite(s.text)) {
        deny("실행하려는 스크립트(" + s.p + ")가 data/ 아래 원본 파일을 수정할 수 있어 차단했습니다.");
      }
    }
  }
  process.exit(0);
});
