#!/bin/bash
# 텔레그램으로 직접 보내기 (브리지 작업 번호를 같이 기록)
#   글:   bash tg.sh <작업번호> <<'EOF'
#         보낼 내용
#         EOF
#   사진: bash tg.sh <작업번호> <사진파일> [설명]
HERE="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$HERE/tg_send.py" "${1:-0}" "${@:2}"
