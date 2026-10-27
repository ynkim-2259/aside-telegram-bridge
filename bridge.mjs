// Telegram -> Aside CLI 실시간 브리지 v2
// - 롱폴링으로 바로 받고 `aside "<지시>"`로 작업 시작, 끝나면 결과를 텔레그램으로 회신
// - 메뉴바 앱(Aside 텔레그램.app)과 파일로 통신: status.json(상태), history.jsonl(기록), control.json(조작)
// - 결과 메시지에 "답장"하면 같은 Aside 세션에서 이어서 처리
// - 이 파일이 바뀌면 스스로 종료해서 launchd가 새 버전으로 다시 띄움
import { readFile, writeFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

// 경로는 환경변수로 바꿀 수 있음. 기본값은 Aside 계정 폴더(~/.aside/u/0)
const HOME0 = process.env.HOME || '';
const BASE = process.env.ASIDE_ACCOUNT_DIR || `${HOME0}/.aside/u/0`;
const SECRET = process.env.TG_BRIDGE_CONFIG || `${BASE}/secrets/telegram-bot.json`;
const DIR = process.env.TG_BRIDGE_DIR || dirname(new URL(import.meta.url).pathname);
const STATE = `${DIR}/state.json`;
const LOG = `${DIR}/bridge.log`;
const STATUS = `${DIR}/status.json`;
const HISTORY = `${DIR}/history.jsonl`;
const CONTROL = `${DIR}/control.json`;
const SESSMAP = `${DIR}/session-map.json`;
const SELF = new URL(import.meta.url).pathname;
const HOME = HOME0;
const whichAside = (() => { try { return execSync('command -v aside', { shell: '/bin/zsh', encoding: 'utf8' }).trim(); } catch { return ''; } })();
const asideBin = [process.env.ASIDE_BIN, `${BASE}/data/aside-cli/bin/aside`, `${HOME}/.aside/bin/aside`, `${HOME}/.local/bin/aside`, whichAside]
  .filter(Boolean).find((p) => existsSync(p));

const cfg = JSON.parse(await readFile(SECRET, 'utf8'));
const API = `https://api.telegram.org/bot${cfg.token}`;
await mkdir(DIR, { recursive: true });
const selfMtime = (await stat(SELF)).mtimeMs;

const now = () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const log = (...a) => appendFile(LOG, `[${now()}] ${a.join(' ')}\n`).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };

let control = { paused: false, maxParallel: 2, timeoutMin: 60, killAll: 0 };
const loadControl = async () => { control = { ...control, ...(await readJson(CONTROL, {})) }; };
let lastKillAll = (await readJson(CONTROL, {})).killAll || 0;

const tasks = new Map(); // id -> {text, started, child, sessionId}
const queue = [];
let lastPollAt = null, lastError = null, taskSeq = 0;

async function writeStatus() {
  const s = {
    pid: process.pid, updatedAt: Date.now(), paused: control.paused, lastPollAt, lastError, aside: asideBin || null,
    running: [...tasks.values()].map((t) => ({ id: t.id, text: t.text.slice(0, 60), started: t.started, sessionId: t.sessionId || null })),
    queued: queue.map((q) => q.text.slice(0, 60)),
  };
  await writeFile(STATUS, JSON.stringify(s, null, 2)).catch(() => {});
}

async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(70000) });
  return r.json();
}
async function reply(text, extra = {}) {
  const t = String(text || '(빈 결과)');
  let last = null;
  for (let i = 0; i < t.length; i += 3800) {
    let r = await tg('sendRichMessage', { chat_id: cfg.owner_chat_id, rich_message: { markdown: t.slice(i, i + 3800) }, ...extra }).catch((e) => ({ ok: false, description: e.message }));
    if (!r.ok) r = await tg('sendMessage', { chat_id: cfg.owner_chat_id, text: t.slice(i, i + 3800), disable_web_page_preview: true, ...extra }).catch((e) => ({ ok: false, description: e.message }));
    if (!r.ok) await log('sendMessage 실패', r.description); else last = r.result.message_id;
  }
  return last;
}

