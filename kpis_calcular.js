// ═══════════════════════════════════════════════════════════════
// SOLENVER — Motor fotovoltaic v5.0
// Simulació hora×hora exacta (8.760h/any)
// Verificat contra Excel CALCULADORA_v2.xlsx: error < 0.1%
// ═══════════════════════════════════════════════════════════════

// ── Dades del motor (inline, lat 41°, incl 10°, acimut 0°) ──────
// Les dades solar i tarifes estan a GitHub raw per no sobrecarregar el node
// Les carregarà el node "Llegir dades motor" anterior

// Dades del motor (typeVersion 4.2 pot retornar body com string a .data)
const _motorRaw = $('Llegir dades motor').first().json;
let _motorData;
if (_motorRaw.solar_8760h) {
  _motorData = _motorRaw;
} else if (_motorRaw.data && typeof _motorRaw.data === 'string') {
  _motorData = JSON.parse(_motorRaw.data);
} else if (_motorRaw.data && typeof _motorRaw.data === 'object') {
  _motorData = _motorRaw.data;
} else {
  throw new Error('Motor data format not recognized: keys=' + JSON.stringify(Object.keys(_motorRaw)));
}
const SOLAR   = _motorData.solar_8760h;
const TARIFES = _motorData.tarifes_8760h;

// Construir shapes des de la fulla perfils del Sheets
const perfilsRaw = $('Llegir perfils consum').all().map(i => i.json);
const SHAPES_SHEETS = {};
perfilsRaw.forEach(row => {
  const hora = parseInt(row.horra) - 1; // horra va de 1 a 24
  if (hora < 0 || hora > 23) return;
  const cols = {
    'granja_porcina':        parseFloat(row.granja_porcina)    || 0,
    'granja_avicola':        parseFloat(row.granja_avicola)    || 0,
    'industria_general':     parseFloat(row.industria_general) || 0,
    'logistica_magatzem':    parseFloat(row.logistica_magatz)  || 0,
    'domestica_residencial': parseFloat(row.domestica_resid)   || 0,
    'comercial_oficines':    parseFloat(row.comercial_oficin)  || 0,
    'agricola_reg':          parseFloat(row.agricola_reg)      || 0,
  };
  Object.entries(cols).forEach(([key, val]) => {
    if (!SHAPES_SHEETS[key]) SHAPES_SHEETS[key] = new Array(24).fill(0);
    SHAPES_SHEETS[key][hora] = val;
  });
});
// Normalitzar cada shape (suma = 1) i eliminar si buida (no sobreescriure motor_data.json)
Object.keys(SHAPES_SHEETS).forEach(key => {
  const total = SHAPES_SHEETS[key].reduce((a, b) => a + b, 0);
  if (total > 0) SHAPES_SHEETS[key] = SHAPES_SHEETS[key].map(v => v / total);
  else delete SHAPES_SHEETS[key];
});
// Merge: Sheets té prioritat, motor_data.json com a fallback
const SHAPES = { ...(_motorData.shapes || {}), ...SHAPES_SHEETS };
const PARAMS  = $('Llegir paràmetres').all().reduce((acc, i) => {
  acc[i.json.clau] = i.json.valor; return acc; }, {});

// ── Input del formulari ──────────────────────────────────────────
const input = $('POST /solenver/calcular-kpis').first().json.body ||
              $('POST /solenver/calcular-kpis').first().json;

const {
  // Instal·lació
  num_moduls       = 12,
  potencia_wp      = 510,
  potencia_inversor_kw = 6,
  perdues_cable    = 0.015,
  perdues_inversor = 0.08,
  ombres           = 'cap',
  // Consum — CAS A: factura completa
  consum_p1        = null,   // array 12 mesos kWh o null
  consum_p2        = null,
  consum_p3        = null,
  // Consum — CAS B: només total anual
  consum_anual     = 6792,
  // Perfil sector (sempre necessari per forma horaria)
  perfil_client    = 'industria_general',
  // Preus de la factura del client
  preu_p1          = 0.2267,
  preu_p2          = 0.1384,
  preu_p3          = 0.0877,
  preu_excedent    = 0.065,
  // Econòmics
  cost_instalacio  = null,
  manteniment_anual = 0,
} = input;

