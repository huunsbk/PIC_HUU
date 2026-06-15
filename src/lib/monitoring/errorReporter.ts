import { auditLog } from "../audit/auditLogger";

export function initErrorReporter() {
  if (typeof window === 'undefined') return;

  window.onerror = function (msg, url, lineNo, columnNo, error) {
    auditLog("CLIENT_ERROR", { 
      msg, 
      url, 
      lineNo, 
      columnNo, 
      stack: error?.stack 
    });
    return false;
  };
  
  window.onunhandledrejection = function (event) {
    auditLog("CLIENT_ERROR", { 
      reason: event.reason?.message || event.reason,
      stack: event.reason?.stack
    });
  };
}
