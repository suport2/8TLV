import json, uuid, urllib.request, urllib.error, sys
sys.stdout.reconfigure(encoding='utf-8')

N8N_URL = "https://geri.app.n8n.cloud/api/v1"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZThkZDQwYi01YjQxLTRhYmUtOTM5ZS1mYzZkNWMzMDQwMTciLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNTJkOWNhYmEtNGExMy00NDJiLTgyNDEtMTRmN2RlNjRiZGQ2IiwiaWF0IjoxNzczMzk4MTQyfQ.xg4N7hKvq6vMhMqi-3htp8sYTLC1CFy2euUMCdyMWTo"
WF_ID = "C7MF5lX9Hspx50gh"

with open('C:/Users/SOLENVER-OF15/8TLV/preparar_pdf_gpt.js', encoding='utf-8') as f:
    preparar_code = f.read()
with open('C:/Users/SOLENVER-OF15/8TLV/normalitzar_resposta_factura.js', encoding='utf-8') as f:
    normalitzar_code = f.read()

req = urllib.request.Request(f"{N8N_URL}/workflows/{WF_ID}",
    headers={"X-N8N-API-KEY": API_KEY, "Accept": "application/json"})
with urllib.request.urlopen(req) as r:
    wf = json.loads(r.read().decode('utf-8'))
print(f"Workflow carregat. Nodes existents: {len(wf['nodes'])}")

# Eliminar nodes anteriors del mateix endpoint (si redeployem)
noms_a_eliminar = {
    'POST /solenver/extreure-factura',
    'Preparar PDF per GPT',
    'GPT-4o Extractor Factura',
    'Normalitzar resposta factura',
    'Retornar dades factura',
}
wf['nodes'] = [n for n in wf['nodes'] if n['name'] not in noms_a_eliminar]
print(f"Nodes després de netejar: {len(wf['nodes'])}")

# Generar IDs únics
id_webhook     = str(uuid.uuid4())
id_preparar    = str(uuid.uuid4())
id_gpt         = str(uuid.uuid4())
id_normalitzar = str(uuid.uuid4())
id_retornar    = str(uuid.uuid4())

# Posicions (columna nova a la dreta, y=1500)
PX, PY = 1200, 1500

nodes_nous = [
    {
        "id": id_webhook,
        "name": "POST /solenver/extreure-factura",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [PX, PY],
        "parameters": {
            "httpMethod": "POST",
            "path": "solenver/extreure-factura",
            "responseMode": "responseNode",
            "options": {}
        }
    },
    {
        "id": id_preparar,
        "name": "Preparar PDF per GPT",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [PX + 240, PY],
        "parameters": {
            "jsCode": preparar_code
        }
    },
    {
        "id": id_gpt,
        "name": "GPT-4o Extractor Factura",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4,
        "position": [PX + 480, PY],
        "parameters": {
            "url": "https://api.openai.com/v1/chat/completions",
            "method": "POST",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "openAiApi",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "Content-Type", "value": "application/json"}
                ]
            },
            "sendBody": True,
            "specifyBody": "string",
            "body": "={{ JSON.stringify($('Preparar PDF per GPT').first().json.request_body) }}",
            "options": {
                "timeout": 120000
            }
        },
        "credentials": {
            "openAiApi": {
                "id": "70aNKhDyso3Lv3JX",
                "name": "OpenAi account"
            }
        }
    },
    {
        "id": id_normalitzar,
        "name": "Normalitzar resposta factura",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [PX + 720, PY],
        "parameters": {
            "jsCode": normalitzar_code
        }
    },
    {
        "id": id_retornar,
        "name": "Retornar dades factura",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1,
        "position": [PX + 960, PY],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ $json }}",
            "options": {
                "responseHeaders": {
                    "entries": [
                        {"name": "Content-Type", "value": "application/json"},
                        {"name": "Access-Control-Allow-Origin", "value": "*"}
                    ]
                }
            }
        }
    },
]

wf['nodes'].extend(nodes_nous)

# Afegir connexions
connections = wf.get('connections', {})
n_wh  = "POST /solenver/extreure-factura"
n_pre = "Preparar PDF per GPT"
n_gpt = "GPT-4o Extractor Factura"
n_nor = "Normalitzar resposta factura"
n_ret = "Retornar dades factura"

connections[n_wh]  = {"main": [[{"node": n_pre, "type": "main", "index": 0}]]}
connections[n_pre] = {"main": [[{"node": n_gpt, "type": "main", "index": 0}]]}
connections[n_gpt] = {"main": [[{"node": n_nor, "type": "main", "index": 0}]]}
connections[n_nor] = {"main": [[{"node": n_ret, "type": "main", "index": 0}]]}
wf['connections'] = connections

# PUT workflow
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
        print(f"Workflow guardat OK. Nodes totals: {len(result['nodes'])}")
        # Verificar que els nodes nous hi són
        noms_resultat = [n['name'] for n in result['nodes']]
        for nom in [n_wh, n_pre, n_gpt, n_nor, n_ret]:
            status = "OK" if nom in noms_resultat else "MANCA"
            print(f"  {status}: {nom}")
except urllib.error.HTTPError as e:
    print(f"Error {e.code}: {e.read().decode('utf-8')[:600]}")
