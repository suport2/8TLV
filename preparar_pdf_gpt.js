const body = $input.first().json.body || $input.first().json;
const pdfBase64 = body.pdf_base64 || '';
const filename  = body.filename || 'factura.pdf';

if (!pdfBase64) throw new Error("No s'ha rebut cap PDF (pdf_base64 buit)");

const promptText = `Extreu les dades d'aquesta factura elèctrica i retorna NOMÈS aquest JSON (sense cap text addicional ni \`\`\`json\`\`\`):
{
  "client_nom": "Nom complet o raó social",
  "client_nif": "NIF o CIF",
  "client_email": "email o null",
  "client_telefon": "telèfon o null",
  "adreca_subministrament": "adreça completa del punt de subministrament",
  "adreca_facturacio": "adreça de facturació si diferent, o null",
  "cups": "codi CUPS (20 o 22 caràcters ES...)",
  "tarifa": "2.0TD, 3.0TD, 6.1TD, etc.",
  "potencia_contractada_kw": "potència en kW com a número, o null",
  "periode_factura_inici": "data inici en format YYYY-MM-DD o null",
  "periode_factura_fi": "data fi en format YYYY-MM-DD o null",
  "preu_p1_kwh": "preu P1 en EUR/kWh com a número, o null",
  "preu_p2_kwh": "preu P2 en EUR/kWh com a número, o null",
  "preu_p3_kwh": "preu P3 en EUR/kWh com a número, o null",
  "preu_p4_kwh": "preu P4 en EUR/kWh com a número, o null",
  "preu_p5_kwh": "preu P5 en EUR/kWh com a número, o null",
  "preu_p6_kwh": "preu P6 en EUR/kWh com a número, o null",
  "preu_excedent_kwh": "preu compensació excedents en EUR/kWh, o null",
  "preu_mig_kwh": "preu mig ponderat en EUR/kWh si apareix, o null",
  "comercialitzadora": "nom de la comercialitzadora",
  "distribuidora": "nom de la distribuïdora o null",
  "confianca": "alta | mitja | baixa (nivell de certesa de l'extracció)"
}`;

const requestBody = {
  model: "gpt-4o",
  max_tokens: 1500,
  messages: [
    {
      role: "system",
      content: "Ets un extractor de dades de factures elèctriques espanyoles. Sempre respons ÚNICAMENT en JSON vàlid, sense cap text addicional ni blocs de codi markdown. Si no trobes un camp, usa null."
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: promptText
        },
        {
          type: "image_url",
          image_url: {
            url: "data:application/pdf;base64," + pdfBase64
          }
        }
      ]
    }
  ]
};

return [{json: { request_body: requestBody, filename }}];
