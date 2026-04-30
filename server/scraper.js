const { chromium } = require('playwright-chromium');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

(async () => {
  const cups = process.argv[2];
  if (!cups) {
    console.error('Error: Debes proporcionar un CUPS como argumento.');
    process.exit(1);
  }

  const downloadPath = path.resolve(__dirname, 'downloads');
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath);
  }

  console.log(`Iniciando proceso para CUPS: ${cups}`);

  const browser = await chromium.launch({ headless: true }); // Cambiar a true para n8n
  const context = await browser.newContext({
    acceptDownloads: true
  });
  const page = await context.newPage();

  try {
    // 1. Navegar al portal
    await page.goto(process.env.PORTAL_URL);
    console.log('Navegando al portal...');

    // Aceptar cookies
    console.log('Esperando banner de cookies...');
    try {
      // Intentar por rol y nombre, que es lo más robusto
      const acceptCookies = page.getByRole('button', { name: 'Aceptar', exact: true });
      await acceptCookies.waitFor({ state: 'visible', timeout: 8000 });
      await acceptCookies.click();
      console.log('Cookies aceptadas.');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('No se pudo encontrar el botón "Aceptar" por rol:', e.message);
      // Fallback a selectores de texto
      try {
        await page.click('button:has-text("Aceptar")', { timeout: 2000 });
        console.log('Cookies aceptadas (fallback).');
      } catch (e2) {
        console.log('Tampoco se pudo con el fallback de texto.');
      }
    }

    // 2. Click en el botón de Login inicial
    console.log('Buscando botón de Login inicial...');
    try {
      const loginBtn = page.getByRole('button', { name: 'Login' });
      await loginBtn.waitFor({ state: 'visible', timeout: 8000 });
      await loginBtn.click();
      console.log('Hizo click en el botón de Login inicial.');
      await page.waitForLoadState('networkidle');
    } catch (e) {
      console.log('No se encontró botón Login por rol:', e.message);
      try {
        await page.click('button:has-text("Login")', { timeout: 2000 });
        console.log('Hizo click en Login (fallback).');
      } catch (e2) {
        console.log('No se encontró botón Login en absoluto.');
      }
    }

    // 3. Login - Paso 1: Email
    console.log('Esperando campo de email...');
    try {
      // El campo real en Gigya suele llamarse 'identifier' o 'loginID' y estar visible
      const emailInput = page.locator('input[name="identifier"]:visible, input[name="loginID"]:visible, input[type="email"]:visible');
      await emailInput.waitFor({ state: 'visible', timeout: 20000 });
      await emailInput.fill(process.env.LOGIN_EMAIL);
      console.log('Email introducido.');
      
      // Click en el Login de Gigya (el rojo)
      const nextBtn = page.getByRole('button', { name: 'Login', exact: true }).filter({ visible: true });
      await nextBtn.click();
      console.log('Click en Siguiente/Login.');
    } catch (e) {
      console.error('Error en paso 1 de login:', e.message);
      throw e;
    }

    // Login - Paso 2: Contraseña
    console.log('Esperando campo de contraseña...');
    try {
      const passInput = page.locator('input[type="password"]:visible, input#password:visible, input[name="password"]:visible');
      await passInput.waitFor({ state: 'visible', timeout: 20000 });
      await passInput.fill(process.env.PASSWORD);
      await passInput.press('Enter');
      console.log('Contraseña introducida y Enter presionado.');
    } catch (e) {
      console.error('Error en paso 2 de login:', e.message);
      throw e;
    }

    // Esperar a que la navegación termine y estemos dentro
    console.log('Esperando redirección al portal...');
    await page.waitForURL(/.*agentes.totalenergies.es\/#\/(resumen|contratos|sips).*/, { timeout: 30000 });
    console.log('Sesión iniciada correctamente.');

    // 3. Seleccionar SIPS Electricidad
    console.log('Navegando a SIPS Electricidad...');
    // El menú lateral suele estar siempre presente.
    await page.click('text=SIPS Electricidad');
    await page.waitForTimeout(3000); // Dar tiempo a que cargue la vista

    // 4. Llenar campo CUPS
    console.log(`Buscando CUPS: ${cups}`);
    // Basado en el screenshot, el campo tiene el label "CUPS"
    await page.fill('input[name="cups"], .cups-input input, input:near(:text("CUPS"))', cups);
    
    // 5. Click en CONSULTAR
    await page.click('button:has-text("CONSULTAR")');
    console.log('Consultando...');

    // Esperar a que aparezca el resultado en la tabla
    const partialCups = cups.substring(0, 16);
    console.log(`Esperando resultado que contenga: ${partialCups}`);
    await page.waitForSelector(`tr:has-text("${partialCups}")`, { timeout: 20000 });
    console.log('Resultado encontrado (match parcial).');

    // 6. Seleccionar el cuadrado (checkbox)
    console.log('Fila encontrada, esperando a que sea interactiva...');
    await page.waitForTimeout(2000); 
    
    const row = page.locator(`tr:has-text("${partialCups}")`).first();
    // Intentar clickear el checkbox usando varios posibles selectores
    const checkbox = row.locator('input[type="checkbox"], .checkbox, [role="checkbox"], .tick, .fa-square-o, td:first-child');
    await checkbox.first().click();
    console.log('Fila seleccionada.');

    // 7. Descargar consumos (ZIP)
    console.log('Iniciando descarga del ZIP...');
    // A veces el botón tarda un segundo en habilitarse tras seleccionar la fila
    await page.waitForTimeout(1000);
    
    // Botó "Descargar consumos" (icona de gràfica de barres, aria-label específic)
    const downloadIcon = page.locator('[aria-label="Descargar consumos"], button[ng-click*="exportarDatosSIPSConsumos"], .fa-chart-bar').first();
    
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      downloadIcon.click(),
    ]);

    const finalPath = path.join(downloadPath, `${cups}.zip`);
    await download.saveAs(finalPath);
    console.log(`Descarga completada: ${finalPath}`);

  } catch (error) {
    console.error('Error durante el proceso:', error);
    // Captura de pantalla para debug
    await page.screenshot({ path: 'error_debug.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
