"""
Fix: Tool: Calcular KPIs - la descripcio tenia apostrofos que trenquen la sintaxi
$fromAI('kpisPayload', '...l'inversor...') -> single quote inside single-quoted string -> error n8n
"""
import json, urllib.request, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

N8N_URL = 'https://geri.app.n8n.cloud/api/v1'
KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZThkZDQwYi01YjQxLTRhYmUtOTM5ZS1mYzZkNWMzMDQwMTciLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNTJkOWNhYmEtNGExMy00NDJiLTgyNDEtMTRmN2RlNjRiZGQ2IiwiaWF0IjoxNzczMzk4MTQyfQ.xg4N7hKvq6vMhMqi-3htp8sYTLC1CFy2euUMCdyMWTo'
WF_ID = 'C7MF5lX9Hspx50gh'

def api(path, method='GET', data=None):
    url = f'{N8N_URL}{path}'
    headers = {'X-N8N-API-KEY': KEY, 'Accept': 'application/json'}
    if data:
        headers['Content-Type'] = 'application/json; charset=utf-8'
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode('utf-8'))

api(f'/workflows/{WF_ID}/deactivate', 'POST')
print('deactivate OK'); time.sleep(2)

wf = api(f'/workflows/{WF_ID}')
print(f'GET OK - {len(wf["nodes"])} nodes')

# Safe description: no apostrophes (no single quotes inside the fromAI string)
SAFE_DESC = "JSON amb els parametres: num_moduls, potencia_wp, preu_modul (preu cost del modul, del cataleg), preu_inversor (preu cost de l inversor, del cataleg), potencia_inversor_kw, perfil_client, trifasic, lat, lng, inclinacio, orientacio, consum_anual, preu_p1, preu_p2, preu_p3, preu_excedent. Sempre inclou preu_modul i preu_inversor per calcular el retorn."

for node in wf['nodes']:
    if node['name'] == 'Tool: Calcular KPIs':
        params = node['parameters']
        body = params.get('jsonBody', '')
        print(f'  Current jsonBody[:80]: {body[:80]}')
        # Replace any description inside $fromAI('kpisPayload', '...')
        import re
        new_body = re.sub(
            r"\$fromAI\('kpisPayload',\s*'[^']*'\)",
            f"$fromAI('kpisPayload', '{SAFE_DESC}')",
            body
        )
        node['parameters']['jsonBody'] = new_body
        print(f'  New jsonBody[:100]: {new_body[:100]}')
        print('  -> Tool: Calcular KPIs: descripcio corregida sense apostrofos')

settings = wf.get('settings', {})
allowed = {k: settings[k] for k in ['executionOrder', 'callerPolicy'] if k in settings}
body = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': allowed,
    'staticData': wf.get('staticData'),
}
payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
result = api(f'/workflows/{WF_ID}', 'PUT', payload)
print(f'PUT OK - {len(result["nodes"])} nodes')
time.sleep(2)

api(f'/workflows/{WF_ID}/activate', 'POST')
print('activate OK')
print('Desplegat correctament!')
