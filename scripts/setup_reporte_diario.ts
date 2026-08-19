import { obtenerHojaDeCalculo } from "../src/services/sheets.js";

/**
 * Script automatizado para estructurar y aplicar fórmulas nativas sin colores ni estilos personalizados:
 * 1. 'reporte_nodo' ➔ Nivel Granular de Nodos con celda de entrada libre en I1.
 * 2. 'reporte_diario_municipio' ➔ Nivel Agregado por Municipio vinculando fecha desde reporte_nodo!G2.
 */
async function configurarReportesNativos() {
  console.log("=== CONFIGURANDO ESTRUCTURA DE REPORTE DIARIO SIN ESTILOS DE COLOR ===");

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

    // ── 1. PESTAÑA 'reporte_nodo' ─────────────────────────────────────────────
    console.log("[2/5] Configurando pestaña 'reporte_nodo'...");
    
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
    await sheetReporte.resize({ rowCount: totalFilasNodos, columnCount: 10 });
    await sheetReporte.loadCells(`A1:J${totalFilasNodos}`);

    // Limpiar celdas
    for (let r = 0; r < totalFilasNodos; r++) {
      for (let c = 0; c < 10; c++) {
        const cell = sheetReporte.getCell(r, c);
        cell.value = null;
      }
    }

    // Cabeceras en Fila 1
    sheetReporte.getCell(0, 0).value = "Municipio";
    sheetReporte.getCell(0, 1).value = "Nodo";
    sheetReporte.getCell(0, 2).value = "Verificadores en el Nodo";
    sheetReporte.getCell(0, 3).value = "Verificadores con Salida a Campo";
    sheetReporte.getCell(0, 4).value = "Verificadores sin Salida a Campo";
    sheetReporte.getCell(0, 5).value = "Reportó";
    sheetReporte.getCell(0, 6).value = "Fecha";
    sheetReporte.getCell(0, 7).value = "Fecha Deseada ->";
    sheetReporte.getCell(0, 8).value = null; // I1: Celda vacía editable por el usuario

    for (let i = 0; i < cantNodos; i++) {
      const rowIdx = i + 1;
      const numFila = rowIdx + 1; // Fila 2, 3, 4...
      const filaObj = filasNodos[i];

      const munVal = (filaObj.get("MUNICIPIO") || "").trim();
      const nodVal = parseInt(filaObj.get("NODO") || "0", 10);
      const limVal = parseInt(filaObj.get("CANTIDAD DE VERIFICADORES") || "0", 10);

      sheetReporte.getCell(rowIdx, 0).value = munVal;
      sheetReporte.getCell(rowIdx, 1).value = nodVal;
      sheetReporte.getCell(rowIdx, 2).value = limVal;

      // Fórmulas
      sheetReporte.getCell(rowIdx, 3).formula = `=ROUND(IFERROR(SUMIFS(registros_historicos_telegram!C:C, registros_historicos_telegram!A:A, A${numFila}, registros_historicos_telegram!B:B, B${numFila}, registros_historicos_telegram!G:G, G${numFila}), 0), 0)`;
      sheetReporte.getCell(rowIdx, 4).formula = `=ROUND(C${numFila}-D${numFila}, 0)`;
      sheetReporte.getCell(rowIdx, 5).formula = `=IF(D${numFila}>0, "S", IF(COUNTIFS(registros_historicos_telegram!B:B, B${numFila}, registros_historicos_telegram!G:G, G${numFila}, registros_historicos_telegram!J:J, "<>")>0, "S", "N"))`;
      sheetReporte.getCell(rowIdx, 6).formula = `=IF(ISBLANK($I$1), TEXT(TODAY() - 1, "dd/mm/yyyy"), TEXT($I$1, "dd/mm/yyyy"))`;
    }

    // Fila TOTALES al final
    const filaTotalNodoIdx = cantNodos + 1;
    const primeraFilaNodos = 2;
    const ultimaFilaNodos = cantNodos + 1;

    sheetReporte.getCell(filaTotalNodoIdx, 0).value = "TOTAL";
    sheetReporte.getCell(filaTotalNodoIdx, 1).value = null;
    sheetReporte.getCell(filaTotalNodoIdx, 2).formula = `=ROUND(SUM(C${primeraFilaNodos}:C${ultimaFilaNodos}), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 3).formula = `=ROUND(SUM(D${primeraFilaNodos}:D${ultimaFilaNodos}), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 4).formula = `=ROUND(SUM(E${primeraFilaNodos}:E${ultimaFilaNodos}), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 5).formula = `=ROUND(COUNTIFS(F${primeraFilaNodos}:F${ultimaFilaNodos}, "N"), 0)`;
    sheetReporte.getCell(filaTotalNodoIdx, 6).formula = `=G2`;

    await sheetReporte.saveUpdatedCells();
    console.log("[3/5] ✅ Pestaña 'reporte_nodo' configurada limpiamente sin colores.");

    // ── 2. PESTAÑA 'reporte_diario_municipio' ───────────────────────────────────
    console.log("[4/5] Configurando pestaña 'reporte_diario_municipio'...");
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
    await sheetMunicipio.resize({ rowCount: totalFilasMun, columnCount: 10 });
    await sheetMunicipio.loadCells(`A1:J${totalFilasMun}`);

    for (let r = 0; r < totalFilasMun; r++) {
      for (let c = 0; c < 10; c++) {
        const cell = sheetMunicipio.getCell(r, c);
        cell.value = null;
      }
    }

    // Cabeceras en Fila 1
    sheetMunicipio.getCell(0, 0).value = "Municipio";
    sheetMunicipio.getCell(0, 1).value = "Verificadores en el Nodo";
    sheetMunicipio.getCell(0, 2).value = "Verificadores con Salida a Campo";
    sheetMunicipio.getCell(0, 3).value = "Verificadores sin Salida a Campo";
    sheetMunicipio.getCell(0, 4).value = "No Reportados";
    sheetMunicipio.getCell(0, 5).value = "Fecha";
    sheetMunicipio.getCell(0, 6).value = "Fecha Deseada ->";
    sheetMunicipio.getCell(0, 7).formula = `=reporte_nodo!I1`;

    let filaActual = 1;
    const primeraFilaMunData = 2;

    for (const mun of listaMunicipios) {
      const numFilaM = filaActual + 1; // Fila 2, 3, 4...
      
      sheetMunicipio.getCell(filaActual, 0).value = mun;
      sheetMunicipio.getCell(filaActual, 1).formula = `=ROUND(SUMIF(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!C:C), 0)`;
      sheetMunicipio.getCell(filaActual, 2).formula = `=ROUND(SUMIF(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!D:D), 0)`;
      sheetMunicipio.getCell(filaActual, 3).formula = `=ROUND(SUMIF(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!E:E), 0)`;
      sheetMunicipio.getCell(filaActual, 4).formula = `=ROUND(COUNTIFS(reporte_nodo!A:A, A${numFilaM}, reporte_nodo!F:F, "N"), 0)`;
      sheetMunicipio.getCell(filaActual, 5).formula = `=reporte_nodo!G2`;

      filaActual++;
    }

    const ultimaFilaMunData = filaActual;

    sheetMunicipio.getCell(filaActual, 0).value = "TOTAL";
    sheetMunicipio.getCell(filaActual, 1).formula = `=ROUND(SUM(B${primeraFilaMunData}:B${ultimaFilaMunData}), 0)`;
    sheetMunicipio.getCell(filaActual, 2).formula = `=ROUND(SUM(C${primeraFilaMunData}:C${ultimaFilaMunData}), 0)`;
    sheetMunicipio.getCell(filaActual, 3).formula = `=ROUND(SUM(D${primeraFilaMunData}:D${ultimaFilaMunData}), 0)`;
    sheetMunicipio.getCell(filaActual, 4).formula = `=ROUND(SUM(E${primeraFilaMunData}:E${ultimaFilaMunData}), 0)`;
    sheetMunicipio.getCell(filaActual, 5).formula = `=reporte_nodo!G2`;

    await sheetMunicipio.saveUpdatedCells();
    console.log("[5/5] ✅ Pestaña 'reporte_diario_municipio' configurada limpiamente.");

    // ── 3. APLICAR REGLAS DE FORMATO CONDICIONAL (LIGHT RED 2) ──────────────────
    console.log("[6/6] Aplicando reglas de formato condicional (Light Red 2)...");
    
    // Regla 1: reporte_nodo - Columna E (Verificadores sin Salida a Campo) > 0
    const requestFormatNodoSinSalida = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetReporte.sheetId,
              startRowIndex: 1,
              endRowIndex: cantNodos + 1,
              startColumnIndex: 4, // Columna E (Verificadores sin Salida a Campo)
              endColumnIndex: 5,
            },
          ],
          booleanRule: {
            condition: {
              type: "NUMBER_GREATER",
              values: [{ userEnteredValue: "0" }],
            },
            format: {
              backgroundColor: {
                red: 0.957,
                green: 0.78,
                blue: 0.765,
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 2: reporte_nodo - Columna F (Reportó) es "N" y Columna E > 0
    const requestFormatNodoReporto = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetReporte.sheetId,
              startRowIndex: 1,
              endRowIndex: cantNodos + 1,
              startColumnIndex: 5, // Columna F (Reportó)
              endColumnIndex: 6,
            },
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [
                {
                  userEnteredValue: '=AND($F2="N", $E2>0)',
                },
              ],
            },
            format: {
              backgroundColor: {
                red: 0.957,
                green: 0.78,
                blue: 0.765,
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 3: reporte_diario_municipio - Columna D (Verificadores sin Salida a Campo) > 0
    const requestFormatMunSinSalida = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetMunicipio.sheetId,
              startRowIndex: 1,
              endRowIndex: cantMunicipios + 1,
              startColumnIndex: 3, // Columna D (Verificadores sin Salida a Campo)
              endColumnIndex: 4,
            },
          ],
          booleanRule: {
            condition: {
              type: "NUMBER_GREATER",
              values: [{ userEnteredValue: "0" }],
            },
            format: {
              backgroundColor: {
                red: 0.957,
                green: 0.78,
                blue: 0.765,
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 4: reporte_diario_municipio - Columna E (No Reportados) > 0 y Columna D > 0
    const requestFormatMunNoReportados = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetMunicipio.sheetId,
              startRowIndex: 1,
              endRowIndex: cantMunicipios + 1,
              startColumnIndex: 4, // Columna E (No Reportados)
              endColumnIndex: 5,
            },
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [
                {
                  userEnteredValue: '=AND($E2>0, $D2>0)',
                },
              ],
            },
            format: {
              backgroundColor: {
                red: 0.957,
                green: 0.78,
                blue: 0.765,
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 5: reporte_nodo - Columna D (Verificadores con Salida a Campo) == 0 -> ROJO
    const requestFormatNodoSalidaCero = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetReporte.sheetId,
              startRowIndex: 1,
              endRowIndex: cantNodos + 1,
              startColumnIndex: 3, // Columna D (Verificadores con Salida a Campo)
              endColumnIndex: 4,
            },
          ],
          booleanRule: {
            condition: {
              type: "NUMBER_EQ",
              values: [{ userEnteredValue: "0" }],
            },
            format: {
              backgroundColor: {
                red: 0.957,
                green: 0.78,
                blue: 0.765, // Light Red 2
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 6: reporte_nodo - Columna D != Columna C (Verificadores en el Nodo) y D > 0 -> AMARILLO
    const requestFormatNodoSalidaDistinta = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetReporte.sheetId,
              startRowIndex: 1,
              endRowIndex: cantNodos + 1,
              startColumnIndex: 3, // Columna D (Verificadores con Salida a Campo)
              endColumnIndex: 4,
            },
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [
                {
                  userEnteredValue: '=AND($D2<>$C2, $D2>0)',
                },
              ],
            },
            format: {
              backgroundColor: {
                red: 0.988,
                green: 0.91,
                blue: 0.702, // Light Yellow 2
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 7: reporte_diario_municipio - Columna C (Verificadores con Salida a Campo) == 0 -> ROJO
    const requestFormatMunSalidaCero = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetMunicipio.sheetId,
              startRowIndex: 1,
              endRowIndex: cantMunicipios + 1,
              startColumnIndex: 2, // Columna C (Verificadores con Salida a Campo)
              endColumnIndex: 3,
            },
          ],
          booleanRule: {
            condition: {
              type: "NUMBER_EQ",
              values: [{ userEnteredValue: "0" }],
            },
            format: {
              backgroundColor: {
                red: 0.957,
                green: 0.78,
                blue: 0.765, // Light Red 2
              },
            },
          },
        },
        index: 0,
      },
    };

    // Regla 8: reporte_diario_municipio - Columna C != Columna B (Verificadores en el Nodo) y C > 0 -> AMARILLO
    const requestFormatMunSalidaDistinta = {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: sheetMunicipio.sheetId,
              startRowIndex: 1,
              endRowIndex: cantMunicipios + 1,
              startColumnIndex: 2, // Columna C (Verificadores con Salida a Campo)
              endColumnIndex: 3,
            },
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [
                {
                  userEnteredValue: '=AND($C2<>$B2, $C2>0)',
                },
              ],
            },
            format: {
              backgroundColor: {
                red: 0.988,
                green: 0.91,
                blue: 0.702, // Light Yellow 2
              },
            },
          },
        },
        index: 0,
      },
    };

    await (doc as any)._makeBatchUpdateRequest([
      requestFormatNodoSalidaCero,
      requestFormatNodoSalidaDistinta,
      requestFormatNodoSinSalida,
      requestFormatNodoReporto,
      requestFormatMunSalidaCero,
      requestFormatMunSalidaDistinta,
      requestFormatMunSinSalida,
      requestFormatMunNoReportados,
    ]);
    console.log("[INFO] ✅ Reglas de formato condicional (Rojo y Amarillo) aplicadas con éxito en ambas pestañas.");

    console.log("=== ✅ RESTRUCTURACIÓN Y CONFIGURACIÓN DE FORMATO CONDICIONAL COMPLETADA DE FORMA EXITOSA ===");
  } catch (err) {
    console.error("[ERROR FATAL] Falló la configuración de las pestañas:", err);
    process.exit(1);
  }
}

configurarReportesNativos();
