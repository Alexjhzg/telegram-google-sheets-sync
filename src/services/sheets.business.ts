import { GoogleSpreadsheet } from "google-spreadsheet";
import {
  COLUMNAS,
  asegurarColumnas,
  buscarFilaPorNodo,
  normalizarTexto,
} from "./sheets.js";

const HOJA_PRINCIPAL  = "registros_telegram";
const HOJA_CATALOGO   = "verificadores_nodo";

/**
 * Inicializa la hoja principal con una fila fija por cada nodo del catálogo
 * 'verificadores_nodo'. Si una fila para ese nodo ya existe, no hace nada.
 */
export async function inicializarHojaConNodos(doc: GoogleSpreadsheet): Promise<void> {
  const hojaNodos = doc.sheetsByTitle[HOJA_CATALOGO];
  if (!hojaNodos) {
    console.error(`[ERROR] No se encontró la hoja '${HOJA_CATALOGO}'. No se puede inicializar.`);
    return;
  }

  const hoja = doc.sheetsByTitle[HOJA_PRINCIPAL];
  if (!hoja) return;

  await asegurarColumnas(hoja);

  const filasNodos    = await hojaNodos.getRows();
  const filasActuales = await hoja.getRows();

  let insertados = 0;
  for (const nodoRow of filasNodos) {
    const municipio = (nodoRow.get("MUNICIPIO") || "").trim();
    const nodo      = parseInt(nodoRow.get("NODO") || "0", 10);
    if (!municipio || !nodo) continue;

    if (!buscarFilaPorNodo(filasActuales, municipio, nodo)) {
      await hoja.addRow({
        [COLUMNAS.MUNICIPIO]:           municipio,
        [COLUMNAS.NODO]:                nodo,
        [COLUMNAS.TOTAL_VERIFICADORES]: "0",
        [COLUMNAS.BLOQUE_1]:            "0",
        [COLUMNAS.BLOQUE_2]:            "0",
        [COLUMNAS.BLOQUE_3]:            "0",
        [COLUMNAS.FECHA]:               "",
        [COLUMNAS.HORA]:                "",
        [COLUMNAS.REMITENTE]:           "",
        [COLUMNAS.ID_MENSAJE]:          "",
        [COLUMNAS.ID_CHAT]:             "",
        [COLUMNAS.ESTADO]:              "",
      });
      insertados++;
      console.log(`[INFO] Fila fija creada: ${municipio} — Nodo ${nodo}`);
    }
  }

  console.log(
    insertados > 0
      ? `[INFO] Inicialización completada: ${insertados} fila(s) nueva(s) creada(s).`
      : "[INFO] Inicialización completada: todas las filas de nodos ya existían."
  );
}

/**
 * Elimina filas vacías o huérfanas y ordena las filas restantes por Municipio (A→Z) y Nodo (menor→mayor).
 */
export async function ordenarYLimpiarHojaPrincipal(doc: GoogleSpreadsheet): Promise<void> {
  console.log(`[INFO] Iniciando ordenamiento y limpieza de '${HOJA_PRINCIPAL}'...`);
  try {
    const hojaNodos    = doc.sheetsByTitle[HOJA_CATALOGO];
    const hojaPrincipal = doc.sheetsByTitle[HOJA_PRINCIPAL];

    if (!hojaNodos || !hojaPrincipal) {
      console.error("[ERROR] No se encontraron las hojas necesarias para limpiar/ordenar.");
      return;
    }

    const filasNodos = await hojaNodos.getRows();
    const catalogoSet = new Set(
      filasNodos
        .map(r => {
          const mun = normalizarTexto(r.get("MUNICIPIO"));
          const nod = parseInt(r.get("NODO") || "0", 10);
          return (mun && nod) ? `${mun}-${nod}` : null;
        })
        .filter((val): val is string => Boolean(val))
    );

    let filas = await hojaPrincipal.getRows();
    let eliminadas = 0;

    for (let i = filas.length - 1; i >= 0; i--) {
      const fila = filas[i];
      const mun  = normalizarTexto(fila.get(COLUMNAS.MUNICIPIO));
      const nod  = parseInt(fila.get(COLUMNAS.NODO) || "0", 10);

      if ((!mun && !nod) || (mun && nod && !catalogoSet.has(`${mun}-${nod}`))) {
        console.log(`[INFO] Purgando fila inválida: '${fila.get(COLUMNAS.MUNICIPIO) || "(vacío)"}' Nodo ${fila.get(COLUMNAS.NODO) || "(vacío)"}`);
        await fila.delete();
        eliminadas++;
      }
    }

    if (eliminadas > 0) {
      filas = await hojaPrincipal.getRows();
    }
    if (filas.length === 0) return;

    const datos = filas.map(fila => ({
      municipio: (fila.get(COLUMNAS.MUNICIPIO) || "").trim(),
      nodo:      parseInt(fila.get(COLUMNAS.NODO) || "0", 10),
      total:     fila.get(COLUMNAS.TOTAL_VERIFICADORES) || "0",
      b1:        fila.get(COLUMNAS.BLOQUE_1) || "0",
      b2:        fila.get(COLUMNAS.BLOQUE_2) || "0",
      b3:        fila.get(COLUMNAS.BLOQUE_3) || "0",
      fecha:     fila.get(COLUMNAS.FECHA) || "",
      hora:      fila.get(COLUMNAS.HORA) || "",
      remitente: fila.get(COLUMNAS.REMITENTE) || "",
      idMensaje: fila.get(COLUMNAS.ID_MENSAJE) || "",
      idChat:    fila.get(COLUMNAS.ID_CHAT) || "",
      estado:    fila.get(COLUMNAS.ESTADO) || "",
    }));

    datos.sort((a, b) => {
      const cmpMun = a.municipio.localeCompare(b.municipio);
      return cmpMun !== 0 ? cmpMun : a.nodo - b.nodo;
    });

    const yaOrdenado = filas.every((fila, i) =>
      (fila.get(COLUMNAS.MUNICIPIO) || "").trim() === datos[i].municipio &&
      parseInt(fila.get(COLUMNAS.NODO) || "0", 10) === datos[i].nodo
    );

    if (yaOrdenado) {
      console.log("[INFO] Las filas ya están perfectamente ordenadas. Sin cambios.");
      return;
    }

    console.log("[INFO] Reordenando filas en Google Sheets...");
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const d    = datos[i];

      fila.set(COLUMNAS.MUNICIPIO,           d.municipio);
      fila.set(COLUMNAS.NODO,                String(d.nodo));
      fila.set(COLUMNAS.TOTAL_VERIFICADORES, d.total);
      fila.set(COLUMNAS.BLOQUE_1,            d.b1);
      fila.set(COLUMNAS.BLOQUE_2,            d.b2);
      fila.set(COLUMNAS.BLOQUE_3,            d.b3);
      fila.set(COLUMNAS.FECHA,               d.fecha);
      fila.set(COLUMNAS.HORA,                d.hora);
      fila.set(COLUMNAS.REMITENTE,           d.remitente);
      fila.set(COLUMNAS.ID_MENSAJE,          d.idMensaje);
      fila.set(COLUMNAS.ID_CHAT,             d.idChat);
      fila.set(COLUMNAS.ESTADO,              d.estado);

      await fila.save();
    }
    console.log("[INFO] Reordenamiento completado exitosamente.");
  } catch (error) {
    console.error("[ERROR] Error al ordenar y limpiar la hoja:", error);
  }
}
