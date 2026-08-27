/**
 * Interfaces y modelos de dominio del sistema de supervisión de campo.
 */

export interface ReporteParseado {
  municipio: string;
  nodo: number;
  totalVerificadores: number;
  bloque1: number | null;
  bloque2: number | null;
  bloque3: number | null;
}

export interface TiempoConvertido {
  fecha: string;
  hora: string;
}

export interface BloqueInfo {
  minutosDelDia: number;
  horaStr: string;
  bloqueActivo: number;
  bloqueStr: string;
}

export interface ValidacionResultado {
  valido: boolean;
  limiteVerificadores: number;
  municipioOficial: string;
  razon?: string;
  municipioParseado?: string;
  nodoParseado?: number;
}

export interface HistorialAcumulado {
  b1: number;
  b2: number;
  b3: number;
  total: number;
}

export interface ResultadoAcumulacion {
  b1Final: number;
  b2Final: number;
  b3Final: number;
}

export interface NodoCatalogo {
  id?: string;                     // UUID de la fila en nodos_catalogo (pk)
  municipio: string;
  municipioNormalizado?: string;
  municipio_normalizado?: string;
  nodo: number;
  limiteVerificadores?: number;
  limite_verificadores?: number;
}

export interface ReporteDiarioDB {
  id?: string;
  municipio: string;
  municipio_normalizado: string;
  catalogo_nodo_id?: string | null; // UUID FK → nodos_catalogo.id
  nodo: number;
  fecha: string;
  hora?: string;
  bloque_1: number;
  bloque_2: number;
  bloque_3: number;
  total_verificadores: number;
  remitente?: string;
  telegram_message_id?: bigint | number | null;
  telegram_chat_id?: bigint | number | null;
  estado?: string;
  sincronizado_sheets?: boolean;
}

export interface AuditoriaPayload {
  chatId?: number | string;
  messageId?: number | string;
  remitente: string;
  accion: string;
  detalles: any;
  reporteId?: string | null;       // UUID FK → reportes_diarios.id
  catalogoNodoId?: string | null;  // UUID FK → nodos_catalogo.id
}

export interface DatosReporteProcesar {
  reporte: ReporteParseado;
  tiempo: TiempoConvertido;
  remitente: string;
  messageId: number;
  chatId: number;
  creationTimestamp: number;
  editTimestamp?: number | null;
  esEdicion: boolean;
}

export interface ResultadoProcesamiento {
  valido: boolean;
  razon?: string;
  municipioOficial?: string;
  municipioParseado?: string;
  nodoParseado?: number;
  limiteVerificadores?: number;
  totalFinal?: number;
  b1Final?: number;
  b2Final?: number;
  b3Final?: number;
}

export interface SyncCatalogoResultado {
  exitoso: boolean;
  sincronizados: number;
  eliminados?: number;
  razon?: string;
  error?: string;
}
