import { obtenerHojaDeCalculo } from "../src/services/sheets.js";

/**
 * Script automatizado para estructurar y aplicar las fórmulas nativas en 2 pestañas separadas:
 * 1. 'reporte_nodo' ➔ Nivel Granular de Nodos.
 * 2. 'reporte_diario_municipio' ➔ Nivel Agregado por Municipio y Totales.
 */
async function configurarReportesNativos() {
  console.log("=== CONFIGURANDO ESTRUCTURA NATIVA EN 'reporte_nodo' Y 'reporte_diario_municipio' ===");

  try {
    const doc = await obtenerHojaDeCalculo();
    console.log("[1/5] Conexión establecida con Google Sheets.");

    const hojaNodos = doc.sheetsByTitle["verificadores_nodo"];
    if (!hojaNodos) {
      console.error("[ERROR] No se encontró la hoja 'verificadores_nodo' para estructurar los reportes.");
      process.exit(1);
    }

    const rawRows = await hojaNodos.getRows();
    const filasNodos = rawRows.filter((r) => {
      const mun = (r.get("MUNICIPIO") || "").trim().toUpperCase();
      const nod = (r.get("NODO") || "").trim();
      return mun !== "" && mun !== "TOTAL" && nod !== "";
    });

    const cantNodos = filasNodos.length;
    console.log(`[INFO] Se detectaron ${cantNodos} nodos válidos en 'verificadores_nodo'.`);

    console.log("[2/5] Configurando pestaña 'reporte_nodo' (Nodos)...");
    
    let sheetReporte = doc.sheetsByTitle["reporte_nodo"];
    const sheetVieja = doc.sheetsByTitle["reporte_diario"];

    if (!sheetReporte && sheetVieja) {
      console.log("[INFO] Renombrando la pestaña 'reporte_diario' a 'reporte_nodo'...");
      await sheetVieja.updateProperties({ title: "reporte_nodo" });
      sheetReporte = sheetVieja;
    } else if (!sheetReporte) {
      console.log("[INFO] Creando la pestaña 'reporte_nodo'...");
      sheetReporte = await doc.addSheet({ title: "reporte_nodo" });
    }

    const totalFilasNodos = cantNodos + 10;
    await sheetReporte.resize({ rowCount: totalFilasNodos, columnCount: 8 });
    await sheetReporte.loadCells(`A1:H${totalFilasNodos}`);

    for (let r = 0; r < totalFilasNodos; r++) {
      for (let c = 0; c < 8; c++) {
        sheetReporte.getCell(r, c).value = null;
      }
    }

    const cabecerasNodos = [
      "Municipio",
      "Nodo",
      "Verificadores en el Nodo",
      "Verificadores con Salida a Campo",
      "Verificadores sin Salida a Campo",
      "Reportó",
      "Fecha",
    ];

    for (let c = 0; c < cabecerasNodos.length; c++) {
      sheetReporte.getCell(0, c).value = cabecerasNodos[c];
    }

    for (let i = 0; i < cantNodos; i++) {
      const rowIdx = i + 1;
      const numFila = rowIdx + 1;
      const filaObj = filasNodos[i];

      const munVal = (filaObj.get("MUNICIPIO") || "").trim();
      const nodVal = parseInt(filaObj.get("NODO") || "0", 10);
      const limVal = parseInt(filaObj.get("CANTIDAD DE VERIFICADORES") || "0", 10);

      sheetReporte.getCell(rowIdx, 0).value = munVal;
      sheetReporte.getCell(rowIdx, 1).value = nodVal;
      sheetReporte.getCell(rowIdx, 2).value = limVal;
      sheetReporte.getCell(rowIdx, 3).formula = `=ROUND(IFERROR(SUMIFS(registros_historicos_telegram!C:C, registros_historicos_telegram!A:A, A${numFila}, registros_historicos_telegram!B:B, B${numFila}, registros_historicos_telegram!G:G, G${numFila}), 0), 0)`;
      sheetReporte.getCell(rowIdx, 4).formula = `=ROUND(C${numFila}-D${numFila}, 0)`;
      sheetReporte.getCell(rowIdx, 5).formula = `=IF(D${numFila}>0, "S", IF(COUNTIFS(registros_historicos_telegram!B:B, B${numFila}, registros_historicos_telegram!G:G, G${numFila}, registros_historicos_telegram!J:J, "<>")>0, "S", "N"))`;
      sheetReporte.getCell(rowIdx, 6).formula = `=TEXT(TODAY() - 1, "dd/mm/yyyy")`;
    }

    const filaTotalNodoIdx = cantNodos + 1;
    const numFilaFinNodos = cantNodos + 1;

    sheetReporte.getCell(filaTotalNodoIdx, 0).value = "TOTAL";
    sheetReporte.getCell(filaTotalNodoIdx, 1).value = null;
    sheetReporte.getCell(filaTotalNodoIdx, 2).formula = `=ROUND(SUM(C2:C${numFilaFinNodos}), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 3).formula = `=ROUND(SUM(D2:D${numFilaFinNodos}), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 4).formula = `=ROUND(SUM(E2:E${numFilaFinNodos}), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 5).formula = `=ROUND(COUNTIFS(F2:F${numFilaFinNodos}, "N"), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 6).formula = `=TEXT(TODAY() - 1, "dd/mm/yyyy")`;

    await sheetReporte.saveUpdatedCells();
    console.log("[3/5] ✅ Pestaña 'reporte_nodo' (Nodos) guardada con éxito (incluyendo fila TOTAL).");

    console.log("[4/5] Configurando pestaña 'reporte_diario_municipio' (Consolidado Municipal)...");
    let sheetMunicipio = doc.sheetsByTitle["reporte_diario_municipio"];
    if (!sheetMunicipio) {
      console.log("[INFO] Creando la pestaña 'reporte_diario_municipio'...");
      sheetMunicipio = await doc.addSheet({ title: "reporte_diario_municipio" });
    }

    const municipiosSet = new Set<string>();
    for (const r of filasNodos) {
      const m = (r.get("MUNICIPIO") || "").trim();
      if (m && m.toUpperCase() !== "TOTAL") {
        municipiosSet.add(m);
      }
    }
    const listaMunicipios = Array.from(municipiosSet).sort();
    const cantMunicipios = listaMunicipios.length;

    const totalFilasMun = cantMunicipios + 10;
    await sheetMunicipio.resize({ rowCount: totalFilasMun, columnCount: 8 });
    await sheetMunicipio.loadCells(`A1:H${totalFilasMun}`);

    for (let r = 0; r < totalFilasMun; r++) {
      for (let c = 0; c < 8; c++) {
        sheetMunicipio.getCell(r, c).value = null;
      }
    }

    const cabecerasMun = [
      "Municipio",
      "Verificadores en el Nodo",
      "Verificadores con Salida a Campo",
      "Verificadores sin Salida a Campo",
      "No Reportados",
      "Fecha",
    ];

    for (let c = 0; c < cabecerasMun.length; c++) {
      sheetMunicipio.getCell(0, c).value = cabecerasMun[c];
    }

    let filaActual = 1;
    const primeraFilaDatos = 2;

    for (const mun of listaMunicipios) {
      const numFilaM = filaActual + 1;
      sheetMunicipio.getCell(filaActual, 0).value = mun;
      sheetMunicipio.getCell(filaActual, 1).formula = `=ROUND(SUMIF(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!C:C), 0)`;
      sheetMunicipio.getCell(filaActual, 2).formula = `=ROUND(SUMIF(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!D:D), 0)`;
      sheetMunicipio.getCell(filaActual, 3).formula = `=ROUND(SUMIF(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!E:E), 0)`;
      sheetMunicipio.getCell(filaActual, 4).formula = `=ROUND(COUNTIFS(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!F:F, "N"), 0)`;
      sheetMunicipio.getCell(filaActual, 5).formula = `=TEXT(TODAY() - 1, "dd/mm/yyyy")`;

      filaActual++;
    }

    const ultimaFilaDatos = filaActual;

    sheetMunicipio.getCell(filaActual, 0).value = "TOTAL";
    sheetMunicipio.getCell(filaActual, 1).formula = `=ROUND(SUM(B${primeraFilaDatos}:B${ultimaFilaDatos}), 0)`;
    sheetMunicipio.getCell(filaActual, 2).formula = `=ROUND(SUM(C${primeraFilaDatos}:C${ultimaFilaDatos}), 0)`;
    sheetMunicipio.getCell(filaActual, 3).formula = `=ROUND(SUM(D${primeraFilaDatos}:D${ultimaFilaDatos}), 0)`;
    sheetMunicipio.getCell(filaActual, 4).formula = `=ROUND(SUM(E${primeraFilaDatos}:E${ultimaFilaDatos}), 0)`;
    sheetMunicipio.getCell(filaActual, 5).formula = `=TEXT(TODAY() - 1, "dd/mm/yyyy")`;

    await sheetMunicipio.saveUpdatedCells();
    console.log("[5/5] ✅ Pestaña 'reporte_diario_municipio' guardada con éxito.");

    console.log("=== ✅ DEPURACIÓN DE FILAS Y ESTRUCTURA NATIVA COMPLETADAS CON ÉXITO ===");
  } catch (err) {
    console.error("[ERROR FATAL] Falló la configuración de las pestañas:", err);
    process.exit(1);
  }
}

configurarReportesNativos();