const PHOTO_CMD = `S=${SECRET}; TOKEN=$(python3 -c "import json;print(json.load(open('$S'))['token'])"); CHAT=$(python3 -c "import json;print(json.load(open('$S'))['owner_chat_id'])"); curl -s -F chat_id=$CHAT -F caption="설명" -F photo=@파일경로 "https://api.telegram.org/bot$TOKEN/sendPhoto"`;
function buildPrompt(text, cont, id) {
  const body = String(text).split('\n').map((l) => (l.trim() ? '    ' + l : '')).join('\n');
  return [
    cont ? `[텔레그램 이어서 #${id}]` : `[텔레그램 #${id}]`,
    '',
    '요청:',
    body,
    '',
    '답변 방법:',
    '    - 짧게',
    '    - 형식: 첫 줄에 결론 한 문장, 그다음 **굵은 라벨:** 붙은 - 목록 (필요하면 1. 번호 목록, ## 소제목). 마크다운 그대로 쓰면 텔레그램에서 서식으로 보임',
    `    - 끝나면 최종 답을 텔레그램으로 직접 전송: bash ${DIR}/tg.sh ${id} <<'EOF' ... EOF`,
    `    - 사진: bash ${DIR}/tg.sh ${id} <파일> "설명"`,
    '    - 여기 답에는 "텔레그램 전송함 (#번호)" 아래에 보낸 내용을 그대로',
    '    - 도구 title은 한국어로 짧게 (텔레그램 진행 표시 둘째 줄에 그대로 보임)',
  ].join('\n');
}

// 에이전트가 tg.sh로 직접 보낸 글 (이 작업 번호, 시작 이후)
async function agentSent(id, since) {
  try {
    return (await readFile(`${DIR}/agent-sent.jsonl`, 'utf8')).split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.task === id && r.at >= since);
  } catch { return []; }
}

// 세션 기록(messages.jsonl)에서 마지막 답변 글만 꺼냄. 생각/도구 로그는 버림
async function finalAnswer(sessionId) {
  if (!sessionId) return null;
  try {
    const { readdir } = await import('node:fs/promises');
    const d = (await readdir(`${BASE}/sessions`)).filter((n) => n.endsWith(`_${sessionId}`)).sort().pop();
    if (!d) return null;
    const rows = (await readFile(`${BASE}/sessions/${d}/messages.jsonl`, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.role === 'user') break;
      if (r.role !== 'assistant' || !Array.isArray(r.content)) continue;
      const txt = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (txt) return txt.replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
    }
  } catch {}
  return null;
}

// 기다리는 동안 "⏳ Working · 1m 34s · 16 steps" + 둘째 줄에 지금 하는 단계(도구 title)를 띄움
// 세션 기록(messages.jsonl)에서 새로 붙은 줄만 읽어 도구 호출 수와 마지막 title을 셈. 5초마다 갱신
// 개인 채팅 수정 제한 실측(10/26): 1초 간격 40회, 0.5초 간격 40회, 연속 60회(약 2.3회/초) 모두 429 없음. 공식 권장은 채팅당 초당 1회. 10/26 사용자 요청으로 5초마다 갱신(입력 중 표시도 5초마다)
const fmtEl = (ms) => { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); return m < 1 ? `${s}초` : `${m}분 ${String(s % 60).padStart(2, '0')}초`; };
const TOOL_KO = { read_file: '파일 읽기', memory_search: '기억 찾기', history_search: '방문 기록 찾기', websearch: '웹 검색', webfetch: '웹 페이지 읽기',
  write_file: '파일 쓰기', edit_file: '파일 수정', write_todos: '할 일 정리', subagent: '보조 작업 실행', subagent_wait: '보조 작업 기다리는 중', get_time: '시간 확인',
  notification: '알림 보내기', search_tools: '도구 찾기', routine_update: '루틴 수정', bash: '명령 실행', repl: '브라우저 작업', bash_interact: '명령 실행' };
