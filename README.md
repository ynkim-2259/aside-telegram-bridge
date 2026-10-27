# Aside 텔레그램 브리지

휴대폰 텔레그램으로 맥에 있는 Aside에 일을 시키고, 결과를 다시 텔레그램으로 받는 작은 프로그램입니다.
Aside의 채널 기능은 유료 요금제에서만 쓸 수 있어서, 무료로 같은 일을 하려고 만들었습니다.

동작 방식은 이렇습니다.

1. 맥에서 `bridge.mjs`가 항상 켜져 있으면서 텔레그램 봇에 새 메시지가 왔는지 계속 확인합니다 (롱 폴링).
2. 내 계정에서 온 메시지가 오면 `aside "<요청>"` 명령으로 Aside 작업을 시작합니다.
3. 작업하는 동안 텔레그램에 `⏳ Working · 1분 20초 · 12 steps` 같은 진행 표시가 5초마다 바뀝니다.
4. 끝나면 Aside가 `tg.sh`로 답을 텔레그램에 직접 보냅니다. 못 보냈으면 브리지가 마지막 답을 대신 보냅니다.
5. 받은 답 메시지에 텔레그램 "답장"으로 다시 보내면 같은 Aside 세션에서 이어서 처리합니다.

## 들어 있는 파일

| 파일 | 하는 일 |
| --- | --- |
| `bridge.mjs` | 본체. 텔레그램 메시지를 받아 Aside 작업을 실행하고 결과를 보냄 |
| `tg.sh`, `tg_send.py` | Aside 에이전트가 텔레그램으로 글이나 사진을 직접 보낼 때 쓰는 스크립트 |
| `setup-config.mjs` | 처음 설치할 때 봇 토큰과 내 텔레그램 계정을 설정하는 도우미 |
| `install.sh` | 설치와 업데이트. 파일 복사, 설정, 자동 실행 등록까지 한 번에 |
| `uninstall.sh` | 삭제 |
| `app/` | 메뉴바 앱(선택). 상태 보기, 일시정지, 전체 중지 같은 버튼 |
| `config.example.json` | 설정 파일 모양 예시 (실제 토큰은 저장소에 넣지 않음) |

## 준비물

- macOS 12 이상
- Aside 앱 설치 후 로그인 (계정 폴더 `~/.aside/u/0` 이 있어야 함)
- aside CLI (`aside` 명령). 아래 위치 중 하나에 있으면 자동으로 찾습니다.
  - `~/.aside/u/0/data/aside-cli/bin/aside`
  - `~/.aside/bin/aside`
  - `~/.local/bin/aside`
  - PATH에 있는 `aside`
- Node.js 18 이상. Aside에 들어 있는 `~/.aside/runtime/bin/node` 가 있으면 그걸 씁니다. 없으면 `brew install node`
- python3. 터미널에서 `python3 --version` 이 안 되면 `xcode-select --install` 을 먼저 실행
- 텔레그램 봇 1개 (아래 1단계)

## 설치

### 1단계. 텔레그램 봇 만들기

1. 휴대폰 텔레그램에서 `@BotFather` 를 검색해서 대화를 엽니다.
2. `/newbot` 을 보내고, 봇 이름과 아이디(끝이 `bot` 으로 끝나야 함)를 정합니다.
3. BotFather가 알려 주는 토큰(`123456789:ABC...` 모양)을 복사해 둡니다. 이 토큰은 비밀번호처럼 다룹니다.

**PC마다 봇을 따로 만드세요.** 한 봇을 두 대의 PC가 동시에 확인하면 메시지를 서로 빼앗아서, 어느 PC가 받을지 알 수 없게 됩니다 (로그에 `409 Conflict` 가 찍힘).
예를 들어 회사 PC는 `회사 비서 봇`, 집 PC는 `집 비서 봇` 으로 나누면 됩니다.

### 2단계. 내려받기

이 저장소는 비공개라서 GitHub에 로그인한 상태여야 받을 수 있습니다.

방법 A. ZIP으로 받기
1. 브라우저에서 이 저장소 페이지를 열고 초록색 `Code` 버튼 > `Download ZIP`
2. 받은 ZIP을 풀고, 터미널에서 그 폴더로 이동

