// 원본 검사 기록(data/) 보호 훅 (PreToolUse)
// 등록: .claude/settings.json의 PreToolUse, matcher "Edit|Write|NotebookEdit|Bash|PowerShell", onFailure "block"
// 시험: node ../../hook-test.js protect-data.js (기본 13개), node ../../hook-test.js --strict protect-data.js (추가 시도 포함)
//
// 1판(Edit|Write만 검사)으로는 PowerShell·Python으로 덮어쓰는 길이 열려 있다. 이 파일은 그 길까지 막은 2판이다.
//
// 판단 규칙
// - 입력 JSON을 읽지 못하거나 입력이 비어 있으면 막는다(fail-closed). 원본은 한 번 덮어쓰면 되돌리기 어렵다.
// - 파일 도구(Edit, Write, MultiEdit, NotebookEdit)는 경로에 data 폴더가 있으면 막는다.
//   경로는 역슬래시, 대소문자, 따옴표, `.`과 `..`, 상대경로(입력의 cwd 기준), 이름 끝의 점과 공백을 정리한 뒤 본다.
// - 셸 명령(Bash, PowerShell)은 data/를 가리키면서 쓰기 동작(복사, 이동, 삭제, 저장, 리다이렉트, git 되돌리기)이 있으면 막는다.
// - 그 밖의 도구(Read, Glob, Grep 등)는 통과시킨다. 읽기는 원본을 바꾸지 않는다.
// - 결과는 종료 코드로 알린다. 0은 통과, 2는 차단이고 stderr가 Claude에게 이유로 전달된다.
//
// 한계
// - 완벽하지 않다: 변수에 경로를 나눠 담거나($p='da'+'ta'; Set-Content "$p\a.csv" x) 스크립트 파일 안에서 저장하면 명령 문자열에 data/가 보이지 않는다.
//   이 길은 settings.json의 Edit deny, 사람의 승인, git으로 원본 무변경을 확인하는 절차로 대비한다.
// - 너무 막기도 한다: 'cp data/a.xlsx out/'처럼 원본을 읽어 다른 곳에 복사하는 정상 작업도 막힌다.
//   다른 곳의 data 폴더(out/data/ 등)도 같이 막힌다. 어디까지 막을지는 팀이 정한다.
"use strict";

const STDIN_TIMEOUT_MS = 5000;
const FILE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const SHELL_TOOLS = /^(Bash|PowerShell)$/;

// data를 경로의 한 부분으로 가리키는가 (metadata/, database 같은 이름은 아님)
const touchesData = (s) => /(^|[\s"'\/=(,])data(\/|["'\s),]|$)/.test(s);

// 쓰기 동작. PowerShell 별칭(cpi, mi, ri, rni, sc, ac)과 Python 저장 함수까지 본다.
const WRITE_VERBS = new RegExp([
  "copy-item", "move-item", "remove-item", "rename-item", "set-content", "add-content", "clear-content", "out-file", "new-item",
  "export-csv", "export-excel",
  "\\b(cp|mv|rm|del|erase|ren|rmdir|rd|copy|move|xcopy|robocopy|cpi|mi|ri|rni|sc|ac|tee|truncate|dd)\\b",
  "\\bsed\\s+(-[a-z]*i|--in-place)",
  ">>?\\s*[\"']?(\\.\\/)?data\\/",
  "\\.save\\(", "to_excel", "to_csv", "\\.write_text\\(", "\\.write_bytes\\(", "writefile", "open\\([^)]*,\\s*[\"'][wax]",
  "git\\s+(checkout|restore|reset|clean|stash|rm|mv)\\b",
].join("|"));

function normalizePath(raw, cwd) {
  let p = String(raw).trim().replace(/^["']+|["']+$/g, "").replace(/\\/g, "/");
  if (!p) return "";
  const isAbsolute = /^[a-zA-Z]:(\/|$)/.test(p) || p.startsWith("/");
  if (!isAbsolute && cwd) p = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "") + "/" + p;
  let prefix = "";
  const drive = p.match(/^[a-zA-Z]:/);
  if (drive) {
    prefix = drive[0];
    p = p.slice(2);
  }
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    const clean = seg.split(":")[0].replace(/[. ]+$/, "");
    if (clean) out.push(clean);
  }
  return (prefix + "/" + out.join("/")).toLowerCase();
}

function finish(code, message) {
  if (!message) process.exit(code);
  process.stderr.write(message + "\n", () => process.exit(code));
}

function block(msg) {
  finish(2, msg + "\n다음 행동: 원본은 읽기만 합니다. 결과는 out/ 폴더에 새 파일로 만드세요. 원본을 꼭 고쳐야 하면 멈추고 사용자에게 승인 절차를 물으세요.");
}

function decide(raw) {
  const text = String(raw || "").replace(/^﻿/, "").trim();
  if (!text) return block("원본 보호: 훅 입력이 비어 있어 무엇을 하려는지 확인하지 못했습니다");
  let input;
  try {
    input = JSON.parse(text);
  } catch (e) {
    return block(`원본 보호: 훅 입력 JSON을 읽지 못했습니다 (${e.message})`);
  }
  const tool = String((input && input.tool_name) || "");
  const t = (input && typeof input.tool_input === "object" && input.tool_input) || {};

  // 파일 편집 도구. tool_name이 없는 수동 시험도 경로가 있으면 같은 기준으로 본다.
  const target = t.file_path ?? t.notebook_path;
  if ((FILE_TOOLS.test(tool) || (!tool && target)) && target) {
    const file = normalizePath(target, input.cwd || process.cwd());
    if (/(^|\/)data\//.test(file)) return block(`원본 보호: ${String(target).trim()} 는 읽기만 합니다`);
    return finish(0);
  }

  // 셸 명령. 따옴표 안의 역슬래시 경로도 슬래시로 바꿔서 본다.
  if (SHELL_TOOLS.test(tool) || (!tool && t.command)) {
    const cmd = String(t.command || "").replace(/\\/g, "/").toLowerCase();
    if (cmd && touchesData(cmd) && WRITE_VERBS.test(cmd)) return block(`원본 보호: data/ 를 바꾸는 명령은 막습니다 → ${t.command}`);
  }
  return finish(0);
}

if (process.stdin.isTTY) {
  finish(2, "사용법: 도구 호출 JSON을 표준 입력으로 넘깁니다. 시험은 hook-test.js로 합니다.");
} else {
  let raw = "";
  const timer = setTimeout(() => block(`원본 보호: ${STDIN_TIMEOUT_MS / 1000}초 안에 훅 입력이 끝나지 않았습니다`), STDIN_TIMEOUT_MS);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    clearTimeout(timer);
    decide(raw);
  });
  process.stdin.on("error", (e) => {
    clearTimeout(timer);
    block(`원본 보호: 훅 입력을 읽다가 오류가 났습니다 (${e.message})`);
  });
}
