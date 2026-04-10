import json, urllib.request, urllib.error
import sys
sys.stdout.reconfigure(encoding='utf-8')

N8N_URL = "https://geri.app.n8n.cloud/api/v1"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZThkZDQwYi01YjQxLTRhYmUtOTM5ZS1mYzZkNWMzMDQwMTciLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNTJkOWNhYmEtNGExMy00NDJiLTgyNDEtMTRmN2RlNjRiZGQ2IiwiaWF0IjoxNzczMzk4MTQyfQ.xg4N7hKvq6vMhMqi-3htp8sYTLC1CFy2euUMCdyMWTo"
WF_ID = "C7MF5lX9Hspx50gh"

req = urllib.request.Request(f"{N8N_URL}/workflows/{WF_ID}",
    headers={"X-N8N-API-KEY": API_KEY, "Accept": "application/json"})
with urllib.request.urlopen(req) as r:
    wf = json.loads(r.read().decode('utf-8'))

# Fix PVGIS node: paths correctes per l'estructura nested del payload
for node in wf['nodes']:
    if node['name'] == 'PVGIS - Producció solar':
        node['parameters']['queryParameters'] = {
            "parameters": [
                {"name": "lat",         "value": "={{ $json.body?.client?.lat || $json.body?.lat || 41.39 }}"},
                {"name": "lon",         "value": "={{ $json.body?.client?.lng || $json.body?.lng || 2.17 }}"},
                {"name": "peakpower",   "value": "1"},
                {"name": "loss",        "value": "14"},
                {"name": "angle",       "value": "={{ $json.body?.instalacio?.inclinacio || $json.body?.inclinacio || 30 }}"},
                {"name": "aspect",      "value": "={{ $json.body?.instalacio?.acimut || $json.body?.acimut || 0 }}"},
                {"name": "outputformat","value": "json"},
            ]
        }
        print("PVGIS node paths corregits")
        break

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
