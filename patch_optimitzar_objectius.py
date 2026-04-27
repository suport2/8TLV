"""
Afegeix els objectius cost_minim i potencia_max al node Preparar context agent
de l'API Principal (C7MF5lX9Hspx50gh), i actualitza el prompt del Message a model
perque retorni produccio_anual_kwh en els kpis.
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

NEW_PREPARAR_CONTEXT = r"""const b = $('POST /solenver/optimitzar').first().json.body || $('POST /solenver/optimitzar').first().json;

let consum_anual = b.consum_anual || 0;
if (!consum_anual && b.consumos) {
  consum_anual = Object.values(b.consumos).reduce((s, v) => s + (v.p1||0) + (v.p2||0) + (v.p3||0), 0);
}
let cost_actual = b.cost_actual || 0;
if (!cost_actual && b.consumos && b.economics) {
  const e = b.economics;
  cost_actual = Object.values(b.consumos).reduce((s, v) =>
    s + (v.p1||0)*e.preu_p1 + (v.p2||0)*e.preu_p2 + (v.p3||0)*e.preu_p3, 0);
}

const objectiuMap = {
  roi_max:       "Maximitza el retorn de la inversió (minimitza el payback). Prioritza configuracions amb estalvi alt respecte cost.",
  autoconsum_max:"Maximitza el percentatge d'autoconsum (màxima autonomia, mínima dependència de la xarxa).",
  pressupost:    `Ajusta al pressupost màxim de ${b.pressupost_max || '?'} €. No superar-lo en cap cas. Tria el major dimensionat possible dins d'aquest límit.`,
  van_max:       "Maximitza el benefici net total a 25 anys (VAN). Prioritza la configuració amb major retorn econòmic a llarg termini.",
  cost_minim:    "Troba la instal·lació mínima viable: menor cost possible amb un payback inferior a 10 anys. Prioritza la solució més econòmica per al client.",
  potencia_max:  `Maximitza la potència instal·lada aprofitant tota la superfície disponible (${b.client?.superficie || '?'} m²). Posa el màxim de mòduls que cabria.`,
};
const objectiu_instruccions = objectiuMap[b.meta?.objectiu_ia || 'roi_max'] || objectiuMap['roi_max'];

const kpisBase = {
  num_moduls:           b.instalacio?.num_moduls || 12,
  potencia_wp:          b.instalacio?.potencia_wp || 510,
  potencia_inversor_kw: b.instalacio?.potencia_inversor_kw || 6,
  perfil_client:        b.instalacio?.perfil_client || 'domestica_residencial',
  trifasic:             b.instalacio?.trifasic || false,
  lat:                  b.client?.lat || 41.39,
  lng:                  b.client?.lng || 2.17,
  inclinacio:           b.instalacio?.inclinacio || 30,
  orientacio:           b.instalacio?.orientacio || 0,
  consum_anual:         Math.round(consum_anual),
  consum_p1:            b.consum_p1 || null,
  consum_p2:            b.consum_p2 || null,
  consum_p3:            b.consum_p3 || null,
  preu_p1:              b.economics?.preu_p1 || 0.2267,
  preu_p2:              b.economics?.preu_p2 || 0.1384,
  preu_p3:              b.economics?.preu_p3 || 0.0877,
  preu_excedent:        b.economics?.preu_excedent || 0.065,
};

return [{json: {
  ...b,
  consum_anual: Math.round(consum_anual),
  cost_actual: Math.round(cost_actual * 100) / 100,
  objectiu_instruccions,
  kpisBase: JSON.stringify(kpisBase),
}}];"""

NEW_SYSTEM_MSG = (
    "Ets l'expert fotovoltaic de Solenver. Tens dues eines:\n"
    "- Consultar cataleg: retorna mòduls, inversors i muntatges disponibles (amb els seus IDs)\n"
    "- Calcular KPIs: calcula producció, autoconsum, estalvi, retorn per una configuració\n"
    "\n"
    "PROCÉS:\n"
    "1. Crida 'Consultar cataleg' per veure components disponibles\n"
    "2. Prova 2-3 configuracions variant num_moduls (usa el kpisBase del client com a base)\n"
    "3. Crida 'Calcular KPIs' per a cada configuració provada - OBLIGATORI\n"
    "4. Tria la millor opció basant-te en els KPIs REALS retornats pel motor\n"
    "5. RETORNA ÚNICAMENT UN OBJECTE JSON PLA. PROHIBIT usar ```json, ```, markdown. NOMES el JSON directament.\n"
    "\n"
    "IMPORTANT:\n"
    "- modul_id, inversor_id, muntatge_id han de ser els IDs EXACTES del catàleg (no el nom)\n"
    "- Els valors de kpis han de venir EXACTAMENT dels resultats de 'Calcular KPIs'. MAI inventes xifres.\n"
    "- El camp produccio_anual_kwh és OBLIGATORI als kpis.\n"
    "\n"
    "OBJECTIU: ={{ $json.objectiu_instruccions }}\n"
    "\n"
    'JSON de resposta (sense markdown):\n'
    '{"configuracio":{"modul_id":"id","inversor_id":"id","muntatge_id":"id","num_moduls":12,"kwp_resultant":6.12,"inclinacio_optima":30},'
    '"kpis":{"produccio_anual_kwh":7249,"autoconsum_pct":67.3,"estalvi_any1":909,"retorn_anys":8.2,"van_25anys":14853,"co2_anual_kg":2100},'
    '"alternativa":{"num_moduls":10,"justificacio":"text"},'
    '"informe":{"seccio_objecte":"text","recomanacio_bateria":"text"}}'
)

for node in wf['nodes']:
    if node['name'] == 'Preparar context agent':
        node['parameters']['jsCode'] = NEW_PREPARAR_CONTEXT
        print('  -> Preparar context agent actualitzat')
    elif node['name'] == 'Message a model':
        params = node['parameters']
        if 'responses' in params and 'values' in params['responses']:
            for val in params['responses']['values']:
                if val.get('role') == 'system':
                    val['content'] = NEW_SYSTEM_MSG
                    print('  -> Message a model system message actualitzat')

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
