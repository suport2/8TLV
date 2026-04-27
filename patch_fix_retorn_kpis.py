"""
Fix retorn_anys = null al flux Optimitzar amb IA:
1. Calcular KPIs: si cost_instalacio no ve, el calcula des de preu_modul + preu_inversor + PARAMS
2. Preparar context agent: afegeix preu_modul i preu_inversor típics al kpisBase
3. Tool: Calcular KPIs: actualitza descripció per incloure preu_modul i preu_inversor
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

# ─── 1. Calcular KPIs: afegir cost_instalacio calculation ────────
# Llegir el codi actual i modificar la part del costInst
COST_CALC_PATCH = '''
// ── Cost instal·lació (si no ve calculat) ─────────────────────────
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
}
'''

# ─── 2. Preparar context agent: afegir preus al kpisBase ─────────
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
  preu_modul:           b.instalacio?.preu_modul || 71.50,
  preu_inversor:        b.instalacio?.preu_inversor || 793,
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

for node in wf['nodes']:
    if node['name'] == 'Preparar context agent':
        node['parameters']['jsCode'] = NEW_PREPARAR_CONTEXT
        print('  -> Preparar context agent actualitzat (preu_modul + preu_inversor)')

    elif node['name'] == 'Calcular KPIs':
        code = node['parameters']['jsCode']
        # Replace "const costInst = cost_instalacio || 0;" with the full calculation block
        old = 'const costInst = cost_instalacio || 0;'
        new_code = COST_CALC_PATCH.strip()
        if old in code:
            node['parameters']['jsCode'] = code.replace(old, new_code)
            print('  -> Calcular KPIs: cost auto-calculat des de preu_modul + preu_inversor')
        else:
            print('  WARNING: "const costInst" no trobat al codi de Calcular KPIs')

    elif node['name'] == 'Tool: Calcular KPIs':
        # Update tool description to mention preu_modul and preu_inversor
        params = node['parameters']
        old_desc = "JSON amb els parametres de la installacio: num_moduls, potencia_wp, potencia_inversor_kw, perfil_client, trifasic, lat, lng, inclinacio, orientacio, consum_anual, consum_p1 (array 12), consum_p2 (array 12), consum_p3 (array 12), preu_p1, preu_p2, preu_p3, preu_excedent"
        new_desc = "JSON amb els parametres de la installacio: num_moduls, potencia_wp, preu_modul (preu sense marge per modul, del cataleg), preu_inversor (preu sense marge de l'inversor, del cataleg), potencia_inversor_kw, perfil_client, trifasic, lat, lng, inclinacio, orientacio, consum_anual, preu_p1, preu_p2, preu_p3, preu_excedent. IMPORTANT: inclou sempre preu_modul i preu_inversor del cataleg per calcular el retorn de la inversio."
        if old_desc in str(params.get('jsonBody', '')):
            node['parameters']['jsonBody'] = params['jsonBody'].replace(old_desc, new_desc)
            print('  -> Tool: Calcular KPIs: descripció actualitzada')
        else:
            print(f'  WARNING: Tool descripció no trobada. jsonBody: {str(params.get("jsonBody",""))[:100]}')

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