방법 B. git으로 받기 (git과 GitHub 로그인이 되어 있는 경우)
```bash
git clone https://github.com/ynkim-2259/aside-telegram-bridge.git
cd aside-telegram-bridge
```

### 3단계. 설치 스크립트 실행

```bash
chmod +x install.sh uninstall.sh
./install.sh --with-app
```

메뉴바 앱이 필요 없으면 `--with-app` 없이 `./install.sh` 만 실행합니다.

스크립트가 차례로 물어보는 것:
1. 봇 토큰을 붙여 넣으라고 하면 1단계에서 복사한 토큰을 붙여 넣고 Enter
2. "봇에게 아무 메시지나 보내세요" 가 나오면 휴대폰에서 방금 만든 봇에게 `/start` 를 보냄
3. "이 계정만 명령을 보낼 수 있게 할까요?" 에 `y`

끝나면 휴대폰에 "이 PC와 연결했어요" 메시지가 옵니다. 이제 봇에게 `/status` 를 보내서 답이 오면 설치 완료입니다.

설치하면 이렇게 됩니다.
- 프로그램 파일: `~/.aside/u/0/data/telegram-bridge/`
- 설정(봇 토큰, 내 계정 id): `~/.aside/u/0/secrets/telegram-bot.json` (권한 600, 나만 읽기)
- 자동 실행: `~/Library/LaunchAgents/com.yn.telegram-aside-bridge.plist`. 맥을 켜고 로그인하면 자동으로 켜지고, 죽으면 다시 살아남
- 메뉴바 앱: `~/Applications/Aside 텔레그램.app`

## 사용법

### 일 시키기
봇 대화방에 평소 Aside에 말하듯 보내면 됩니다.
```
오늘 받은 메일 중에 답장 필요한 거 정리해줘
```
- 바로 `⏳ Working` 메시지가 뜨고 5초마다 걸린 시간, 진행 단계 수, 지금 하는 일이 바뀝니다.
- 끝나면 `✅ 완료` 로 바뀌고 답이 따로 옵니다.
- 맥의 Aside 앱 채팅 목록에도 같은 작업이 남습니다. 목록에 안 보이면 Aside 설정에서 CLI 작업을 숨기는 옵션(`cli.ephemeral`)을 꺼 주세요.

### 이어서 시키기
받은 답 메시지를 길게 눌러 **답장**으로 보내면 같은 세션에서 앞 대화를 기억한 채 이어서 처리합니다.
답장이 아니라 그냥 보내면 새 작업으로 시작합니다.

### 사진, 파일 보내기
사진이나 파일을 그대로 보내면 맥의 `inbox/` 폴더에 저장되고, Aside가 그 파일을 열어 보고 처리합니다.
사진에 설명을 붙이면 그 설명이 요청이 됩니다. 여러 장을 한 번에 보내면 한 작업으로 묶습니다.

### 명령어
| 명령 | 하는 일 |
| --- | --- |
| `/start` | 연결 확인 |
| `/status` | 실행 중인 작업과 대기 중인 작업 보기 |
| `/stop` | 실행 중이거나 기다리는 작업 모두 중지 |

### 기본 규칙
- 동시에 2개까지 실행하고, 더 오면 순서대로 기다립니다.
- 작업 하나는 최대 60분. 넘으면 중지하고 알려 줍니다.
- 설정한 내 계정 말고 다른 사람이 보낸 메시지는 무시합니다.
- 동시 작업 수와 제한 시간은 메뉴바 앱 > 설정에서 바꿀 수 있습니다. 앱이 없으면 `~/.aside/u/0/data/telegram-bridge/control.json` 을 아래처럼 만들면 됩니다.
  ```json
  { "paused": false, "maxParallel": 2, "timeoutMin": 60 }
  ```

