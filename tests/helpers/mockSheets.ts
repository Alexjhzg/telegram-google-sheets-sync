import { createGoogle503Error } from "./errorSimulation.js";

export interface MockRowData extends Record<string, any> {
  rowNumber?: number;
}

export interface MockWorksheetOptions {
  title?: string;
  headers?: string[];
  rows?: MockRowData[];
  failAttemptsOnLoadHeader?: number;
  failAttemptsOnSetHeader?: number;
  failAttemptsOnGetRows?: number;
  failAttemptsOnSave?: number;
  failAttemptsOnAddRow?: number;
  errorToThrowOnLoadHeader?: Error;
  errorToThrowOnSetHeader?: Error;
  errorToThrowOnGetRows?: Error;
  errorToThrowOnSave?: Error;
  errorToThrowOnAddRow?: Error;
}

export interface MockWorksheetStats {
  loadHeaderCalls: number;
  setHeaderCalls: number;
  getRowsCalls: number;
  saveCalls: number;
  addRowCalls: number;
  addRowsCalls: number;
  saveUpdatedCellsCalls: number;
}

export interface MockSpreadsheetOptions {
  sheets?: Record<string, MockWorksheetOptions>;
}

export function createMockWorksheet(options: MockWorksheetOptions = {}) {
  let headers = options.headers
    ? [...options.headers]
    : [
        "Municipio",
        "Nodo",
        "Total Verificadores",
        "Bloque 1 (9am)",
        "Bloque 2 (2pm)",
        "Bloque 3 (6pm)",
        "Fecha",
        "Hora",
        "Remitente",
        "ID Mensaje",
        "ID Chat",
        "Estado",
      ];

  let failLoadHeader = options.failAttemptsOnLoadHeader ?? 0;
  let failSetHeader = options.failAttemptsOnSetHeader ?? 0;
  let failGetRows = options.failAttemptsOnGetRows ?? 0;
  let failSave = options.failAttemptsOnSave ?? 0;
  let failAddRow = options.failAttemptsOnAddRow ?? 0;

  const stats: MockWorksheetStats = {
    loadHeaderCalls: 0,
    setHeaderCalls: 0,
    getRowsCalls: 0,
    saveCalls: 0,
    addRowCalls: 0,
    addRowsCalls: 0,
    saveUpdatedCellsCalls: 0,
  };

  interface RowRecord {
    data: Record<string, any>;
    rowNumber: number;
    saveHandler?: (data: Record<string, any>) => Promise<void>;
  }

  const rowRecords: RowRecord[] = [];
  const initialRows = options.rows ?? [];
  let nextRowNumber = 2; // Row 1 is header row

  const defaultRowSaveHandler = async (_data: Record<string, any>) => {
    stats.saveCalls++;
    if (failSave > 0) {
      failSave--;
      throw options.errorToThrowOnSave ?? createGoogle503Error("503 Service Unavailable: row.save()");
    }
  };

  for (const r of initialRows) {
    const rowNum = r.rowNumber ?? nextRowNumber++;
    rowRecords.push({
      data: { ...r },
      rowNumber: rowNum,
    });
  }

  function instantiateRow(record: RowRecord) {
    const staged: Record<string, any> = {};
    return {
      rowNumber: record.rowNumber,
      get(col: string): string {
        if (staged[col] !== undefined) {
          return staged[col] !== null ? String(staged[col]) : "";
        }
        return record.data[col] !== undefined && record.data[col] !== null ? String(record.data[col]) : "";
      },
      set(col: string, val: any): void {
        staged[col] = val !== undefined && val !== null ? String(val) : "";
      },
      assign(updates: Record<string, any>): void {
        for (const [k, v] of Object.entries(updates)) {
          staged[k] = v !== undefined && v !== null ? String(v) : "";
        }
      },
      toObject(): Record<string, any> {
        return { ...record.data, ...staged };
      },
      async save(): Promise<void> {
        const handler = record.saveHandler || defaultRowSaveHandler;
        await handler({ ...record.data, ...staged });
        Object.assign(record.data, staged);
      },
      async delete(): Promise<void> {
        record.data.__deleted = true;
      },
    };
  }

  const worksheet = {
    title: options.title || "registros_telegram",
    stats,
    get headerValues(): string[] {
      return headers;
    },
    async loadHeaderRow(): Promise<string[]> {
      stats.loadHeaderCalls++;
      if (failLoadHeader > 0) {
        failLoadHeader--;
        throw (
          options.errorToThrowOnLoadHeader ??
          createGoogle503Error("503 Service Unavailable: loadHeaderRow()")
        );
      }
      return headers;
    },
    async setHeaderRow(newHeaders: string[]): Promise<void> {
      stats.setHeaderCalls++;
      if (failSetHeader > 0) {
        failSetHeader--;
        throw (
          options.errorToThrowOnSetHeader ??
          createGoogle503Error("503 Service Unavailable: setHeaderRow()")
        );
      }
      headers = [...newHeaders];
    },
    async getRows(): Promise<any[]> {
      stats.getRowsCalls++;
      if (failGetRows > 0) {
        failGetRows--;
        throw (
          options.errorToThrowOnGetRows ??
          createGoogle503Error("503 Service Unavailable: getRows()")
        );
      }
      return rowRecords.filter((r) => !r.data.__deleted).map(instantiateRow);
    },
    async addRow(data: Record<string, any>): Promise<any> {
      stats.addRowCalls++;
      if (failAddRow > 0) {
        failAddRow--;
        throw (
          options.errorToThrowOnAddRow ??
          createGoogle503Error("503 Service Unavailable: addRow()")
        );
      }
      const newRecord: RowRecord = {
        data: { ...data },
        rowNumber: nextRowNumber++,
      };
      rowRecords.push(newRecord);
      return instantiateRow(newRecord);
    },
    async addRows(dataArr: Record<string, any>[]): Promise<any[]> {
      stats.addRowsCalls++;
      const created = [];
      for (const d of dataArr) {
        const nr: RowRecord = {
          data: { ...d },
          rowNumber: nextRowNumber++,
        };
        rowRecords.push(nr);
        created.push(instantiateRow(nr));
      }
      return created;
    },
    async loadCells(): Promise<void> {},
    getCell(_rowIndex: number, _colIndex: number) {
      return { value: "" };
    },
    async saveUpdatedCells(): Promise<void> {
      stats.saveUpdatedCellsCalls++;
    },
    // Test helper to directly configure per-row behavior
    setRowSaveFailure(rowIndex: number, failureCount: number, error?: Error) {
      if (rowRecords[rowIndex]) {
        let remaining = failureCount;
        rowRecords[rowIndex].saveHandler = async (_data: Record<string, any>) => {
          stats.saveCalls++;
          if (remaining > 0) {
            remaining--;
            throw error ?? createGoogle503Error(`503 Service Unavailable: row[${rowIndex}].save()`);
          }
        };
      }
    },
  };

  return worksheet;
}

