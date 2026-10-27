import json, os, sys, time, urllib.request, urllib.error, subprocess
DIR=os.environ.get('TG_BRIDGE_DIR', os.path.dirname(os.path.abspath(__file__)))
# 설치 위치가 <계정폴더>/data/telegram-bridge 이므로 두 단계 위가 계정 폴더
BASE=os.environ.get('ASIDE_ACCOUNT_DIR', os.path.abspath(os.path.join(DIR,'..','..')))
cfg=json.load(open(os.environ.get('TG_BRIDGE_CONFIG', BASE+'/secrets/telegram-bot.json')))
api='https://api.telegram.org/bot'+cfg['token']
task=int(sys.argv[1]) if sys.argv[1].isdigit() else 0
args=sys.argv[2:]
log=DIR+'/agent-sent.jsonl'
def rec(mid, kind):
    with open(log,'a') as f: f.write(json.dumps({'task':task,'at':int(time.time()*1000),'message_id':mid,'kind':kind})+'\n')
if args:
    out=subprocess.run(['curl','-s','-F',f"chat_id={cfg['owner_chat_id']}",'-F','caption='+(args[1] if len(args)>1 else ''),'-F','photo=@'+args[0],api+'/sendPhoto'],capture_output=True,text=True).stdout
    r=json.loads(out or '{}')
    if not r.get('ok'): sys.exit('사진 전송 실패: '+str(r.get('description')))
    rec(r['result']['message_id'],'photo'); print('사진 전송함 #%s'%r['result']['message_id'])
else:
    text=sys.stdin.read().strip()
    if not text: sys.exit('보낼 내용이 비어 있어요')
    ids=[]
    def call(method, body):
        req=urllib.request.Request(api+'/'+method,data=json.dumps(body).encode(),headers={'content-type':'application/json'})
        try: return json.load(urllib.request.urlopen(req,timeout=30))
        except urllib.error.HTTPError as e:
            try: return json.load(e)
            except Exception: return {'ok':False,'description':str(e)}
    # 1) 서식 메시지(sendRichMessage, 마크다운: **굵게**, - 목록, 1. 번호, ## 소제목)
    chunks=[]; cur=''
    for para in text.split('\n\n'):
        if cur and len(cur)+len(para)+2>30000: chunks.append(cur); cur=para
        else: cur=(cur+'\n\n'+para) if cur else para
    if cur: chunks.append(cur)
    rich_ok=True
    for c in chunks:
        r=call('sendRichMessage',{'chat_id':cfg['owner_chat_id'],'rich_message':{'markdown':c}})
        if not r.get('ok'): rich_ok=False; sys.stderr.write('서식 전송 실패, 일반 글로 보냄: '+str(r.get('description'))+'\n'); break
        ids.append(r['result']['message_id']); rec(ids[-1],'rich')
    # 2) 실패하면 일반 글
    if not rich_ok:
        sent=sum(len(c)+2 for c in chunks[:len(ids)])
        rest=text[sent:] if ids else text
        for i in range(0,len(rest),3800):
            r=call('sendMessage',{'chat_id':cfg['owner_chat_id'],'text':rest[i:i+3800],'disable_web_page_preview':True})
            if not r.get('ok'): sys.exit('전송 실패: '+str(r.get('description')))
            ids.append(r['result']['message_id']); rec(ids[-1],'text')
    print('텔레그램 전송함 #'+','.join(map(str,ids))+(' (서식)' if rich_ok else ' (일반 글)'))
