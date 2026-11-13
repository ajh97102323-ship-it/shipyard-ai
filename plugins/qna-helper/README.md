# qna-helper

사내 기술 QnA 게시판을 찾아 근거와 링크를 붙여 답하는 Claude Code 플러그인입니다.

## 구성

- `server/qna-mcp.js`: 게시판 API를 부르는 MCP 서버 (stdio, 외부 패키지 없음, Node 22 이상)
  - `search_questions(query)`: `GET /search?q=`
  - `get_question(id)`: `GET /questions/:id`
- `skills/ask/SKILL.md`: 게시판만 근거로 답하고, 없으면 없다고 말하는 규칙
- `.mcp.json`: 플러그인이 켜지면 `node ${CLAUDE_PLUGIN_ROOT}/server/qna-mcp.js`로 서버를 띄움
- `.claude-plugin/plugin.json`: 설치할 때 게시판 주소(`qna_api`)를 묻습니다
- `board-api.md`: 게시판 API 문서

## 설치

```powershell
/plugin install qna-helper@<마켓플레이스 이름>
```

게시판 주소를 나중에 넣거나 바꾸려면 `/plugin configure qna-helper@<마켓플레이스 이름>`. 주소가 비어 있으면 `http://localhost:3001`을 씁니다.

## 시험

플러그인 폴더 **밖**에서 엽니다(안에서 열면 루트의 `.mcp.json`이 프로젝트 서버로 따로 읽힙니다).

```powershell
cd C:\work
claude --plugin-dir C:\work\qna-helper
```

`/mcp`에서 `plugin:qna-helper:qna`가 connected인지 보고, `판정질문.md`의 질문을 물어봅니다. 스킬 실행을 물으면 Yes를 누릅니다.

## 막히면

| 증상 | 확인할 것 |
|---|---|
| `/mcp`에 qna가 failed | `node` 경로, 게시판 주소 |
| 답에 "게시판 조회 실패" | 게시판 서버가 켜져 있는지, `/plugin configure`로 주소 확인 |
| 같은 도구가 두 번 보임 | `claude mcp add`로 붙인 연결이 남음 → `claude mcp remove qna` |

## 회사에서 쓸 때

관리자 설정의 MCP 허용 목록(`allowedMcpServers`)에 이 서버 명령이 있어야 합니다. 게시판에 로그인이 필요해지면 토큰은 `userConfig`에 `"sensitive": true`로 받고 파일에 쓰지 않습니다.
