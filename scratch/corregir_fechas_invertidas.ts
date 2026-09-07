import { obtenerHojaDeCalculo, sheetsMutex } from "../src/services/sheets.js";

async function corregirFechasInvertidas() {
  await sheetsMutex.runExclusive(async () => {
    const doc = await obtenerHojaDeCalculo();
    const sheetHist = doc.sheetsByTitle["registros_historicos_telegram"];
    const rows = await sheetHist.getRows();

    console.log(`Cargadas ${rows.length} filas del histórico...`);

    let invertidas08 = 0;
    let invertidas09 = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawFecha = String(row.get("Fecha") || "").trim();

      // Detectar 08/XX/2026 (donde XX va de 01 a 12) que corresponden a Agosto (XX/08/2026)
      const match08 = /^08\/(\d{2})\/(\d{4})$/.exec(rawFecha);
      if (match08) {
        const dia = match08[1];
        const anio = match08[2];
        const fechaCorregida = `${dia}/08/${anio}`;
        row.set("Fecha", fechaCorregida);
        await row.save();
        invertidas08++;
      }

      // Detectar 09/03/2026 que corresponde a 03/09/2026 (3 de Septiembre de 2026)
      const match09 = /^09\/03\/(\d{4})$/.exec(rawFecha);
      if (match09) {
        const anio = match09[1];
        const fechaCorregida = `03/09/${anio}`;
        row.set("Fecha", fechaCorregida);
        await row.save();
        invertidas09++;
      }
    }

    console.log(`✅ Se corrigieron ${invertidas08} filas de Agosto que tenían la fecha invertida (08/DD -> DD/08).`);
    console.log(`✅ Se corrigieron ${invertidas09} filas de Septiembre que tenían la fecha invertida (09/03 -> 03/09).`);
  });
}

corregirFechasInvertidas();