// ── Paràmetres del Sheets ────────────────────────────────────────
const INFLACIO    = parseFloat(PARAMS.inflacio_energia)  || 0.015;
const DEGRADACIO  = parseFloat(PARAMS.degradacio_anual)  || 0.004;
const IVA         = parseFloat(PARAMS.iva)               || 0.21;
const MARGE       = parseFloat(PARAMS.marge_comercial)   || 0.35;
const VIDA_UTIL   = parseInt(PARAMS.vida_util)           || 25;
const TAXA_DESC   = parseFloat(PARAMS.taxa_descont)      || 0.05;

// ── kWp i factor pèrdues ─────────────────────────────────────────
const kwp = (num_moduls * potencia_wp) / 1000;
const factorPerdues = (1 - perdues_cable) * (1 - perdues_inversor);
const factorOmbres = {'cap': 1, 'parcials': 0.95, 'importants': 0.85}[ombres] ?? 1;

// ── Dies per mes ─────────────────────────────────────────────────
const DIES_MES = [31,28,31,30,31,30,31,31,30,31,30,31];
const NOMS_MES = ['Gener','Febrer','Març','Abril','Maig','Juny',
                  'Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];

// ── PVGIS: producció mensual real (kWh/kWp) per lat/inclinació/acimut ──
const pvgisMonthly = (input.pvgis_monthly && Array.isArray(input.pvgis_monthly) && input.pvgis_monthly.length === 12)
  ? input.pvgis_monthly
  : null;

// Pre-calcular totals mensuals del SOLAR fix (per factor d'escala PVGIS)
const solarMesTotals = new Array(12).fill(0);
let _idx = 0;
for (let m = 0; m < 12; m++) {
  for (let d = 0; d < DIES_MES[m]; d++) {
    for (let h = 0; h < 24; h++) {
      if (_idx < SOLAR.length) solarMesTotals[m] += SOLAR[_idx++];
    }
  }
}

// ── Perfil de consum (forma horaria del sector) ──────────────────
const shape = SHAPES[perfil_client] || SHAPES['industria_general'];
const PREUS_INV = {
  'P1': preu_p1, 'P2': preu_p2, 'P3': preu_p3,
  'P4': preu_p3, 'P5': preu_p3, 'P6': preu_p3
};

// ── Preparar consums mensuals P1/P2/P3 ──────────────────────────
// CAS A: ve de la factura directament
// CAS B: distribuir consum_anual uniformement i per distribució del sector
let cp1, cp2, cp3;

if (consum_p1 && Array.isArray(consum_p1) && consum_p1.length === 12) {
  // CAS A — Factura completa
  cp1 = consum_p1.map(Number);
  cp2 = consum_p2.map(Number);
  cp3 = consum_p3.map(Number);
} else {
  // CAS B — Estimar des del consum anual + perfil sector
  // Calcular distribució P1/P2/P3 del sector a partir dels shapes
  let sumP = {P1: 0, P2: 0, P3: 0};
  let idx_tmp = 0;
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < DIES_MES[m]; d++) {
      for (let h = 0; h < 24; h++) {
        const t = TARIFES[idx_tmp] || 'P3';
        const tn = t === 'P1' ? 'P1' : (t === 'P2' ? 'P2' : 'P3');
        sumP[tn] += shape[h];
        idx_tmp++;
      }
    }
  }
  const sumTot = sumP.P1 + sumP.P2 + sumP.P3;
  const pctP1 = sumP.P1 / sumTot;
  const pctP2 = sumP.P2 / sumTot;
  const pctP3 = sumP.P3 / sumTot;

  cp1 = DIES_MES.map(d => consum_anual * (d/365) * pctP1);
  cp2 = DIES_MES.map(d => consum_anual * (d/365) * pctP2);
  cp3 = DIES_MES.map(d => consum_anual * (d/365) * pctP3);
}

