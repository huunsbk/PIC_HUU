export async function auditLog(action: string, details: any) {
  if (import.meta.env.DEV) {
    console.debug('[ClientAudit]', action, details);
  }
}
