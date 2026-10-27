#!/bin/bash
# Aside 텔레그램 브리지 삭제
#   ./uninstall.sh          자동 실행 해제 + 메뉴바 앱 삭제 (설정과 기록은 남김)
#   ./uninstall.sh --purge  설정 파일(봇 토큰)과 기록 폴더까지 삭제
set -uo pipefail
ACC="${ASIDE_ACCOUNT_DIR:-$HOME/.aside/u/0}"
for L in com.yn.telegram-aside-bridge com.yn.aside-telegram-app; do
  launchctl bootout "gui/$(id -u)/$L" 2>/dev/null
  rm -f "$HOME/Library/LaunchAgents/$L.plist"
done
pkill -f "Aside 텔레그램.app/Contents/Resources/app.py" 2>/dev/null
rm -rf "$HOME/Applications/Aside 텔레그램.app"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$ACC/data/telegram-bridge" "$ACC/secrets/telegram-bot.json"
  echo "설정과 기록까지 삭제했어요."
else
  echo "자동 실행을 해제했어요. 설정($ACC/secrets/telegram-bot.json)과 기록은 남겨 뒀어요."
fi
