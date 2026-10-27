# Aside 텔레그램: 메뉴바 앱
# 실제 메시지 처리는 launchd로 도는 브리지(bridge.mjs)가 하고, 이 앱은 상태 표시와 조작을 맡는다.
import json, os, sys, subprocess, time, datetime, urllib.request, threading
import rumps
from AppKit import NSApplication

BASE = os.environ.get('ASIDE_ACCOUNT_DIR', os.path.expanduser('~/.aside/u/0'))
DIR = os.environ.get('TG_BRIDGE_DIR', f'{BASE}/data/telegram-bridge')
SECRET = os.environ.get('TG_BRIDGE_CONFIG', f'{BASE}/secrets/telegram-bot.json')
STATUS = f'{DIR}/status.json'
CONTROL = f'{DIR}/control.json'
HISTORY = f'{DIR}/history.jsonl'
LOG = f'{DIR}/bridge.log'
LAST_OUT = f'{DIR}/last-output.txt'
LABEL = 'com.yn.telegram-aside-bridge'
APP_LABEL = 'com.yn.aside-telegram-app'
UID = os.getuid()
APP_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LOGIN_PLIST = os.path.expanduser(f'~/Library/LaunchAgents/{APP_LABEL}.plist')


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def write_control(**kw):
    c = read_json(CONTROL, {})
    c.update(kw)
    with open(CONTROL, 'w', encoding='utf-8') as f:
        json.dump(c, f, ensure_ascii=False, indent=2)
    return c


def hhmm(ms):
    if not ms:
        return '-'
    return datetime.datetime.fromtimestamp(ms / 1000).strftime('%H:%M')


def kickstart():
    subprocess.run(['launchctl', 'kickstart', '-k', f'gui/{UID}/{LABEL}'], capture_output=True)