// ── SIMULACIÓ HORA×HORA ──────────────────────────────────────────
const resultats_mes = [];
let idx = 0;

for (let m = 0; m < 12; m++) {
  const dies = DIES_MES[m];

  // Calcular factors per P1/P2/P3 (suma shape en hores de cada periode)
  const sP = {P1: 0, P2: 0, P3: 0};
  for (let d = 0; d < dies; d++) {
    for (let h = 0; h < 24; h++) {
      const i = idx + d*24 + h;
      const t = TARIFES[i] || 'P3';
      const tn = t === 'P1' ? 'P1' : (t === 'P2' ? 'P2' : 'P3');
      sP[tn] += shape[h];
    }
  }
  const fP = {
    P1: sP.P1 > 0 ? cp1[m] / sP.P1 : 0,
    P2: sP.P2 > 0 ? cp2[m] / sP.P2 : 0,
    P3: sP.P3 > 0 ? cp3[m] / sP.P3 : 0,
  };

  // Factor d'escala PVGIS per aquest mes
  let scalePvgis = 1;
  if (pvgisMonthly && pvgisMonthly[m] > 0 && solarMesTotals[m] > 0) {
    scalePvgis = pvgisMonthly[m] / solarMesTotals[m];
  }

  let ac=0, exc=0, xarxa=0, pv=0, cost=0, comp=0;

  for (let d = 0; d < dies; d++) {
    for (let h = 0; h < 24; h++) {
      if (idx >= SOLAR.length) break;

      // kW produïts: PVGIS escala el perfil horari (ja inclou pèrdues al 14%)
      // Si no hi ha PVGIS, apliquem factorPerdues manualment
      const pv_brut = pvgisMonthly
        ? SOLAR[idx] * kwp * scalePvgis * factorOmbres
        : SOLAR[idx] * kwp * factorPerdues * factorOmbres;

      // Clipping inversor
      const pv_real = Math.min(pv_brut, potencia_inversor_kw);

      // kW consumits per client aquesta hora
      const t = TARIFES[idx] || 'P3';
      const tn = t === 'P1' ? 'P1' : (t === 'P2' ? 'P2' : 'P3');
      const con_h = shape[h] * fP[tn];

      // Preu de la factura del client per aquest periode
      const pr = PREUS_INV[t] || preu_p3;

      ac    += Math.min(pv_real, con_h);
      exc   += Math.max(0, pv_real - con_h);
      xarxa += Math.max(0, con_h - pv_real);
      pv    += pv_real;
      cost  += Math.max(0, con_h - pv_real) * pr;
      comp  += Math.max(0, pv_real - con_h) * preu_excedent;
      idx++;
    }
  }

  resultats_mes.push({
    mes: NOMS_MES[m],
    consum: Math.round(cp1[m] + cp2[m] + cp3[m]),
    produccio: Math.round(pv),
    autoconsum: Math.round(ac),
    excedent: Math.round(exc),
    xarxa: Math.round(xarxa),
    cost_xarxa: Math.round(cost * 100) / 100,
    compensacio: Math.round(comp * 100) / 100,
    estalvi: Math.round((cp1[m]*preu_p1 + cp2[m]*preu_p2 + cp3[m]*preu_p3 - cost + comp) * 100) / 100,
  });
}

// ── KPIs anuals ──────────────────────────────────────────────────
const t_consum   = resultats_mes.reduce((s,r) => s + r.consum, 0);
const t_pv       = resultats_mes.reduce((s,r) => s + r.produccio, 0);
const t_ac       = resultats_mes.reduce((s,r) => s + r.autoconsum, 0);
const t_exc      = resultats_mes.reduce((s,r) => s + r.excedent, 0);
const t_xarxa    = resultats_mes.reduce((s,r) => s + r.xarxa, 0);
const t_cost_xar = resultats_mes.reduce((s,r) => s + r.cost_xarxa, 0);
const t_comp     = resultats_mes.reduce((s,r) => s + r.compensacio, 0);
const t_estalvi  = resultats_mes.reduce((s,r) => s + r.estalvi, 0);
const cost_act   = cp1.reduce((s,v,i) => s + v*preu_p1 + cp2[i]*preu_p2 + cp3[i]*preu_p3, 0);

