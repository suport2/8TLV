# PROJECTE SOLENVER — Automatització Estudis Fotovoltaics v2.0
> Última actualització: 18 març 2026

---

## ARQUITECTURA GENERAL

```
Comercial omple formulari web
    ↓
GitHub Pages (index.html) → n8n Cloud → Google Sheets / Drive / Gmail
    ↓
PDF generat → Google Drive + email al client
```

### URLs i IDs clau
| Recurs | Valor |
|--------|-------|
| Formulari web | https://suport2.github.io/8TLV |
| n8n Cloud | https://geri.app.n8n.cloud |
| GitHub repo | https://github.com/suport2/8TLV |
| Google Sheets | 1W67iKzO4pJib2BOLrRCILmbuCTiAoWJ-ge-GNayDGpU |
| Google Doc template | 19Ok6mOYL7ye15VPuD5mzcxQTMbGC-NDh |
| motor_data.json | https://raw.githubusercontent.com/suport2/8TLV/main/motor_data.json |

---

## WORKFLOW n8n — "Solenver - API Principal" (44 nodes)

### Endpoints actius
- GET  /solenver/cataleg        ✅ Retorna mòduls, inversors, muntatges, comercials
- POST /solenver/calcular-kpis  ✅ Motor v5 hora×hora verificat vs Excel
- POST /solenver/generar-estudi ✅ Genera PDF via PDFShift + HTML template
- POST /solenver/optimitzar     ✅ AI Agent GPT-4o (optimitza + redacta informe)

### Flux generar-estudi (nodes en ordre)
```
POST /solenver/generar-estudi
  → [paral·lel] Preparar input KPIs
                Llegir paràmetres PDF  (Sheets: parametres)
                Llegir perfils PDF     (Sheets: perfils)
                Llegir costos PDF      (Sheets: costos_instalacio)
  → Merge estudi
  → Llegir dades motor PDF  (GET motor_data.json GitHub)
  → Calcular KPIs estudi    (Motor v5 JS)
  → [paral·lel] Llegir catàleg PDF    (Sheets: moduls)
                Llegir inversors PDF  (Sheets: inversors)
                Llegir muntatges PDF  (Sheets: muntatges)
  → Llegir comercials PDF   (Sheets: comercials)
  → Llegir configuració     (Sheets: configuracio)
  → Preparar dades document (JS - genera replacements + QuickChart URLs)
  → Llegir template HTML    (GET GitHub raw html)
  → Generar HTML final      (substitueix {{PLACEHOLDERS}})
  → PDFShift - Generar PDF
  → Pujar PDF a Drive
  → [paral·lel] Registrar a Sheets / Enviar email / Retornar resultat
```

---

## GOOGLE SHEETS — Fulles actives

| Fulla | Contingut clau |
|-------|----------------|
| moduls | id, model, potencia_wp, preu, foto_url, eficiencia, fabricant |
| inversors | id, model, potencia_kw, preu, foto_url, fabricant, sistema_monitoritzacio, trifasic |
| muntatges | id, nom, preu_modul, foto_url |
| comercials | id, nom, email, telefon |
| parametres | inflacio_energia=0.015, degradacio=0.004, iva=0.21, marge_comercial=0.35, taxa_descont=0.05, vida_util=25 |
| perfils | 24h × 8 sectors de consum |
| costos_instalacio | estructura per tipus (€/mòdul), materials |
| estudis | Historial PDFs generats |
| configuracio | IMG_LOGO, IMG_EMPRESA, GOOGLE_MAPS_KEY, EMAIL_EMPRESA, TELEFON_EMPRESA, WEB_EMPRESA, IMG_MONITORING_HUAWEI, IMG_MONITORING_FRONIUS, IMG_MONITORING_SMA, IMG_MONITORING_SOLAREDGE |

---

## MOTOR DE CÀLCUL v5

### Verificació (cas ILERLASER 12 mòduls 510Wp, lat 41)
- Producció: 8.000 kWh ✅ (Excel: 8.000)
- % Autoconsum: 41.8% ❌ (Excel: 34.0%) — pendent corregir
- Estalvi any 1: ~810€ ❌ (Excel: 669€) — conseqüència autoconsum erroni
- Retorn: 8.28 anys ≈ ✅ (Excel: 8.23)

### Lògica correcta (pendent implementar)
L'Excel usa columna DOMÈSTICA com a forma horària base per TOTS els clients.
El motor actual usa el shape del sector directament → autoconsum sobreestimat.
Solució: usar dom_shape per la forma horària + shape sector per estimar P1/P2/P3 sense factura.

