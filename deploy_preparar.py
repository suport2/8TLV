import json, urllib.request, urllib.error
import sys
sys.stdout.reconfigure(encoding='utf-8')

N8N_URL = "https://geri.app.n8n.cloud/api/v1"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZThkZDQwYi01YjQxLTRhYmUtOTM5ZS1mYzZkNWMzMDQwMTciLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNTJkOWNhYmEtNGExMy00NDJiLTgyNDEtMTRmN2RlNjRiZGQ2IiwiaWF0IjoxNzczMzk4MTQyfQ.xg4N7hKvq6vMhMqi-3htp8sYTLC1CFy2euUMCdyMWTo"
WF_ID = "C7MF5lX9Hspx50gh"

with open('C:/Users/SOLENVER-OF15/8TLV/preparar_current.js', encoding='utf-8') as f:
    preparar_code = f.read()

req = urllib.request.Request(f"{N8N_URL}/workflows/{WF_ID}",
    headers={"X-N8N-API-KEY": API_KEY, "Accept": "application/json"})
with urllib.request.urlopen(req) as r:
    wf = json.loads(r.read().decode('utf-8'))

updated = False
for node in wf['nodes']:
    if node['name'] == 'Preparar dades document':
        node['parameters']['jsCode'] = preparar_code
        print(f"preparar_current.js aplicat, chars: {len(preparar_code)}")
        updated = True

if not updated:
    print("ERROR: node 'Preparar dades document' no trobat")
    sys.exit(1)

settings = wf.get("settings", {})
allowed = {k: settings[k] for k in ['executionOrder', 'callerPolicy'] if k in settings}
body = {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
        "settings": allowed, "staticData": wf.get("staticData")}

payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
req2 = urllib.request.Request(f"{N8N_URL}/workflows/{WF_ID}", data=payload, method="PUT",
    headers={"X-N8N-API-KEY": API_KEY, "Content-Type": "application/json; charset=utf-8", "Accept": "application/json"})
try:
    with urllib.request.urlopen(req2) as r:
        result = json.loads(r.read().decode('utf-8'))
        print(f"Workflow guardat OK. Nodes: {len(result['nodes'])}")
except urllib.error.HTTPError as e:
    print(f"Error {e.code}: {e.read().decode('utf-8')[:400]}")