const pct_autoconsum = t_pv > 0 ? t_ac / t_pv * 100 : 0;
const pct_cobertura  = t_consum > 0 ? t_ac / t_consum * 100 : 0;
const estalvi_any1   = t_estalvi;

// ── Cashflow 25 anys ─────────────────────────────────────────────
// Formula Excel: estalvi_n = estalvi_1 × 1.015^(n-1)
// NO s'aplica degradació a l'estalvi (igual que l'Excel)
const costInst = cost_instalacio || 0;
const cashflow = [{any: 0, flux: -costInst, acumulat: -costInst}];
let acum = -costInst;
let retorn_anys = null;

for (let n = 1; n <= VIDA_UTIL; n++) {
  const estalvi_n = estalvi_any1 * Math.pow(1 + INFLACIO, n-1) - manteniment_anual;
  acum += estalvi_n;
  cashflow.push({any: n, flux: Math.round(estalvi_n), acumulat: Math.round(acum)});
  if (retorn_anys === null && acum >= 0) {
    const prev = acum - estalvi_n;
    retorn_anys = (n-1) + (-prev) / estalvi_n;
  }
}

// ── VAN i TIR ────────────────────────────────────────────────────
const fluxos = cashflow.map(c => c.flux);
fluxos[0] = -costInst;
const van = fluxos.reduce((s, f, n) => s + f / Math.pow(1 + TAXA_DESC, n), 0);

// TIR Newton-Raphson
let tir = 0.1;
for (let i = 0; i < 100; i++) {
  const f  = fluxos.reduce((s,c,n) => s + c / Math.pow(1+tir, n), 0);
  const df = fluxos.reduce((s,c,n) => s - n*c / Math.pow(1+tir, n+1), 0);
  if (Math.abs(df) < 1e-10) break;
  const dt = f/df; tir -= dt;
  if (Math.abs(dt) < 1e-8) break;
}

// CO₂
const co2_any = t_ac * 0.321;
const co2_25  = co2_any * VIDA_UTIL;

return [{json: {
  success: true,
  // Instal·lació
  kwp:              Math.round(kwp * 100) / 100,
  num_moduls,
  potencia_wp,
  // Producció
  produccio_anual:  Math.round(t_pv),
  hsp_equivalent:   t_pv > 0 ? Math.round(t_pv / kwp) : 0,
  // Autoconsum
  autoconsum_anual: Math.round(t_ac),
  excedent_anual:   Math.round(t_exc),
  xarxa_anual:      Math.round(t_xarxa),
  pct_autoconsum:   Math.round(pct_autoconsum * 10) / 10,
  pct_cobertura:    Math.round(pct_cobertura * 10) / 10,
  // Econòmics
  cost_actual_anual: Math.round(cost_act * 100) / 100,
  cost_pv_anual:    Math.round((t_cost_xar - t_comp) * 100) / 100,
  compensacio_anual: Math.round(t_comp * 100) / 100,
  estalvi_any1:     Math.round(estalvi_any1 * 100) / 100,
  cost_instalacio:  costInst,
  retorn_anys:      retorn_anys ? Math.round(retorn_anys * 100) / 100 : null,
  van_25anys:       Math.round(van),
  tir_pct:          Math.round(tir * 1000) / 10,
  benefici_net_25:  Math.round(acum),
  co2_anual_kg:     Math.round(co2_any),
  co2_25anys_kg:    Math.round(co2_25),
  // Mensual per gràfics
  mensual: resultats_mes,
  // Cashflow per gràfic
  cashflow: cashflow,
}}];