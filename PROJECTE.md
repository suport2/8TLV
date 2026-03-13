# Solenver — Sistema d'Estudis Fotovoltaics v2.0

## Descripció
Sistema automatitzat per generar estudis tècnico-econòmics de instal·lacions fotovoltaiques.
El comercial omple un formulari web → el sistema calcula → genera un PDF professional → l'envia al client per email.

## Arquitectura actual

```
index.html  (formulari web, 6 seccions, KPIs en temps real)
    ↓ POST JSON
n8n cloud (app.n8n.cloud) — tots els fluxos visibles aquí
    ↓
Google Sheets (base de dades del catàleg i historial)
    ↓
Google Drive (guardar PDFs)  +  Gmail (enviar al client)  +  Slack (notificacions)
```

## Fitxers del projecte

| Fitxer | Funció |
|--------|--------|
| `index.html` | Formulari web complet — 6 seccions, catàleg dinàmic, KPIs live |
| `app.py` | Servidor Flask (backend Python, temporal fins migrar tot a n8n) |
| `calculator.py` | Motor de càlcul fotovoltaic (reprodueix CALCULADORA_v2.xlsx) |
| `cataleg.py` | Catàleg de mòduls, inversors, muntatges i preus |
| `pdf_generator.py` | Generador PDF ReportLab (9 seccions, gràfics vectorials) |
| `optimizer.py` | Agent IA optimitzador (crida Claude Sonnet) |
| `maps_client.py` | Google Maps Static API (foto aèria per al PDF) |
| `cups_parser.py` | Parser fitxers XLS del CUPS (Red Eléctrica) |

## Google Sheets
**ID:** `1W67iKzO4pJib2BOLrRCILmbuCTiAoWJ-ge-GNayDGpU`
**URL:** https://docs.google.com/spreadsheets/d/1W67iKzO4pJib2BOLrRCILmbuCTiAoWJ-ge-GNayDGpU

### Fulles:
- `moduls` — catàleg mòduls FV (JINKO Tiger Neo)
- `inversors` — catàleg inversors (Huawei SUN2000)
- `muntatges` — tipus de muntatge i preus
- `comercials` — equip comercial
- `estudis` — historial de tots els estudis generats

### Columnes fulla `estudis`:
data | id_estudi | client_nom | client_nif | adreca | kwp | consum_kwh | estalvi_eur | retorn_anys | cost_eur | comercial | url_pdf | estat

## n8n Cloud
**URL:** https://geri.app.n8n.cloud
**MCP:** https://geri.app.n8n.cloud/mcp-server/http

### Workflows actuals:
- `Solenver - Catàleg API` — GET /solenver/cataleg → llegeix les 4 fulles del Sheets i retorna JSON

### Workflows pendents de crear:
- `Solenver - Calcular KPIs` — rep dades formulari, calcula i retorna KPIs ràpids
- `Solenver - Generar Estudi` — flux complet: calcular → IA → PDF → Drive → Gmail → Sheets
- `Solenver - Guardar Estudi` — registra a la fulla `estudis` del Sheets

## Formulari web (index.html)

### 6 seccions:
1. **Client** — nom, NIF, adreça, CUPS, email, telèfon
2. **Ubicació** — lat/lng, orientació (acimut), inclinació, tipus coberta, ombres
3. **Instal·lació** — mode Manual o mode IA; selecció mòdul/inversor/muntatge des de Sheets
4. **Consums** — taula 12 mesos (P1/P2/P3), upload XLS CUPS, o total anual
5. **Econòmics** — cost instal·lació, increment energia %, manteniment, anys anàlisi
6. **Enviar** — resum, comercial, toggle email client, notes internes, botons PDF

### Catàleg dinàmic:
El formulari carrega mòduls/inversors/muntatges/comercials des de n8n → Google Sheets.
Endpoint: `GET https://geri.app.n8n.cloud/webhook/solenver/cataleg`

### KPIs en temps real:
Cada canvi al formulari fa un POST a n8n per calcular i mostrar:
- Potència kWp
- Estalvi €/any
- Retorn inversió (anys)
- % Autoconsum
- Producció kWh/any
- CO₂ estalviat kg/any

## Motor de càlcul fotovoltaic

