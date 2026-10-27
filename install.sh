#!/bin/bash
# Aside 텔레그램 브리지 설치
#   ./install.sh               브리지 설치(또는 업데이트)
#   ./install.sh --with-app    메뉴바 앱도 같이 설치
#   ./install.sh --reconfigure 봇 토큰과 내 계정을 다시 설정
set -euo pipefail
cd "$(dirname "$0")"

ACC="${ASIDE_ACCOUNT_DIR:-$HOME/.aside/u/0}"
DIR="$ACC/data/telegram-bridge"
CONF="$ACC/secrets/telegram-bot.json"
LABEL=com.yn.telegram-aside-bridge
APP_LABEL=com.yn.aside-telegram-app
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APPDIR="$HOME/Applications/Aside 텔레그램.app"
WITH_APP=0; RECONF=0
for a in "$@"; do
  case "$a" in
    --with-app) WITH_APP=1 ;;
    --reconfigure) RECONF=1 ;;
    *) echo "알 수 없는 옵션: $a"; exit 1 ;;
  esac
done

say() { printf '\n== %s\n' "$1"; }
fail() { printf '\n[중단] %s\n' "$1"; exit 1; }

say "1/6 Aside 계정 폴더 확인"
[ -d "$ACC" ] || fail "$ACC 폴더가 없어요. 이 PC에 Aside를 설치하고 로그인한 뒤 다시 실행하세요. (다른 위치면 ASIDE_ACCOUNT_DIR=경로 ./install.sh)"
echo "$ACC"

say "2/6 Node.js 확인 (18 이상)"
NODE=""
for c in "$HOME/.aside/runtime/bin/node" "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$c" ] && [ -x "$c" ]; then NODE="$c"; break; fi
done
[ -n "$NODE" ] || fail "Node.js를 찾지 못했어요. https://nodejs.org 에서 LTS를 설치하거나 brew install node"
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 18 ] || fail "Node.js 18 이상이 필요해요 (지금 $("$NODE" -v))"
echo "$NODE ($("$NODE" -v))"

say "3/6 aside CLI와 python3 확인"
ASIDE=""
for c in "${ASIDE_BIN:-}" "$ACC/data/aside-cli/bin/aside" "$HOME/.aside/bin/aside" "$HOME/.local/bin/aside" "$(command -v aside 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then ASIDE="$c"; break; fi
done
if [ -n "$ASIDE" ]; then echo "aside: $ASIDE"; else
  echo "[주의] aside CLI를 찾지 못했어요. 설치는 계속하지만, 명령을 받으면 'aside CLI를 찾지 못했어요'라고 답합니다."
  echo "       aside CLI 설치 후 ./install.sh 를 다시 실행하거나 ASIDE_BIN=경로 ./install.sh 로 지정하세요."
fi
python3 -c 'print(1)' >/dev/null 2>&1 || fail "python3가 동작하지 않아요. 'xcode-select --install' 또는 brew install python 후 다시 실행하세요."
echo "python3: $(command -v python3)"

say "4/6 파일 복사 -> $DIR"
mkdir -p "$DIR" "$ACC/secrets"
cp bridge.mjs tg.sh tg_send.py "$DIR/"
chmod +x "$DIR/tg.sh"
echo "완료"

say "5/6 텔레그램 봇 설정"
if [ ! -f "$CONF" ] || [ "$RECONF" = 1 ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true  # 설정 중 메시지를 가로채지 않게
  "$NODE" setup-config.mjs "$CONF"
else
  echo "기존 설정 사용: $CONF (다시 설정하려면 ./install.sh --reconfigure)"
fi
chmod 600 "$CONF"

say "6/6 자동 실행 등록 (launchd: $LABEL)"
EXTRA_PATH=""; [ -n "$ASIDE" ] && EXTRA_PATH="$(dirname "$ASIDE"):"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>ASIDE_ACCOUNT_DIR</key><string>$ACC</string>
    <key>ASIDE_BIN</key><string>$ASIDE</string>
    <key>PATH</key><string>${EXTRA_PATH}$HOME/.aside/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$DIR/launchd.err.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 4
if [ -f "$DIR/status.json" ] && "$NODE" -e "const s=require('$DIR/status.json'); process.exit(Date.now()-s.updatedAt<30000?0:1)"; then
  echo "브리지 동작 중"
else
  echo "[주의] 브리지 상태를 아직 확인하지 못했어요. 잠시 뒤 tail -n 20 \"$DIR/bridge.log\" 로 확인하세요."
fi

if [ "$WITH_APP" = 1 ]; then
  say "메뉴바 앱 설치 -> $APPDIR"
  rm -rf "$APPDIR"
  mkdir -p "$APPDIR/Contents/MacOS" "$APPDIR/Contents/Resources"
  cp app/Info.plist "$APPDIR/Contents/"
  cp app/app.py "$APPDIR/Contents/Resources/"
  cat > "$APPDIR/Contents/MacOS/AsideTelegram" <<EOF
#!/bin/zsh
export ASIDE_ACCOUNT_DIR="$ACC"
D="\$(cd "\$(dirname "\$0")/.." && pwd)"
exec "\$D/Resources/python/bin/python3" "\$D/Resources/app.py"
EOF
  chmod +x "$APPDIR/Contents/MacOS/AsideTelegram"
  python3 -m venv "$APPDIR/Contents/Resources/python"
  "$APPDIR/Contents/Resources/python/bin/pip" install -q --disable-pip-version-check rumps
  codesign --force --deep -s - "$APPDIR" >/dev/null 2>&1 || true
  open "$APPDIR"
  echo "메뉴바에 ✈︎ 아이콘이 보이면 성공. 로그인할 때 자동 실행은 메뉴 > 설정에서 켜세요."
fi

printf '\n설치 끝. 휴대폰 텔레그램에서 봇에게 /status 를 보내 보세요.\n'
