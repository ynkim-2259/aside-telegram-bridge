// 텔레그램 봇 설정 도우미: 토큰 입력 -> 봇 확인 -> 내 계정 id 자동 확인 -> 설정 파일 저장(권한 600)
// 사용: node setup-config.mjs <설정파일 경로>
import { writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import readline from 'node:readline/promises';

const out = process.argv[2];
if (!out) { console.error('설정 파일 경로가 필요해요'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const call = async (token, method, body = {}) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};

let token = (process.env.TG_TOKEN || '').trim();
if (!token) token = (await rl.question('BotFather가 준 봇 토큰을 붙여 넣으세요: ')).trim();
const me = await call(token, 'getMe');
if (!me.ok) { console.error('토큰이 맞지 않아요:', me.description); process.exit(1); }
const username = me.result.username;
console.log(`\n봇 확인: @${username}`);
await call(token, 'deleteWebhook', { drop_pending_updates: false });

// 이전에 쌓인 메시지는 건너뜀
let offset = 0;
const pre = await call(token, 'getUpdates', { timeout: 0 });
if (pre.ok && pre.result.length) offset = pre.result[pre.result.length - 1].update_id + 1;

let chatId = Number(process.env.TG_OWNER_ID || 0), userId = chatId, name = '';
if (!chatId) {
  console.log(`\n휴대폰 텔레그램에서 @${username} 대화방을 열고 아무 메시지나 보내세요 (예: /start).`);
  console.log('3분 동안 기다립니다...');
  const until = Date.now() + 180000;
  while (!chatId && Date.now() < until) {
    const r = await call(token, 'getUpdates', { offset, timeout: 20 });
    if (!r.ok) { console.error('getUpdates 오류:', r.description, '(다른 곳에서 같은 봇을 쓰고 있으면 멈추고 다시 하세요)'); process.exit(1); }
    for (const u of r.result) {
      offset = u.update_id + 1;
      const m = u.message;
      if (m && m.chat?.type === 'private') { chatId = m.chat.id; userId = m.from.id; name = [m.from.first_name, m.from.last_name].filter(Boolean).join(' '); }
    }
  }
  if (!chatId) { console.error('메시지를 받지 못했어요. 다시 실행해 주세요.'); process.exit(1); }
  const ok = (await rl.question(`\n${name} (id ${userId}) 계정에서 온 메시지를 받았어요. 이 계정만 명령을 보낼 수 있게 할까요? (y/n) `)).trim().toLowerCase();
  if (ok !== 'y' && ok !== 'yes' && ok !== 'ㅛ') { console.log('취소했어요.'); process.exit(1); }
  await call(token, 'getUpdates', { offset, timeout: 0 }); // 받은 메시지 처리 완료 표시
}
rl.close();

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ token, bot_username: username, owner_chat_id: chatId, owner_user_id: userId, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
await chmod(out, 0o600);
await call(token, 'sendMessage', { chat_id: chatId, text: '이 PC와 연결했어요. 잠시 뒤부터 명령을 보낼 수 있어요.' });
console.log(`\n설정 저장: ${out}`);
