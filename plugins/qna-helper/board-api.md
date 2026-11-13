# API 목록

JSON API는 모두 `{ data, error }`로 답합니다. 오류 코드는 [errors.md](./errors.md), 요청과 응답 필드는 `specs/001-qna-board/contracts/`에 있습니다.
시각은 UTC ISO 8601 문자열입니다. 화면에서만 KST로 바꿉니다.

## JSON API

| 메서드 | 경로 | 로그인 | 설명 | 성공 | 주요 실패 | 테스트 |
|---|---|---|---|---|---|---|
| GET | `/health` | - | 서버 상태 | 200 | | `test/routes/health.test.js` |
| POST | `/login` | - | 사번 6자리 + 이름으로 로그인, 서명 쿠키 발급 | 200 | 400 | `test/routes/auth.test.js` |
| POST | `/logout` | - | 쿠키 삭제 | 200 | | `test/routes/auth.test.js` |
| GET | `/questions` | - | 질문 목록, 최신순 50개. `?status=unanswered`(답변 0개, 오래된 순), `?dept=`(설계, 생산, 품질, 안전 중 하나) | 200 | 400 | `test/routes/questions.test.js` |
| POST | `/questions` | 필요 | 질문 등록 (제목, 본문, 부서, 호선, 공정 단계) | 201 | 400, 401 | `test/routes/questions.test.js` |
| GET | `/questions/:id` | - | 질문 상세와 답변 목록, `canAccept` | 200 | 404 | `test/routes/questions.test.js` |
| POST | `/questions/:id/answers` | 필요 | 답변 등록 | 201 | 400, 401, 404 | `test/routes/answers.test.js` |
| POST | `/answers/:id/accept` | 필요 | 답변 채택 또는 채택 변경. 질문 작성자, 관리자만 | 200 | 401, 403, 404 | `test/routes/answers.test.js` |
| GET | `/search?q=` | - | 제목, 본문, 호선 검색. 채택 질문 먼저 | 200 | 400 | `test/routes/search.test.js` |
| GET | `/tags` | - | 호선, 공정 단계별 질문 수. `?kind=hull\|stage` | 200 | 400 | `test/routes/tags.test.js` |

## 화면 (EJS)

| 메서드 | 경로 | 로그인 | 설명 |
|---|---|---|---|
| GET | `/` | - | 질문 목록, 검색(`?q=`), 태그 개수 |
| GET | `/unanswered` | - | 답변 대기 목록, 부서 필터(`?dept=`). 002 기능 |
| GET | `/login` | - | 로그인 폼 (`?next=`로 돌아갈 경로) |
| GET | `/ask` | 필요 | 질문하기 폼. 비로그인이면 `/login`으로 이동 |
| POST | `/ask` | 필요 | 질문 등록 후 상세로 303 이동 |
| GET | `/q/:id` | - | 질문 상세, 답변 폼, 채택 버튼(작성자, 관리자) |
| POST | `/q/:id/answers` | 필요 | 답변 등록 후 상세로 303 이동 |
| POST | `/q/:id/accept` | 필요 | 폼의 `answerId`를 채택. 권한 없으면 403 화면 |

화면 테스트는 `test/routes/pages.test.js`에 있습니다.