### 메뉴바 앱
메뉴바의 ✈︎ 아이콘을 누르면 다음을 할 수 있습니다.
- 상태 보기: `✈︎` 대기 중, `✈︎ 2` 작업 2개 실행 중, `✈︎ ⏸` 일시정지, `✈︎ !` 오류나 꺼짐
- 최근 명령 10개와 결과 보기
- 일시정지 / 다시 시작 (일시정지 중 온 메시지는 재개하면 처리)
- 실행 중 작업 모두 중지
- 휴대폰으로 테스트 메시지 보내기
- 브리지 다시 시작, 로그 보기, 폴더 열기
- 설정: 동시 작업 수(1~3), 제한 시간(30/60/120분), 로그인할 때 앱 자동 실행

앱을 꺼도 브리지는 계속 동작합니다. 앱은 보기와 조작만 합니다.

### Aside 에이전트가 직접 보낼 때 (참고)
브리지는 Aside에 요청을 넘길 때 `tg.sh` 로 답을 보내라는 안내를 붙입니다. 손으로 쓸 일은 거의 없지만, 터미널에서 직접 보낼 수도 있습니다.
```bash
T=~/.aside/u/0/data/telegram-bridge
bash $T/tg.sh 0 <<'EOF'
보낼 글. **굵게**, - 목록 같은 마크다운이 텔레그램 서식으로 보임
EOF
bash $T/tg.sh 0 ~/Desktop/shot.png "사진 설명"
```

## 업데이트

새 버전을 받은 폴더에서 다시 실행하면 됩니다. 기존 설정은 그대로 씁니다.
```bash
git pull          # ZIP으로 받았다면 새 ZIP을 받아 풀기
./install.sh      # 메뉴바 앱도 새로 깔려면 --with-app
```
봇이나 계정을 바꾸려면 `./install.sh --reconfigure`

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 봇이 아무 반응이 없음 | `tail -n 30 ~/.aside/u/0/data/telegram-bridge/bridge.log` 로 로그 확인 |
| 로그에 `409 Conflict` | 같은 봇을 다른 PC나 다른 프로그램도 확인하고 있음. 한 곳만 남기거나 봇을 따로 만들기 |
| "aside CLI를 찾지 못했어요" 답장 | aside CLI 설치 후 `./install.sh` 다시 실행, 또는 `ASIDE_BIN=/경로/aside ./install.sh` |
| 작업은 끝났는데 답이 짧거나 이상함 | 메뉴바 앱 > 마지막 결과 전체 보기, 또는 `last-output.txt` |
| 브리지 상태 보기 | `launchctl print gui/$(id -u)/com.yn.telegram-aside-bridge \| head -20` |
| 브리지 강제 재시작 | `launchctl kickstart -k gui/$(id -u)/com.yn.telegram-aside-bridge` |
| python3 실행 시 개발자 도구 설치 창 | `xcode-select --install` 로 설치 후 다시 |

`bridge.mjs` 파일이 바뀌면 브리지가 하던 작업을 끝낸 뒤 스스로 재시작해서 새 버전을 씁니다.

## 삭제

```bash
./uninstall.sh          # 자동 실행 해제, 메뉴바 앱 삭제 (설정과 기록은 남김)
./uninstall.sh --purge  # 봇 토큰 설정과 기록 폴더까지 삭제
```
봇 자체도 없애려면 BotFather에 `/deletebot`.

## 보안 메모

- 봇 토큰은 `secrets/telegram-bot.json` 에만 두고 이 저장소에는 올리지 않습니다 (`.gitignore` 에 포함).
- 토큰이 새어 나가면 BotFather에서 `/revoke` 로 바로 바꾸고 `./install.sh --reconfigure` 를 실행하세요.
- 텔레그램에서 시킨 일도 맥의 Aside가 그대로 실행합니다. 결제, 본인인증, 삭제처럼 되돌리기 어려운 일은 텔레그램으로 시키지 않는 것을 권합니다.

## 고급 설정 (환경 변수)

| 변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `ASIDE_ACCOUNT_DIR` | `~/.aside/u/0` | Aside 계정 폴더 |
| `ASIDE_BIN` | 자동 탐색 | aside CLI 경로 |
| `TG_BRIDGE_CONFIG` | `<계정폴더>/secrets/telegram-bot.json` | 설정 파일 위치 |
| `TG_TOKEN`, `TG_OWNER_ID` | 없음 | 설치 때 묻지 않고 바로 쓸 봇 토큰과 내 텔레그램 id |
