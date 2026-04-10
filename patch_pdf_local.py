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

# 1. Afegir node "Retornar HTML document" (respondToWebhook que retorna l'HTML)
new_node = {
    "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ success: true, html: $json.html, id_estudi: $('Preparar dades document').first().json.id_estudi }) }}",
        "options": {
            "responseHeaders": {
                "entries": [
                    {"name": "Content-Type", "value": "application/json"},
                    {"name": "Access-Control-Allow-Origin", "value": "*"}
                ]
            }
        }
    },
    "id": "retornar-html-document",
    "name": "Retornar HTML document",
    "type": "n8n-nodes-base.respondToWebhook",
    "typeVersion": 1.1,
    "position": [1744, 1088]
}

# Eliminar si ja existeix
wf['nodes'] = [n for n in wf['nodes'] if n['name'] != 'Retornar HTML document']
wf['nodes'].append(new_node)
print(f"Node 'Retornar HTML document' afegit")

# 2. Redirigir connexió: Generar HTML final → Retornar HTML document (en lloc de PDFShift)
conns = wf.get('connections', {})
conns['Generar HTML final'] = {
    "main": [[{"node": "Retornar HTML document", "type": "main", "index": 0}]]
}
wf['connections'] = conns
print("Connexio Generar HTML final → Retornar HTML document aplicada")

# 3. Pujar workflow
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