### Passos del càlcul:
1. Irradiació solar (PVGIS o taula interna per lat/lng/inclinació/acimut)
2. Producció bruta FV (kWp × HSP × dies × factor pèrdues)
3. Autoconsum/excedents (perfil horari de coincidència solar)
4. Anàlisi econòmica mensual (cost actual vs cost amb FV)
5. Cashflow 25 anys (degradació 0.4%/any, increment energia 2.5%/any)
6. KPIs: TIR, VAN, retorn inversió, CO₂ estalviat

### Factors de pèrdues del sistema:
- Cable: 1.5%
- Inversor: 8%
- Brutícia: 2%
- Temperatura: 2.5%
- Degradació anual: 0.4%

## PDF (9 seccions)
§0 Portada — KPIs destacats, dades client
§1 Qui som — presentació Solenver
§2 Situació energètica — foto aèria, taula consums
§3 Instal·lació proposada — specs tècniques
§3.5 Proposta IA (opcional) — justificació agent IA
§4 Producció solar — gràfics barres + donut
§5 Anàlisi econòmica — costos actual vs FV
§6 Retorn inversió — cashflow 25 anys
§7 Pressupost detallat — taula components + IVA
§8 Garanties i propers passos

## Agent IA Optimitzador
- Model: Claude Sonnet (claude-sonnet-4-6)
- Objectius: ROI màxim / Autoconsum màxim / Cost mínim / Potència màxima
- Flux: itera 4-50 mòduls → selecciona top 5 → Claude tria i justifica en català
- Output: configuració recomanada + justificació 3 frases per al client

## Catàleg de materials

### Mòduls (JINKO Tiger Neo N-type):
- 510Wp — 66.30€/u
- 540Wp — 70.20€/u
- 550Wp — 71.50€/u
- 580Wp — 75.40€/u
- 600Wp — 78.00€/u

### Inversors Huawei (monofàsic):
- SUN2000-2KTL-L1 (2kW) — 437€
- SUN2000-3KTL-L1 (3kW) — 512€
- SUN2000-4KTL-L1 (4kW) — 629€
- SUN2000-5KTL-L1 (5kW) — 682€
- SUN2000-6KTL-L1 (6kW) — 793€

### Inversors Huawei (trifàsic):
- SUN2000-6KTL-M1 (6kW) — 903€
- SUN2000-10KTL-M1 (10kW) — 1121€
- SUN2000-15KTL-M2 (15kW) — 1424€
- SUN2000-20KTL-M2 (20kW) — 1533€

### Muntatges:
- Coplanar teula — 612€
- Coplanar xapa — 550€
- Supraestructura inclinada — 780€
- Coberta plana lastrada — 720€
- Terra — 850€
- Pèrgola solar — 1200€

## Costos fixes instal·lació
- Mà d'obra base: 1.200€
- Projecte tècnic + legalització: 550€
- Cable CC: 2.50€/m
- Cable CA: 1.80€/m
- IVA: 21%

## Paleta corporativa Solenver
- Verd fosc: #1B5E20
- Verd: #2E7D32
- Verd clar: #4CAF50
- Fons verd: #E8F5E9

## Estat actual del projecte
- ✅ Formulari web complet (index.html)
- ✅ Backend Python funcional (app.py + mòduls)
- ✅ Google Sheets creat amb les 5 fulles
- ✅ Workflow n8n "Catàleg API" importat
- ✅ Claude Code connectat a n8n via MCP
- ⏳ Assignar credencials Google als nodes del workflow
- ⏳ Activar workflow Catàleg API i provar endpoint
- ⏳ Crear workflow "Calcular KPIs"
- ⏳ Crear workflow "Generar Estudi" (flux complet)
- ⏳ Migrar càlculs de Python a Function nodes de n8n
- ⏳ Integrar generació PDF a n8n
- ⏳ Connectar index.html amb endpoints n8n

## Pròxims passos
1. Activar workflow Catàleg API i verificar URL webhook
2. Actualitzar index.html perquè carregui catàleg des de n8n
3. Crear workflow de càlcul de KPIs en temps real
4. Crear workflow complet de generació d'estudi
5. Substituir backend Python per workflows n8n

## Notes importants
- Tot el codi de càlcul ha de poder viure dins Function nodes de n8n (JavaScript)
- Els preus del catàleg es gestionen des de Google Sheets — NO al codi
- El formulari (index.html) és un fitxer HTML estàtic sense dependències
- L'agent IA usa l'API d'Anthropic directament des de n8n via HTTP node
