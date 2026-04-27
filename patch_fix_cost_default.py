"""
Fix definitiu retorn_anys:
Calcular KPIs usa preus per defecte (71.50 EUR/modul, 793 EUR/inversor)
quan no li venen explicitament -> sempre calcula cost_instalacio -> sempre retorna retorn_anys
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

# The cost block I added previously
OLD_COST_BLOCK = '''// ── Cost instal·lació (si no ve calculat) ─────────────────────────
const preu_modul_in    = input.preu_modul     || 0;
const preu_inversor_in = input.preu_inversor  || 0;
let costInst = cost_instalacio || 0;
if (!costInst && (preu_modul_in > 0 || preu_inversor_in > 0)) {
  const ma_base   = parseFloat(PARAMS.ma_obra_base)       || 600;
  const ma_modul  = parseFloat(PARAMS.ma_obra_per_modul)  || 80;
  const projecte  = parseFloat(PARAMS.projecte_tecnic)    || 550;
  const cables_m  = parseFloat(PARAMS.cables_per_metre)   || 4.50;
  const base = num_moduls * preu_modul_in + preu_inversor_in
             + (ma_base + ma_modul * num_moduls) + projecte + (cables_m * 15);
  costInst = Math.round(base * (1 + MARGE) * 100) / 100;
}'''

# New: always calculate cost when cost_instalacio is not provided
# Use input.preu_modul if available, else default 71.50 (same as preparar_current.js)
NEW_COST_BLOCK = '''// ── Cost instal·lació (calculat si no ve explicitament) ──────────
// Preus per defecte = preus cost sense marge del cataleg estandard
const preu_modul_in    = parseFloat(input.preu_modul)     || 71.50;
const preu_inversor_in = parseFloat(input.preu_inversor)  || 793;
let costInst = cost_instalacio || 0;
if (!costInst) {
  const ma_base   = parseFloat(PARAMS.ma_obra_base)       || 600;
  const ma_modul  = parseFloat(PARAMS.ma_obra_per_modul)  || 80;
  const projecte  = parseFloat(PARAMS.projecte_tecnic)    || 550;
  const cables_m  = parseFloat(PARAMS.cables_per_metre)   || 4.50;
  const base = num_moduls * preu_modul_in + preu_inversor_in
             + (ma_base + ma_modul * num_moduls) + projecte + (cables_m * 15);
  costInst = Math.round(base * (1 + MARGE) * 100) / 100;
}'''

for node in wf['nodes']:
    if node['name'] == 'Calcular KPIs':
        code = node['parameters']['jsCode']
        if OLD_COST_BLOCK in code:
            node['parameters']['jsCode'] = code.replace(OLD_COST_BLOCK, NEW_COST_BLOCK)
            print('  -> Calcular KPIs: preus per defecte aplicats (sempre calcula cost)')
        else:
            # Try to find any version of the block
            if 'preu_modul_in' in code:
                print('  WARNING: bloc existent pero no coincideix exactament')
                print(f'  Context: {code[code.find("preu_modul_in")-50:code.find("preu_modul_in")+200]}')
            else:
                print('  WARNING: preu_modul_in no trobat')

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
