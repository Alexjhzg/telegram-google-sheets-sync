import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function chequearConfiguracionDoc() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    console.log("Spreadsheet Title:", doc.title);
    console.log("Spreadsheet Locale:", doc.locale);
    console.log("Spreadsheet TimeZone:", doc.timeZone);
  });
}

chequearConfiguracionDoc();
