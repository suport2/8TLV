const raw = $input.first().json;

let text = '';
try {
  text = raw.choices[0].message.content;
} catch(e) {
  throw new Error('Resposta GPT inesperada: ' + JSON.stringify(raw).substring(0, 300));
}

const clean = text
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

let dades;
try {
  dades = JSON.parse(clean);
} catch(e) {
  throw new Error("No s'ha pogut parsear el JSON de GPT: " + clean.substring(0, 200));
}

const toFloat = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(',', '.')) || null;
};

return [{json: {
  success: true,
  client_nom:              dades.client_nom || null,
  client_nif:              dades.client_nif || null,
  client_email:            dades.client_email || null,
  client_telefon:          dades.client_telefon || null,
  adreca_subministrament:  dades.adreca_subministrament || null,
  adreca_facturacio:       dades.adreca_facturacio || null,
  cups:                    dades.cups || null,
  tarifa:                  dades.tarifa || null,
  potencia_contractada_kw: toFloat(dades.potencia_contractada_kw),
  periode_inici:           dades.periode_factura_inici || null,
  periode_fi:              dades.periode_factura_fi || null,
  preu_p1_kwh:             toFloat(dades.preu_p1_kwh),
  preu_p2_kwh:             toFloat(dades.preu_p2_kwh),
  preu_p3_kwh:             toFloat(dades.preu_p3_kwh),
  preu_p4_kwh:             toFloat(dades.preu_p4_kwh),
  preu_p5_kwh:             toFloat(dades.preu_p5_kwh),
  preu_p6_kwh:             toFloat(dades.preu_p6_kwh),
  preu_excedent_kwh:       toFloat(dades.preu_excedent_kwh),
  preu_mig_kwh:            toFloat(dades.preu_mig_kwh),
  comercialitzadora:       dades.comercialitzadora || null,
  distribuidora:           dades.distribuidora || null,
  confianca:               dades.confianca || 'mitja',
  model_usat:              'gpt-4o',
  timestamp:               new Date().toISOString(),
}}];