async function sessionFile(sessionId) {
  try {
    const { readdir } = await import('node:fs/promises');
    const d = (await readdir(`${BASE}/sessions`)).filter((n) => n.endsWith(`_${sessionId}`)).sort().pop();
    return d ? `${BASE}/sessions/${d}/messages.jsonl` : null;
  } catch { return null; }
}
async function scanProgress(t) {
  if (!t.sessionId) return;
  const pr = t.prog;
  if (!pr.file || pr.sid !== t.sessionId) {
    const f = await sessionFile(t.sessionId); if (!f) return;
    pr.file = f; pr.sid = t.sessionId;
    // 이어서 작업이면 예전 대화는 건너뛰고 지금 크기부터 읽음
    pr.offset = t.resumed ? (await stat(f).catch(() => ({ size: 0 }))).size : 0; pr.rest = '';
  }
  const { open } = await import('node:fs/promises');
  let fh;
  try {
    fh = await open(pr.file, 'r');
    const { size } = await fh.stat();
    if (size <= pr.offset) return;
    const len = Math.min(size - pr.offset, 8 * 1024 * 1024);
    const buf = Buffer.alloc(len); await fh.read(buf, 0, len, pr.offset); pr.offset += len;
    const lines = (pr.rest + buf.toString('utf8')).split('\n'); pr.rest = lines.pop();
    for (const l of lines) {
      if (!l.includes('"toolCall"') && !l.includes('"role":"user"')) continue;
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (r.role === 'user') { pr.steps = 0; pr.label = ''; continue; }
      if (r.role !== 'assistant' || !Array.isArray(r.content)) continue;
      for (const c of r.content) {
        if (c.type !== 'toolCall') continue;
        pr.steps++;
        const a = c.arguments || {};
        pr.label = String(a.title || a.description || TOOL_KO[String(c.name).toLowerCase()] || c.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }
    }
  } catch {} finally { await fh?.close().catch(() => {}); }
}
const progText = (t, head) => {
  const p = t.prog; const st = p.steps ? ` · ${p.steps} step${p.steps > 1 ? 's' : ''}` : '';
  return `${head} · ${fmtEl(Date.now() - t.started)}${st}${p.label ? '\n' + p.label : ''}`;
};
async function startTicker(t, cont) {
  t.resumed = cont; t.prog = { steps: 0, label: '' };
  const head = cont ? '⏳ Working (이어서)' : '⏳ Working';
  const r = await tg('sendMessage', { chat_id: cfg.owner_chat_id, text: `${head} · 0초\n시작하는 중`, disable_notification: true }).catch(() => null);
  t.statusMsgId = r?.ok ? r.result.message_id : null;
  tg('sendChatAction', { chat_id: cfg.owner_chat_id, action: 'typing' }).catch(() => {});
  let busy = false, holdUntil = 0, lastText = '';
  t.ticker = setInterval(async () => {
    if (t.finishing) return;
    tg('sendChatAction', { chat_id: cfg.owner_chat_id, action: 'typing' }).catch(() => {});
    if (!t.statusMsgId || busy || Date.now() < holdUntil) return;
    busy = true;
    try {
      await scanProgress(t);
      if (t.finishing) return;
      const text = progText(t, head);
      if (text === lastText) return;
      const e = await tg('editMessageText', { chat_id: cfg.owner_chat_id, message_id: t.statusMsgId, text });
      if (e?.ok) lastText = text;
      else if (e?.error_code === 429) holdUntil = Date.now() + ((e.parameters?.retry_after || 3) * 1000);
    } catch {} finally { busy = false; }
  }, 5000);
}
async function stopTicker(t, status) {
  clearInterval(t.ticker);
  if (!t.statusMsgId) return;
  await scanProgress(t).catch(() => {});
  const label = { done: '✅ 완료', stopped: '⏹ 중지됨', timeout: '⌛ 시간 초과', error: '⚠️ 오류' }[status] || status;
  const p = t.prog || {}; const st = p.steps ? ` · ${p.steps} step${p.steps > 1 ? 's' : ''}` : '';
  await tg('editMessageText', { chat_id: cfg.owner_chat_id, message_id: t.statusMsgId, text: `${label} · ${fmtEl(Date.now() - t.started)}${st}` }).catch(() => {});
}

async function rememberSession(botMsgId, sessionId) {
  if (!botMsgId || !sessionId) return;
  const m = await readJson(SESSMAP, {});
  m[botMsgId] = sessionId;
  const keys = Object.keys(m); if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete m[k];
  await writeFile(SESSMAP, JSON.stringify(m)).catch(() => {});
}

function runTask(job) {
  if (!asideBin) { reply('맥에서 aside CLI를 찾지 못했어요.'); return; }
  const id = ++taskSeq;
  const t = { id, text: job.text, started: Date.now(), sessionId: job.sessionId || null };
  tasks.set(id, t);
  startTicker(t, !!job.sessionId);
  const args = job.sessionId ? ['session', 'resume', job.sessionId, buildPrompt(job.text, true, id)] : [buildPrompt(job.text, false, id)];
  log('작업 시작', `#${id}`, job.sessionId ? `(이어서 ${job.sessionId})` : '', job.text.slice(0, 80).replace(/\n/g, ' '));
  const child = spawn(asideBin, args, { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.child = child;
  let out = '', err = '';
  child.stdout.on('data', (d) => {
    out += d; if (out.length > 200000) out = out.slice(-100000);
    const m = stripAnsi(out).match(/session:\s*([A-Za-z0-9]{8,})/);
    if (m && !t.sessionId) { t.sessionId = m[1]; writeStatus(); }
  });
  child.stderr.on('data', (d) => {
    err += d; if (err.length > 50000) err = err.slice(-20000);
    const m = stripAnsi(err).match(/session:\s*([A-Za-z0-9]{8,})/);
    if (m && !t.sessionId) { t.sessionId = m[1]; writeStatus(); }
  });
  const killer = setTimeout(() => { t.timedOut = true; child.kill('SIGTERM'); }, control.timeoutMin * 60000);
  child.on('close', async (code) => {
    clearTimeout(killer);
    t.finishing = true; // 답장 보내기 전에 브리지가 재시작되지 않도록 tasks에서 나중에 뺌
    const mins = Math.max(1, Math.round((Date.now() - t.started) / 60000));
    const clean = stripAnsi(out).split('\n').filter((l) => !/^\s*(created new session|continuing session|resumed session)[: ]/i.test(l)).join('\n').trim();
    const status = t.killed ? 'stopped' : t.timedOut ? 'timeout' : code === 0 ? 'done' : 'error';
    await stopTicker(t, status);
    await appendFile(`${DIR}/last-output.txt`, `\n===== ${new Date().toISOString()} #${id} code=${code} session=${t.sessionId}\n${clean}\n--- stderr\n${stripAnsi(err)}\n`).catch(() => {});
    let body;
    if (status === 'stopped') body = '작업을 중지했어요.';
    else if (status === 'timeout') body = `${control.timeoutMin}분이 지나서 작업을 중지했어요.\n${clean.slice(-2000)}`;
    else if (status === 'error') body = `작업이 정상 종료되지 않았어요 (code ${code}).\n${(clean || stripAnsi(err)).slice(-2500)}`;
    else body = (await finalAnswer(t.sessionId)) || clean.slice(-1500) || '(답변 없음)';
    const sent = status === 'done' ? (await agentSent(id, t.started)).filter((r) => r.kind === 'text') : [];
    let botMsgId;
    if (sent.length) { botMsgId = sent[sent.length - 1].message_id; body = `(에이전트가 직접 전송 #${sent.map((r) => r.message_id).join(',')}) ` + body; }
    else botMsgId = await reply(body);
    for (const r of sent) await rememberSession(r.message_id, t.sessionId);
    await rememberSession(botMsgId, t.sessionId);
    await appendFile(HISTORY, JSON.stringify({ at: t.started, endedAt: Date.now(), text: t.text.slice(0, 200), status, mins, sessionId: t.sessionId, result: body.slice(0, 500) }) + '\n').catch(() => {});
    await log('작업 종료', `#${id}`, status, `${mins}분`, sent.length ? '(직접 전송)' : '(브리지 전송)');
    tasks.delete(id);
    await writeStatus();
    pump();
  });
  writeStatus();
}
function pump() {
  while (queue.length && tasks.size < control.maxParallel) runTask(queue.shift());
  writeStatus();
}
function stopAll() {
  queue.length = 0;
  for (const t of tasks.values()) { t.killed = true; t.child?.kill('SIGTERM'); }
}

// 첨부(사진, 파일) 받아서 inbox에 저장하고 경로 반환
const INBOX = `${DIR}/inbox`;
async function saveAttachments(msg) {
  const items = [];
  if (msg.photo?.length) items.push({ file_id: msg.photo[msg.photo.length - 1].file_id, name: 'photo.jpg' });
  for (const k of ['document', 'video', 'audio', 'voice', 'animation', 'video_note', 'sticker']) {
    const f = msg[k]; if (f?.file_id) items.push({ file_id: f.file_id, name: f.file_name || `${k}${k === 'voice' ? '.ogg' : k === 'sticker' ? '.webp' : ''}` });
  }
  const paths = [];
  for (const it of items) {
    try {
      const r = await tg('getFile', { file_id: it.file_id });
      if (!r.ok) { await log('getFile 실패', r.description); paths.push(`(다운로드 실패: ${it.name}, ${r.description})`); continue; }
      const fp = r.result.file_path;
      const ext = (fp.match(/\.[A-Za-z0-9]+$/) || [''])[0];
      const base = it.name.includes('.') ? it.name : it.name + ext;
      const d = new Date(); const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const out = `${INBOX}/${stamp}_${msg.message_id}_${base.replace(/[\/\s]+/g, '_')}`;
      const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${cfg.token}/${fp}`, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
      await mkdir(INBOX, { recursive: true }); await writeFile(out, buf);
      paths.push(out);
    } catch (e) { await log('첨부 저장 실패', e.message); paths.push(`(다운로드 실패: ${it.name})`); }
  }
  return paths;
}
const attachNote = (paths) => paths.length ? `\n\n[첨부 ${paths.length}개, read_file로 열어볼 것]\n${paths.join('\n')}` : '';

// 앨범(여러 장)은 media_group_id로 묶어서 한 작업으로
const albums = new Map();
async function handle(msg) {
  if (msg.media_group_id) {
    let a = albums.get(msg.media_group_id);
    if (!a) { a = { msgs: [] }; albums.set(msg.media_group_id, a); }
    a.msgs.push(msg); clearTimeout(a.timer);
    a.timer = setTimeout(async () => {
      albums.delete(msg.media_group_id);
      const paths = []; for (const m of a.msgs) paths.push(...(await saveAttachments(m)));
      const first = a.msgs.find((m) => m.caption) || a.msgs[0];
      await handleCore(first, paths).catch((e) => log('앨범 처리 예외', e.message));
    }, 2500);
    return;
  }
  await handleCore(msg, await saveAttachments(msg));
}
async function handleCore(msg, paths = []) {
  let text = (msg.text ?? msg.caption ?? '').trim();
  if (!text && !paths.length) { await reply('이 형식은 아직 처리할 수 없어요. 글자나 사진, 파일로 보내 주세요.'); return; }
  if (!text) text = '(설명 없이 첨부만 보냄. 내용을 보고 무엇을 원하는지 판단해서 처리)';
  if (paths.length) text += attachNote(paths);
  if (text === '/start') { await reply('연결돼 있어요. 할 일을 보내 주세요.\n/status 상태 보기\n/stop 실행 중 작업 모두 중지'); return; }
  if (text === '/status') {
    const run = [...tasks.values()].map((t) => `- ${Math.round((Date.now() - t.started) / 60000)}분째: ${t.text.slice(0, 40)}`).join('\n');
    await reply(`실행 중 ${tasks.size}개, 대기 ${queue.length}개${run ? '\n' + run : ''}`); return;
  }
  if (text === '/stop') { const n = tasks.size + queue.length; stopAll(); await reply(n ? `작업 ${n}개를 중지했어요.` : '실행 중인 작업이 없어요.'); return; }
  let sessionId = null;
  const rt = msg.reply_to_message?.message_id;
  if (rt) sessionId = (await readJson(SESSMAP, {}))[rt] || null;
  const job = { text, sessionId };
  if (tasks.size >= control.maxParallel) { queue.push(job); await reply(`받았어요. 앞 작업이 끝나면 시작합니다 (대기 ${queue.length}번째).`); writeStatus(); return; }
  runTask(job); // '받았어요' 대신 Working 메시지가 바로 뜸
}

await log('브리지 v2 시작. aside =', asideBin || '없음', 'pid', process.pid);
await loadControl(); await writeStatus();
let backoff = 2000;
while (true) {
  try {
    if ((await stat(SELF)).mtimeMs !== selfMtime && tasks.size === 0 && albums.size === 0) { await log('브리지 파일이 바뀌어서 재시작'); process.exit(0); }
    await loadControl();
    if (control.killAll && control.killAll !== lastKillAll) { lastKillAll = control.killAll; stopAll(); await log('앱에서 전체 중지'); }
    if (control.paused) { lastError = null; await writeStatus(); await sleep(3000); continue; }
    const st = await readJson(STATE, { last_update_id: 0 });
    const res = await fetch(`${API}/getUpdates?offset=${st.last_update_id + 1}&timeout=20`, { signal: AbortSignal.timeout(35000) }).then((r) => r.json());
    lastPollAt = Date.now();
    if (!res.ok) {
      lastError = `${res.error_code} ${res.description}`;
      await log('getUpdates 오류', lastError); await writeStatus();
      await sleep(res.error_code === 409 ? 10000 : backoff); backoff = Math.min(backoff * 2, 60000); continue;
    }
    backoff = 2000; lastError = null;
    for (const u of res.result) {
      st.last_update_id = Math.max(st.last_update_id, u.update_id);
      await writeFile(STATE, JSON.stringify(st, null, 2));
      const m = u.message;
      if (!m || m.from?.id !== cfg.owner_user_id || m.chat?.id !== cfg.owner_chat_id) { if (m) await log('주인 아닌 메시지 무시 from=', m.from?.id); continue; }
      await handle(m);
    }
    await writeStatus();
  } catch (e) {
    lastError = e.message; await log('루프 예외', e.message); await writeStatus();
    await sleep(backoff); backoff = Math.min(backoff * 2, 60000);
  }
}
