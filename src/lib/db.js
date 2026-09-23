/**
 * Contrat minimal du client SQL attendu par les routes.
 * En prod : pg.Pool (ou équivalent). Ici on documente la forme pour les extraits B/C.
 *
 * @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number }> }} DbClient
 */

export {};
