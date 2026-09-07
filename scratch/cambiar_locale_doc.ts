import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function cambiarLocaleDoc() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    console.log("Locale actual:", doc.locale);
    console.log("Cambiando locale a 'es_VE'...");
    await doc.updateProperties({ locale: "es_VE", timeZone: "America/Caracas" });
    console.log("✅ Locale actualizado con éxito a:", doc.locale);
  });
}

cambiarLocaleDoc();