export function createMockGoogleSpreadsheet(
  worksheetsMap?: Record<string, ReturnType<typeof createMockWorksheet>>
) {
  const sheetsByTitle: Record<string, any> = worksheetsMap
    ? { ...worksheetsMap }
    : {
        registros_telegram: createMockWorksheet({ title: "registros_telegram" }),
        verificadores_nodo: createMockWorksheet({
          title: "verificadores_nodo",
          headers: ["MUNICIPIO", "NODO", "CANTIDAD DE VERIFICADORES"],
          rows: [
            { MUNICIPIO: "Maturín", NODO: "16039", "CANTIDAD DE VERIFICADORES": "5" },
            { MUNICIPIO: "Cedeño", NODO: "16040", "CANTIDAD DE VERIFICADORES": "10" },
          ],
        }),
        registros_historicos_telegram: createMockWorksheet({
          title: "registros_historicos_telegram",
        }),
      };

  let loadInfoCalls = 0;
  let failLoadInfo = 0;

  return {
    sheetsByTitle,
    get loadInfoCalls() {
      return loadInfoCalls;
    },
    setFailLoadInfo(attempts: number) {
      failLoadInfo = attempts;
    },
    async loadInfo(): Promise<void> {
      loadInfoCalls++;
      if (failLoadInfo > 0) {
        failLoadInfo--;
        throw createGoogle503Error("503 Service Unavailable: doc.loadInfo()");
      }
    },
    async addSheet(opts: { title: string }): Promise<any> {
      const ws = createMockWorksheet({ title: opts.title });
      sheetsByTitle[opts.title] = ws;
      return ws;
    },
  };
}