class AsideTelegram(rumps.App):
    def __init__(self):
        super().__init__('Aside 텔레그램', title='✈︎', quit_button=None)
        self.status_item = rumps.MenuItem('상태 확인 중...')
        self.tasks_item = rumps.MenuItem('작업: -')
        self.poll_item = rumps.MenuItem('마지막 확인: -')
        self.recent_menu = rumps.MenuItem('최근 명령')
        self.pause_item = rumps.MenuItem('일시정지', callback=self.toggle_pause)

        self.parallel_menu = rumps.MenuItem('동시 작업 수')
        for n in (1, 2, 3):
            self.parallel_menu.add(rumps.MenuItem(f'{n}개', callback=self.set_parallel))
        self.timeout_menu = rumps.MenuItem('작업 제한 시간')
        for m in (30, 60, 120):
            self.timeout_menu.add(rumps.MenuItem(f'{m}분', callback=self.set_timeout))
        self.login_item = rumps.MenuItem('로그인할 때 이 앱 자동 실행', callback=self.toggle_login)
        settings = rumps.MenuItem('설정')
        settings.add(self.parallel_menu)
        settings.add(self.timeout_menu)
        settings.add(self.login_item)

        self.menu = [
            self.status_item, self.tasks_item, self.poll_item, None,
            self.recent_menu,
            rumps.MenuItem('마지막 결과 전체 보기', callback=self.open_last_output),
            None,
            self.pause_item,
            rumps.MenuItem('실행 중 작업 모두 중지', callback=self.stop_all),
            rumps.MenuItem('휴대폰으로 테스트 메시지 보내기', callback=self.send_test),
            rumps.MenuItem('브리지 다시 시작', callback=self.restart_bridge),
            None,
            settings,
            rumps.MenuItem('봇 대화방 열기', callback=lambda _: subprocess.run(['open', 'https://t.me/' + str(read_json(SECRET, {}).get('bot_username', ''))])),
            rumps.MenuItem('로그 보기', callback=lambda _: subprocess.run(['open', '-e', LOG])),
            rumps.MenuItem('폴더 열기', callback=lambda _: subprocess.run(['open', DIR])),
            None,
            rumps.MenuItem('메뉴바 아이콘 닫기 (브리지는 계속 동작)', callback=lambda _: rumps.quit_application()),
        ]
        self._history_sig = 'init'
        self.ensure_bridge_current()
        rumps.Timer(self.refresh, 2).start()

    # 상태 갱신
    def ensure_bridge_current(self):
        s = read_json(STATUS, None)
        if not s or (time.time() * 1000 - s.get('updatedAt', 0)) > 90000:
            kickstart()

    def refresh(self, _=None):
        s = read_json(STATUS, None)
        c = read_json(CONTROL, {})
        now = time.time() * 1000
        alive = bool(s) and (now - s.get('updatedAt', 0)) < 90000
        running = len(s.get('running', [])) if s else 0
        queued = len(s.get('queued', [])) if s else 0
        if not alive:
            self.title = '✈︎ !'
            self.status_item.title = '● 브리지 꺼짐 또는 응답 없음'
        elif c.get('paused'):
            self.title = '✈︎ ⏸'
            self.status_item.title = '⏸ 일시정지 (메시지는 쌓여 있다가 재개하면 처리)'
        elif s.get('lastError'):
            self.title = '✈︎ !'
            self.status_item.title = f"● 오류: {s['lastError'][:50]}"
        else:
            self.title = f'✈︎ {running}' if running else '✈︎'
            self.status_item.title = '● 실시간 대기 중'
        self.tasks_item.title = f'작업: 실행 {running}개, 대기 {queued}개'
        if s and s.get('running'):
            first = s['running'][0]
            mins = int((now - first['started']) / 60000)
            self.tasks_item.title += f"  ({mins}분째: {first['text'][:20]})"
        self.poll_item.title = f"마지막 확인: {hhmm(s.get('lastPollAt')) if s else '-'}"
        self.pause_item.title = '다시 시작' if c.get('paused') else '일시정지'
        mp, tm = c.get('maxParallel', 2), c.get('timeoutMin', 60)
        for item in self.parallel_menu.values():
            item.state = 1 if item.title == f'{mp}개' else 0
        for item in self.timeout_menu.values():
            item.state = 1 if item.title == f'{tm}분' else 0
        self.login_item.state = 1 if os.path.exists(LOGIN_PLIST) else 0
        self.refresh_history()

    def refresh_history(self):
        try:
            st = os.stat(HISTORY)
            sig = (st.st_mtime, st.st_size)
        except FileNotFoundError:
            sig = None
        if sig == self._history_sig:
            return
        self._history_sig = sig
        rows = []
        if sig:
            with open(HISTORY, encoding='utf-8') as f:
                for line in f.readlines()[-10:]:
                    try:
                        rows.append(json.loads(line))
                    except Exception:
                        pass
        self.recent_menu.clear()
        if not rows:
            self.recent_menu.add(rumps.MenuItem('아직 없음'))
            return
        mark = {'done': '✓', 'error': '✕', 'timeout': '⏱', 'stopped': '■'}
        for r in reversed(rows):
            label = f"{hhmm(r.get('at'))} {mark.get(r.get('status'), '?')} {r.get('text', '')[:28]} ({r.get('mins', '?')}분)"
            item = rumps.MenuItem(label, callback=self.show_history)
            item._row = r
            self.recent_menu.add(item)

    # 메뉴 동작
    def show_history(self, sender):
        r = getattr(sender, '_row', {})
        rumps.alert(title=r.get('text', '')[:80], message=f"결과 ({r.get('status')}, {r.get('mins')}분)\n\n{r.get('result', '')}", ok='닫기')

    def open_last_output(self, _):
        if os.path.exists(LAST_OUT):
            subprocess.run(['open', '-e', LAST_OUT])
        else:
            rumps.alert('아직 결과가 없어요.')

    def toggle_pause(self, _):
        c = read_json(CONTROL, {})
        write_control(paused=not c.get('paused', False))
        self.refresh()

    def stop_all(self, _):
        if rumps.alert(title='작업 중지', message='실행 중이거나 대기 중인 작업을 모두 중지할까요?', ok='중지', cancel='취소') == 1:
            write_control(killAll=int(time.time() * 1000))

    def set_parallel(self, sender):
        write_control(maxParallel=int(sender.title.replace('개', '')))
        self.refresh()

    def set_timeout(self, sender):
        write_control(timeoutMin=int(sender.title.replace('분', '')))
        self.refresh()

    def restart_bridge(self, _):
        kickstart()
        rumps.alert('브리지를 다시 시작했어요.')

    def send_test(self, _):
        def go():
            try:
                cfg = read_json(SECRET, {})
                data = json.dumps({'chat_id': cfg['owner_chat_id'], 'text': f"맥 앱 연결 정상 ({datetime.datetime.now().strftime('%H:%M')})"}).encode()
                req = urllib.request.Request(f"https://api.telegram.org/bot{cfg['token']}/sendMessage", data=data, headers={'content-type': 'application/json'})
                ok = json.load(urllib.request.urlopen(req, timeout=20)).get('ok')
                self._test_result = '휴대폰으로 보냈어요.' if ok else '전송 실패'
            except Exception as e:
                self._test_result = f'전송 실패: {e}'
        self._test_result = None
        t = threading.Thread(target=go); t.start(); t.join(25)
        rumps.alert(self._test_result or '응답 없음')

    def toggle_login(self, _):
        if os.path.exists(LOGIN_PLIST):
            subprocess.run(['launchctl', 'bootout', f'gui/{UID}/{APP_LABEL}'], capture_output=True)
            os.remove(LOGIN_PLIST)
        else:
            os.makedirs(os.path.dirname(LOGIN_PLIST), exist_ok=True)
            with open(LOGIN_PLIST, 'w', encoding='utf-8') as f:
                f.write(f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{APP_LABEL}</string>
<key>ProgramArguments</key><array><string>{sys.executable}</string><string>{os.path.abspath(__file__)}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>''')
        self.refresh()


if __name__ == '__main__':
    app = AsideTelegram()
    NSApplication.sharedApplication().setActivationPolicy_(1)  # Dock 아이콘 숨김
    app.run()
