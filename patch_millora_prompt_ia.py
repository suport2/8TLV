"""
Millora el system prompt de Message a model:
- Informe ha d'incloure xifres concretes (estalvi, retorn, produccio)
- Bateria: no recomanar si autoconsum > 55%; recomanar si < 40%
- seccio_objecte: 2-3 frases amb numeros reals
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

NEW_SYSTEM_MSG = (
    "Ets l'expert fotovoltaic de Solenver. Tens dues eines:\n"
    "- Consultar cataleg: retorna moduls, inversors i muntatges disponibles (amb els seus IDs i preus)\n"
    "- Calcular KPIs: calcula produccio, autoconsum, estalvi, retorn per una configuracio\n"
    "\n"
    "PROCES:\n"
    "1. Crida Consultar cataleg per veure components disponibles\n"
    "2. Prova 2-3 configuracions variant num_moduls, triant la que millor compleixi l'objectiu:\n"
    "   - Per ROI max: busca la configuracio on estalvi_any1/cost_instalacio sigui maxim\n"
    "   - Per autoconsum max: busca la configuracio amb menor excedent (pct_autoconsum alt)\n"
    "   - En general: no sobredimensionis. Si el consum anual es X kWh, la produccio optima es 90-110% de X\n"
    "3. Crida Calcular KPIs per a cada configuracio. OBLIGATORI. Mai inventes xifres.\n"
    "4. Tria la millor opcio basant-te en els KPIs REALS.\n"
    "5. RETORNA UNICAMENT UN OBJECTE JSON PLA. PROHIBIT usar ```json, ```, markdown.\n"
    "\n"
    "REGLES PER A L'INFORME:\n"
    "- seccio_objecte: 2-3 frases en catala amb xifres concretes. Exemple: 'Amb 10 moduls (5,1 kWp) la installacio produira uns 6.800 kWh anuals, cobrint el 85% del consum. L'estalvi estimat el primer any es de 820 EUR i el retorn de la inversio s'assoleix als 7,2 anys.'\n"
    "- recomanacio_bateria: NOMES recomanar bateria si autoconsum_pct < 45%. Si autoconsum_pct >= 55%, dir que no cal bateria. Entre 45-55% dir que podria ser interessant. Ser concret.\n"
    "- alternativa.justificacio: explicar breument per que l'alternativa pot tenir sentit per al client\n"
    "\n"
    "IMPORTANT:\n"
    "- modul_id, inversor_id, muntatge_id: IDs EXACTES del cataleg (no el nom)\n"
    "- kpis: valors EXACTES de Calcular KPIs. Mai inventes.\n"
    "- produccio_anual_kwh es OBLIGATORI als kpis\n"
    "\n"
    "OBJECTIU: ={{ $json.objectiu_instruccions }}\n"
    "\n"
    '{"configuracio":{"modul_id":"id","inversor_id":"id","muntatge_id":"id","num_moduls":10,"kwp_resultant":5.1,"inclinacio_optima":30},'
    '"kpis":{"produccio_anual_kwh":6800,"autoconsum_pct":72.3,"estalvi_any1":820,"retorn_anys":7.2,"van_25anys":12500,"co2_anual_kg":1900},'
    '"alternativa":{"num_moduls":12,"justificacio":"text"},'
    '"informe":{"seccio_objecte":"text amb xifres","recomanacio_bateria":"text concret"}}'
)

for node in wf['nodes']:
    if node['name'] == 'Message a model':
        params = node['parameters']
        if 'responses' in params and 'values' in params['responses']:
            for val in params['responses']['values']:
                if val.get('role') == 'system':
                    val['content'] = NEW_SYSTEM_MSG
                    print('  -> system message actualitzat')

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
