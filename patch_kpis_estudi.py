import json, urllib.request, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

N8N_URL = 'https://geri.app.n8n.cloud/api/v1'
KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZThkZDQwYi01YjQxLTRhYmUtOTM5ZS1mYzZkNWMzMDQwMTciLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNTJkOWNhYmEtNGExMy00NDJiLTgyNDEtMTRmN2RlNjRiZGQ2IiwiaWF0IjoxNzczMzk4MTQyfQ.xg4N7hKvq6vMhMqi-3htp8sYTLC1CFy2euUMCdyMWTo'
WF_ID = 'C7MF5lX9Hspx50gh'

with open('C:/Users/SOLENVER-OF15/8TLV/kpis_estudi.js', encoding='utf-8') as f:
    new_code = f.read()

req = urllib.request.Request(f'{N8N_URL}/workflows/{WF_ID}',
    headers={'X-N8N-API-KEY': KEY, 'Accept': 'application/json'})
with urllib.request.urlopen(req) as r:
    wf = json.loads(r.read().decode('utf-8'))

updated = False
for n in wf['nodes']:
    if n['name'] == 'Calcular KPIs estudi':
        n['parameters']['jsCode'] = new_code
        print(f'Node actualitzat ({len(new_code)} chars)')
        updated = True
        break

if not updated:
    print('ERROR: node "Calcular KPIs estudi" no trobat!')
    sys.exit(1)

settings = wf.get('settings', {})
allowed = {k: settings[k] for k in ['executionOrder', 'callerPolicy'] if k in settings}
body_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
            'settings': allowed, 'staticData': wf.get('staticData')}
payload = json.dumps(body_put, ensure_ascii=False).encode('utf-8')
req2 = urllib.request.Request(f'{N8N_URL}/workflows/{WF_ID}', data=payload, method='PUT',
    headers={'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json'})
with urllib.request.urlopen(req2) as r2:
    result = json.loads(r2.read().decode('utf-8'))
    print(f'Guardat. Nodes totals: {len(result["nodes"])}')

for action in ['deactivate', 'activate']:
    req3 = urllib.request.Request(f'{N8N_URL}/workflows/{WF_ID}/{action}', method='POST',
        headers={'X-N8N-API-KEY': KEY})
    with urllib.request.urlopen(req3) as r3:
        pass
    print(f'{action} OK')
    time.sleep(2)

print('Desplegat correctament!')