### Cashflow (correcte)
estalvi_n = estalvi_1 × 1.015^(n-1)  [inflació 1.5%, SIN degradació a l'estalvi]

---

## PDF GENERAT — Estat actual

### Estructura (12 pàgines) i estat
- ✅ Portada (títol dinàmic, KPIs, foto aèria Google Maps)
- ✅ Qui som (text fix Solenver + foto empresa)
- ✅ Objecte + Dades client
- ✅ Situació energètica (taula P1/P2/P3 × 12 mesos)
- ❌ Gràfic consum mensual — falta línia acumulada taronja
- ✅ Instal·lació proposada (taula mòdul + taula inversor)
- ❌ Foto mòdul — foto_url al Sheets buit
- ❌ Foto estructura — foto_url al Sheets buit
- ❌ Captura sistema monitorització — pendent configurar
- ❌ Gràfic PV Production — bug: apuntava a urlGraficConsum (corregit, pendent verificar)
- ✅ Gràfic producció vs consum
- ✅ Anàlisi econòmica (KPIs + gràfic cost actual vs PV)
- ✅ Cashflow 25 anys (gràfic + taula)
- ✅ Pressupost detallat
- ✅ Garanties + propers passos
- ✅ Portfolio fotos projectes anteriors

### Problemes actius
1. **Gràfics sense línia acumulada** — verificar si URL QuickChart es renderitza correctament
2. **Bug IMG_GRAFIC_PV_PRODUCTION** — corregit al node però pendent verificar
3. **foto_url buit** — cal afegir URLs Drive al Sheets per moduls/inversors/muntatges
4. **Sistema monitorització** — afegir URL a fulla configuracio Sheets + placeholder {{IMG_MONITORING}} al template
5. **% Autoconsum incorrecte** — motor usa shape sector, hauria d'usar dom_shape

---

## FORMULARI WEB

### Mode Manual vs Mode IA
- **Manual**: comercial configura num_moduls, mòdul, inversor, muntatge manualment
- **IA**: clica "Generar proposta IA" → crida /solenver/optimitzar → agent GPT-4o consulta catàleg, calcula KPIs, omple formulari automàticament + redacta textos informe

### Sidebar KPIs (temps real)
Actualització automàtica mentre s'omple el formulari via POST /solenver/calcular-kpis

---

## AI AGENT SOLENVER (GPT-4o)

### Eines disponibles
- consultar_cataleg → GET /solenver/cataleg
- calcular_kpis → POST /solenver/calcular-kpis

### Output JSON esperat
```json
{
  "configuracio": { "num_moduls", "modul_id", "inversor_id", "muntatge_id", "inclinacio_optima", "kwp_resultant" },
  "kpis": { "produccio_anual", "autoconsum_pct", "estalvi_any1", "retorn_anys", "van_25anys", "benefici_net_25", "co2_25anys_kg" },
  "alternativa": { "num_moduls", "modul_id", "inversor_id", "justificacio" },
  "informe": {
    "titol", "seccio_objecte", "seccio_situacio_energetica",
    "seccio_instalacio", "seccio_produccio", "seccio_economia",
    "recomanacio_bateria", "recomanacio_subvencions"
  }
}
```

---

## PRÒXIMS PASSOS (per ordre)

### Avui (pendent)
1. Verificar gràfic consum mensual al navegador amb la URL QuickChart
2. Afegir URLs Drive a columna foto_url al Sheets (moduls, inversors, muntatges)
3. Afegir claus IMG_MONITORING_X a fulla configuracio Sheets
4. Verificar placeholder {{IMG_MONITORING}} al Google Doc template
5. Verificar correcció IMG_GRAFIC_PV_PRODUCTION al node

### Pròxima sessió
6. Corregir % autoconsum — usar dom_shape com a forma base al motor
7. Connectar textos de l'agent IA al generar-estudi (seccio_objecte, etc.)
8. Upload factura + API CUPS (Datadis) per omplir consums automàticament

### A llarg termini
9. Validació ratio inversor (alerta si kWp/kW > 1.3)
10. 3 templates PDF per tipus client (domèstic/PYME/corporatiu)
11. Lectura automàtica factura per IA

---

## DECISIONS CLAU PRESES

| Decisió | Motiu |
|---------|-------|
| n8n cloud (no Python/Flask) | Zero infraestructura, tot visual |
| PDFShift (no Google Docs) | Layout fix, gràfics inline estables |
| QuickChart.io | URLs simples, no requereix navegador |
| motor_data.json al GitHub | 126KB, evita sobrecarregar n8n |
| GPT-4o (no Claude) | API key OpenAI disponible |
| Inflació 1.5% | Verificat contra Excel CALCULADORA_v2.xlsx |
| Cashflow sense degradació | Igual que Excel: estalvi_n = estalvi_1 × 1.015^(n-1) |
