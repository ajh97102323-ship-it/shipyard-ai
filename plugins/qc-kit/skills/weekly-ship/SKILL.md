---
name: weekly-ship
description: 주간 품질 보고를 계획(docs/plan.md) → 집계 → 감사 → (반려 시 재집계, 최대 2회) → 회의 문장 세 줄 순서로 만든다. "/qc-kit:weekly-ship 11/16~11/22"처럼 기간을 인자로 받는다.
argument-hint: "<기간 예: 11/16~11/22>"
---
인자 `$ARGUMENTS`가 보고 기간이다. 비어 있거나 기간 형식(예: 11/16~11/22)이 아니면 묻고 멈춘다. 순서를 지킨다.

이 스킬은 현재 작업 폴더의 `data/`, `SPEC.md`를 읽고 `docs/`, `out/`에 쓴다. 에이전트는 이 플러그인의 `qc-kit:planner`, `qc-kit:qc-aggregator`, `qc-kit:qc-auditor`, `qc-kit:qc-writer`다.

0. **계획**: `qc-kit:planner`에게 기간과 data/ 위치를 주고 `docs/plan.md`를 만들게 한다. 마지막 줄이 `진행 가능: 아니오`면 멈추고, plan.md의 질문(SPEC.md 없음, 사람이 정할 항목)을 사용자에게 그대로 알려 승인이나 답을 받는다. 사용자가 임시 규칙으로 진행하라고 답하면 그 답을 plan.md 아래에 덧붙이고 1단계로 간다.
1. **집계**: `qc-kit:qc-aggregator`에게 기간, data/ 위치, `docs/plan.md`를 주고 `out/summary.xlsx`, `out/summary-notes.md`를 만들게 한다.
2. **감사**: `qc-kit:qc-auditor`에게 out/summary.xlsx를 감사시킨다. 감사관은 파일을 쓰지 못하므로 결과(지적 전문과 마지막 줄 판정)를 받아 메인 대화가 `out/review.md`에 시도 횟수와 함께 덧붙여 저장한다.
3. **판정 분기**:
   - `판정: 통과` → 4단계로.
   - `판정: 반려` → 지적 전문을 `qc-kit:qc-aggregator`에게 넘겨 재집계(1단계)한 뒤 다시 감사한다. 재집계는 최대 2회다. 2회 뒤에도 반려면 멈추고 남은 지적과 함께 사람에게 넘긴다. 문장을 쓰지 않는다.
4. **문장**: `qc-kit:qc-writer`에게 `out/meeting.md`에 세 줄을 쓰게 한다.
5. **보고**: 사용자에게 최종 판정, 반려·재집계 횟수, 세 줄, "사람 확인 필요" 항목을 알린다. plan.md의 위치도 알린다.

규칙: data/ 원본은 어느 단계에서도 수정하지 않는다. 감사관의 지적은 임의로 걸러 내지 않고 review.md에 모두 남긴다.
