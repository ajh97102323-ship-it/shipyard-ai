#!/usr/bin/env node
// 사내 QnA 게시판 MCP 서버 (stdio, 줄 단위 JSON-RPC 2.0, 외부 패키지 없음)
// 환경 변수 QNA_API: 게시판 주소 (예: http://localhost:3001)
'use strict';

const readline = require('node:readline');

// 비어 있거나 치환되지 않은 ${user_config.qna_api}가 오면 실습 기본값을 쓴다
const RAW_API = (process.env.QNA_API || '').trim();
const API = (RAW_API && !RAW_API.includes('${') ? RAW_API : 'http://localhost:3001').replace(/\/+$/, '');
const SERVER_INFO = { name: 'qna', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const TIMEOUT_MS = 10000;

const TOOLS = [
  {
    name: 'search_questions',
    description:
      '사내 기술 QnA 게시판에서 질문을 검색한다(제목, 본문, 호선 번호). ' +
      '검색어는 핵심 용어 1~3개로 짧게 쓴다(예: "선미 개정", "H2701 도면"). 단어를 모두 포함한 질문만 찾으므로 문장을 그대로 넣지 않는다. ' +
      '결과에는 질문 번호, 제목, 채택 여부, 링크만 있으므로 답하기 전에 get_question으로 원문을 읽는다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어. 핵심 용어 1~3개를 공백으로 구분 (100자 이하)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_question',
    description:
      '게시판 질문 하나의 원문(본문)과 답변 전체를 읽는다. 채택 답변이 먼저 나온다. ' +
      '답하기 전에 get_question으로 원문을 읽고, 채택 답변 내용만 근거로 삼는다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '질문 번호 (search_questions 결과의 번호)' },
      },
      required: ['id'],
    },
  },
];

// ---------- 게시판 호출 ----------

async function callBoard(path) {
  let res;
  try {
    res = await fetch(API + path, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`게시판에 연결하지 못했습니다 (${API}). 게시판 서버가 켜져 있는지, QNA_API 주소가 맞는지 확인하세요.`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`게시판 응답을 읽지 못했습니다 (HTTP ${res.status}).`);
  }
  if (!res.ok || body.error) {
    const e = body.error || {};
    const err = new Error(`${e.code || 'HTTP_' + res.status}: ${e.message || '요청 실패'}`);
    err.code = e.code;
    throw err;
  }
  return body.data;
}

const link = (id) => `${API}/q/${id}`;
const kst = (iso) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' KST';
};

async function searchQuestions(args) {
  const query = String(args?.query ?? '').trim();
  if (!query) throw new Error('query(검색어)가 비어 있습니다.');
  const data = await callBoard('/search?q=' + encodeURIComponent(query));
  const items = data.items || [];
  if (items.length === 0) {
    return (
      `결과 없음: "${query}"로 찾은 질문이 0건입니다. ` +
      '검색어를 더 짧게(핵심 용어 1~2개) 하거나 다른 용어로 바꿔 보세요. 게시판에 없는 내용을 지어내지 마세요.'
    );
  }
  const lines = items.map(
    (q) =>
      `- #${q.id} ${q.title} | ${q.dept}·${q.hullNo}·${q.stage} | 답변 ${q.answerCount}개, ` +
      `${q.hasAccepted ? '채택됨' : '채택 없음'} | ${link(q.id)}`
  );
  return (
    `"${query}" 검색 결과 ${items.length}건 (채택된 질문 먼저):\n` +
    lines.join('\n') +
    '\n\n답하기 전에 get_question으로 원문을 읽으세요.'
  );
}

async function getQuestion(args) {
  const id = Number(args?.id);
  if (!Number.isInteger(id) || id < 1) throw new Error('id는 1 이상의 정수여야 합니다.');
  let q;
  try {
    q = await callBoard('/questions/' + id);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return `결과 없음: ${id}번 질문이 게시판에 없습니다.`;
    throw err;
  }
  const answers = q.answers || [];
  const out = [
    `#${q.id} ${q.title}`,
    `링크: ${link(q.id)}`,
    `부서 ${q.dept} | 호선 ${q.hullNo} | 공정 ${q.stage} | 작성 ${q.authorName}, ${kst(q.createdAt)}`,
    '',
    '[질문 본문]',
    q.body,
    '',
  ];
  if (answers.length === 0) {
    out.push('[답변] 아직 답변이 없습니다.');
  } else {
    if (!answers.some((a) => a.accepted)) out.push('※ 채택된 답변이 없습니다. 아래 답변은 모두 채택되지 않은 답변입니다.', '');
    answers.forEach((a, i) => {
      out.push(
        `[답변 ${i + 1}${a.accepted ? ' - 채택됨' : ' - 채택 안 됨'}] ${a.authorName}, ${kst(a.createdAt)}`,
        a.body,
        ''
      );
    });
  }
  return out.join('\n').trimEnd();
}

const HANDLERS = { search_questions: searchQuestions, get_question: getQuestion };

// ---------- JSON-RPC ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const fn = HANDLERS[name];
      if (!fn) return fail(id, -32602, `알 수 없는 도구: ${name}`);
      try {
        const text = await fn(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        return reply(id, { content: [{ type: 'text', text: `게시판 조회 실패: ${err.message}` }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return; // 알림은 응답하지 않음
      if (isRequest) return fail(id, -32601, `지원하지 않는 메서드: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'JSON 파싱 오류');
  }
  handle(msg).catch((err) => {
    if (msg.id !== undefined) fail(msg.id, -32603, err.message);
  });
});
// stdin이 닫히면 남은 응답을 보낸 뒤 자연스럽게 종료된다.
