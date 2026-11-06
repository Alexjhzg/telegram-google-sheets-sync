process.env.NODE_ENV = "test";

import { AxiosError } from "axios";

/**
 * Creates a realistic AxiosError simulating Google Sheets API 503 "The service is currently unavailable".
 * Adheres to the exact JSON response and AxiosError signature produced by google-spreadsheet / axios.
 */
export function createGoogle503Error(
  message = "The service is currently unavailable"
): AxiosError {
  const config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/mock-sheet-id/values/A1",
    method: "GET",
    headers: {},
  } as any;

  const response = {
    status: 503,
    statusText: "Service Unavailable",
    headers: {},
    config,
    data: {
      error: {
        code: 503,
        message,
        status: "UNAVAILABLE",
        errors: [
          {
            message,
            domain: "global",
            reason: "backendError",
          },
        ],
      },
    },
  } as any;

  const error = new AxiosError(message, "ERR_BAD_RESPONSE", config, {}, response);
  error.status = 503;
  return error;
}

/**
 * Creates a non-transient AxiosError (e.g. 400 Bad Request, 403 Forbidden, 404 Not Found)
 * to verify that retry mechanisms fail fast on non-recoverable errors.
 */
export function createGoogleNonTransientError(
  status = 400,
  message = "Bad Request"
): AxiosError {
  const config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/mock-sheet-id/values/A1",
    method: "POST",
    headers: {},
  } as any;

  const statusTextMap: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
  };

  const statusReasonMap: Record<number, string> = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
  };

  const response = {
    status,
    statusText: statusTextMap[status] || "Error",
    headers: {},
    config,
    data: {
      error: {
        code: status,
        message,
        status: statusReasonMap[status] || "ERROR",
      },
    },
  } as any;

  const error = new AxiosError(
    message,
    status === 400 ? "ERR_BAD_REQUEST" : "ERR_BAD_RESPONSE",
    config,
    {},
    response
  );
  error.status = status;
  return error;
}

/**
 * Creates a low-level transient socket/network error without an HTTP response
 * (e.g. ETIMEDOUT, ECONNRESET).
 */
export function createNetworkError(
  code: "ETIMEDOUT" | "ECONNRESET" = "ETIMEDOUT",
  message = "connect ETIMEDOUT 142.250.190.42:443"
): AxiosError {
  const config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/mock-sheet-id",
  } as any;
  const error = new AxiosError(message, code, config, {});
  (error as any).code = code;
  return error;
}
