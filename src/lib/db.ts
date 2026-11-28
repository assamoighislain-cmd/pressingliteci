import { supabase } from '@/lib/supabase';
import { enqueueMutation, onPostSync, getPendingMutationsForTableAsync } from '@/lib/offlineQueue';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';
import {
  cachedRead,
  getCached,
  setCached,
  getCachedWithScopeFallbackAsync,
  isLikelyNetworkError,
  throwIfNetworkError,
  markCacheRefreshedNow,
  OfflineNetworkError,
} from '@/lib/readCache';
import { readOfflineSessionBackup } from '@/lib/offlineSession';
import { searchClientsIndexed } from '@/lib/clientSearchIndex';
import {
  bKey,
  getScopedCached,
  generateUuid,
  observeDepotNumeros,
  observeClientCodes,
  observeArticleCodes,
  observeTraitementCodes,
  getBillingPointCode,
  normalizeBillingPointCode,
  getDepotStartSeq,
  setDepotStartSeq,
  getBoutiqueDepotStartSeq,
  setBoutiqueDepotStartSeq,
  syncBoutiqueDepotStartSeqs,
  setBoutiqueGeo,
  hydrateBoutiquesWithGeo,
  setBoutiqueReceiptHeader,
  hydrateBoutiquesWithReceiptHeader,
  getDefaultBoutiqueId,
  getCompanyDepotStartSeq,
  setCompanyDepotStartSeq,
  syncCompanyDepotStartSeqFromEntreprise,
  previewOnlineDepotNumero,
  previewOfflineDepotNumero,
  computeNextOnlineDepotNumero,
  generateOfflineDepotNumero,
  computeNextOnlineClientCode,
  generateOfflineClientCode,
  formatClientCode,
  parseClientCodeInfo,
  generateOfflineRpcCode,
  prepareOfflineInsertRows,
  buildMutationLabel,
  UUID_PK_TABLES,
  optimisticUpsertClient,
  optimisticPatchClient,
  optimisticRemoveClient,
  optimisticUpsertArticle,
  optimisticInsertDepot,
  optimisticAttachDepotArticles,
  optimisticPatchDepot,
  optimisticRemoveDepot,
  optimisticPatchDepotArticle,
  optimisticInsertAvance,
  optimisticInsertDepense,
  optimisticPatchDepense,
  optimisticRemoveDepense,
  optimisticAdjustConsommable,
} from '@/lib/dbOfflineHelpers';
import type {
  Client,
  TypeTraitement,
  ArticleCatalog,
  ArticleVariant,
  Entreprise,
  Depot,
  DepotArticle,
  DepotAvance,
  DepotWithClient,
  DepotWithArticles,
  ModeReglementRow,
  Depense,
  DepenseCategory,
  Boutique,
  FidelitePoints,
  FideliteHistory,
  BonReduction,
  Consommable,
  ConsommableMouvement,
  Relance,
  RelanceWithClient,
  Commercial,
  CommercialClient,
  CommercialClientWithDetails,
  CommercialPortalBranding,
  CommercialPortalData,
  CommissionVersement,
  EcritureComptableRecord,
  SyscohadaJournalCode,
  SyscohadaLigneInput,
} from '@/types';
import { computeDateFinFromDays } from '@/types';

const COMMERCIAL_PORTAL_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateCommercialPortalCode(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += COMMERCIAL_PORTAL_ALPHABET[bytes[i] % COMMERCIAL_PORTAL_ALPHABET.length];
  }
  return `COM-${suffix}`;
}

// ─── Types ────────────────────────────────────────────────

export type TableName =
  | 'clients'
  | 'types_traitement'
  | 'articles'
  | 'depots'
  | 'depot_articles'
  | 'depot_avances'
  | 'entreprise'
  | 'depot_counter'
  | 'code_counter'
  | 'depenses'
  | 'depense_categories'
  | 'article_variants'
  | 'boutiques'
  | 'fidelite_points'
  | 'fidelite_history'
  | 'bons_reduction'
  | 'consommables'
  | 'consommable_mouvements'
  | 'modes_reglement'
  | 'relances'
  | 'commerciaux'
  | 'commission_versements'
  | 'commercial_clients';

interface QueryOrder {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
}

interface QueryFilter {
  column: string;
  operator: string;
  value: unknown;
}

interface QueryConfig {
  table: TableName;
  select?: string;
  filters?: QueryFilter[];
  order?: QueryOrder;
  limit?: number;
  count?: 'exact';
  head?: boolean;
  single?: boolean;
  maybeSingle?: boolean;
}

interface InsertConfig {
  table: TableName;
  rows: Record<string, unknown> | Record<string, unknown>[];
  select?: string;
  timeoutMs?: number;
}

interface UpdateConfig {
  table: TableName;
  values: Record<string, unknown>;
  filters: QueryFilter[];
  select?: string;
}

interface DeleteConfig {
  table: TableName;
  filters: QueryFilter[];
}

interface UpsertConfig {
  table: TableName;
  row: Record<string, unknown>;
}

export interface QueryResult<T> {
  data: T[] | null;
  error: string | null;
  count: number | null;
}

export interface MutationResult<T> {
  data: T | null;
  error: string | null;
}

// ─── Tenant ID cache (for multi-user team support) ──────────

let cachedTenantId: string | null | undefined = undefined;
const TENANT_STORAGE_KEY = 'offline_last_tenant_id';

export function setCachedTenantId(id: string | null): void {
  cachedTenantId = id ?? undefined;
  try {
    if (id) localStorage.setItem(TENANT_STORAGE_KEY, id);
    else localStorage.removeItem(TENANT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

async function getTenantId(): Promise<string | null> {
  if (cachedTenantId !== undefined) return cachedTenantId;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      const stored = localStorage.getItem(TENANT_STORAGE_KEY);
      if (stored) {
        cachedTenantId = stored;
        return stored;
      }
    } catch {
      // Ignore
    }
  }
  try {
    const { data, error } = await supabase.rpc('get_tenant_id');
    if (!error && data) {
      setCachedTenantId(data as string);
      return cachedTenantId ?? null;
    }
  } catch {
    // Offline fallback below
  }
  try {
    const stored = localStorage.getItem(TENANT_STORAGE_KEY);
    if (stored) {
      cachedTenantId = stored;
      return stored;
    }
  } catch {
    // Ignore
  }
  const backupUser = readOfflineSessionBackup()?.user ?? null;
  if (backupUser?.id) {
    setCachedTenantId(backupUser.id);
    return backupUser.id;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const fallback = session?.user?.id ?? null;
    if (fallback) setCachedTenantId(fallback);
    return fallback;
  } catch {
    return null;
  }
}

export function resetTenantCache(): void {
  cachedTenantId = undefined;
}

// ─── Current boutique (set by auth context) ───────────────

let currentBoutiqueId: string | null = null;

export function setCurrentBoutiqueId(id: string | null): void {
  currentBoutiqueId = id;
}

export function getCurrentBoutiqueId(): string | null {
  return currentBoutiqueId;
}

const TENANT_TABLES = new Set<TableName>([
  'clients', 'types_traitement', 'articles', 'depots',
  'depot_articles', 'depot_avances', 'modes_reglement',
  'depenses', 'depense_categories',
  'article_variants', 'fidelite_points', 'fidelite_history', 'bons_reduction',
  'consommables', 'consommable_mouvements', 'relances',
  'commerciaux', 'commission_versements', 'commercial_clients',
]);

// Tenant-scoped tables whose PostgreSQL schema uses tenant_id (+ boutique_id) without a user_id column.
const TABLES_WITHOUT_USER_ID = new Set<TableName>([
  'fidelite_points',
  'fidelite_history',
  'consommables',
  'consommable_mouvements',
  'relances',
  'commerciaux',
  'commission_versements',
  'commercial_clients',
]);

function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

function extractMissingSchemaColumn(message: string | null | undefined): string | null {
  if (!message) return null;
  const match = message.match(/Could not find the '([^']+)' column of '[^']+' in the schema cache/i);
  return match ? match[1] : null;
}

function stripColumnFromRow(row: Record<string, unknown>, col: string): Record<string, unknown> {
  if (!(col in row)) return row;
  const copy = { ...row };
  delete copy[col];
  return copy;
}

// ─── Supabase query ───────────────────────────────────────

async function supabaseQuery<T>(config: QueryConfig): Promise<QueryResult<T>> {
  let query = supabase.from(config.table).select(
    config.select ?? '*',
    { count: config.count ?? undefined, head: config.head ?? false },
  );
  for (const f of config.filters ?? []) {
    // @ts-expect-error - dynamic operator
    query = query[f.operator](f.column, f.value);
  }
  if (config.order) {
    query = query.order(config.order.column, {
      ascending: config.order.ascending ?? true,
      nullsFirst: config.order.nullsFirst,
    });
  }
  if (config.limit) query = query.limit(config.limit);

  if (config.single) {
    const { data, error, count } = await query.single();
    return { data: (data ? [data as T] : null), error: error?.message ?? null, count };
  }
  if (config.maybeSingle) {
    const { data, error, count } = await query.maybeSingle();
    return { data: (data ? [data as T] : null), error: error?.message ?? null, count };
  }
  const { data, error, count } = await query;
  return { data: (data as T[]) ?? null, error: error?.message ?? null, count };
}

// ─── Public query API ──────────────────────────────────────

export async function query<T = Record<string, unknown>>(config: QueryConfig): Promise<QueryResult<T>> {
  return supabaseQuery<T>(config);
}

// ─── Public mutation API ───────────────────────────────────

// Tables whose mutations can be queued for offline sync.
const QUEUEABLE_TABLES = new Set<TableName>([
  'clients', 'types_traitement', 'articles', 'depots',
  'depot_articles', 'depot_avances', 'depenses', 'depense_categories',
  'article_variants', 'bons_reduction', 'consommables', 'consommable_mouvements',
  'modes_reglement', 'fidelite_points', 'fidelite_history', 'relances',
  'commerciaux', 'commission_versements', 'commercial_clients',
]);

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

const FAST_WRITE_TIMEOUT_MS = 4500;
const SUPABASE_PAGE_SIZE = 1000;
const MAX_PAGINATED_ROWS = 100000;

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < MAX_PAGINATED_ROWS; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1);
    throwIfNetworkError(error);
    if (error) throw new Error(error.message);
    const page = (data as T[] | null) ?? [];
    all.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return all;
}

async function withWriteTimeout<R>(promiseLike: PromiseLike<R>, timeoutMs = FAST_WRITE_TIMEOUT_MS): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promiseLike),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new OfflineNetworkError('Write timeout — continuing in background'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function ensureDeterministicRowIds(
  table: TableName,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (!UUID_PK_TABLES.has(table)) return rows;
  return rows.map((r) => (r.id ? r : { ...r, id: generateUuid() }));
}

function enqueueOfflineInsert<T>(config: InsertConfig, rows: Record<string, unknown>[]): MutationResult<T> {
  const { dbRows, optimisticRows } = prepareOfflineInsertRows(config.table, rows);
  for (const r of dbRows) {
    enqueueMutation(
      config.table,
      'insert',
      r,
      undefined,
      buildMutationLabel(config.table, 'insert', r),
    );
  }
  notifyRealtimeMutation(config.table);
  const result = rows.length === 1 ? optimisticRows[0] : optimisticRows;
  return { data: (result as T) ?? null, error: null };
}

export async function insert<T = Record<string, unknown>>(config: InsertConfig): Promise<MutationResult<T>> {
  let rows = Array.isArray(config.rows) ? config.rows : [config.rows];

  if (TENANT_TABLES.has(config.table)) {
    const tId = await getTenantId();
    const includeUserId = !TABLES_WITHOUT_USER_ID.has(config.table);
    rows = rows.map((r) => {
      const next: Record<string, unknown> = {
        ...r,
        ...(tId ? { tenant_id: r.tenant_id ?? tId } : {}),
        boutique_id: r.boutique_id ?? currentBoutiqueId,
      };
      if (includeUserId) {
        if (tId) next.user_id = r.user_id ?? tId;
      } else {
        delete next.user_id;
      }
      return next;
    });
  }

  rows = ensureDeterministicRowIds(config.table, rows);

  if (isOffline() && QUEUEABLE_TABLES.has(config.table)) {
    return enqueueOfflineInsert<T>(config, rows);
  }

  try {
    const runInsert = async (payloadRows: Record<string, unknown>[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(config.table).insert(payloadRows);
      if (config.select || config.table === 'articles' || config.table === 'bons_reduction') {
        q = q.select();
      }
      return QUEUEABLE_TABLES.has(config.table)
        ? await withWriteTimeout<{ data: unknown; error: { message: string } | null }>(q, config.timeoutMs)
        : await q;
    };

    let currentRows = rows;
    let { data, error } = await runInsert(currentRows);

    // Auto-recover if PostgREST reports a column missing from schema cache (PGRST204)
    for (let retry = 0; retry < 5 && error; retry++) {
      const missingCol = extractMissingSchemaColumn(error.message);
      if (!missingCol || !currentRows.some((r) => missingCol in r)) break;
      currentRows = currentRows.map((r) => stripColumnFromRow(r, missingCol));
      ({ data, error } = await runInsert(currentRows));
    }

    if (error) {
      if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(error)) {
        return enqueueOfflineInsert<T>(config, currentRows);
      }
      return { data: null, error: error.message };
    }
    notifyRealtimeMutation(config.table, config.table === 'entreprise');
    const result = Array.isArray(data) && !Array.isArray(config.rows) ? data[0] : data;
    return { data: (result as T) ?? null, error: null };
  } catch (err) {
    if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(err)) {
      return enqueueOfflineInsert<T>(config, rows);
    }
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function update<T = Record<string, unknown>>(config: UpdateConfig): Promise<MutationResult<T>> {
  let cleanValues = TABLES_WITHOUT_USER_ID.has(config.table)
    ? stripColumnFromRow(config.values, 'user_id')
    : config.values;

  const queueOffline = () => {
    enqueueMutation(
      config.table,
      'update',
      cleanValues,
      config.filters as unknown as Record<string, unknown>[],
      buildMutationLabel(config.table, 'update', cleanValues),
    );
    notifyRealtimeMutation(config.table);
    return { data: null, error: null } as MutationResult<T>;
  };

  if (isOffline() && QUEUEABLE_TABLES.has(config.table)) {
    return queueOffline();
  }
  try {
    const runUpdate = async (vals: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(config.table).update(vals);
      for (const f of config.filters) {
        q = q[f.operator](f.column, f.value);
      }
      if (config.select) q = q.select();
      return QUEUEABLE_TABLES.has(config.table)
        ? await withWriteTimeout<{ data: unknown; error: { message: string } | null }>(q)
        : await q;
    };

    let { data, error } = await runUpdate(cleanValues);
    for (let retry = 0; retry < 5 && error; retry++) {
      const missingCol = extractMissingSchemaColumn(error.message);
      if (!missingCol || !(missingCol in cleanValues)) break;
      cleanValues = stripColumnFromRow(cleanValues, missingCol);
      ({ data, error } = await runUpdate(cleanValues));
    }

    if (error) {
      if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(error)) {
        return queueOffline();
      }
      return { data: null, error: error.message };
    }
    notifyRealtimeMutation(config.table, config.table === 'entreprise');
    return { data: (data as T) ?? null, error: null };
  } catch (err) {
    if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(err)) {
      return queueOffline();
    }
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function remove(config: DeleteConfig): Promise<{ error: string | null }> {
  const queueOffline = () => {
    enqueueMutation(
      config.table,
      'delete',
      {},
      config.filters as unknown as Record<string, unknown>[],
      buildMutationLabel(config.table, 'delete', {}),
    );
    notifyRealtimeMutation(config.table);
    return { error: null };
  };

  if (isOffline() && QUEUEABLE_TABLES.has(config.table)) {
    return queueOffline();
  }
  try {
    let q = supabase.from(config.table).delete();
    for (const f of config.filters) {
      // @ts-expect-error - dynamic operator
      q = q[f.operator](f.column, f.value);
    }
    const { error } = QUEUEABLE_TABLES.has(config.table)
      ? await withWriteTimeout<{ error: { message: string } | null }>(q)
      : await q;
    if (error && QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(error)) {
      return queueOffline();
    }
    if (!error) {
      notifyRealtimeMutation(config.table, config.table === 'entreprise');
    }
    return { error: error?.message ?? null };
  } catch (err) {
    if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(err)) {
      return queueOffline();
    }
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function upsert<T = Record<string, unknown>>(config: UpsertConfig): Promise<MutationResult<T>> {
  let row = config.row;
  if (TENANT_TABLES.has(config.table)) {
    const tId = await getTenantId();
    const includeUserId = !TABLES_WITHOUT_USER_ID.has(config.table);
    const next: Record<string, unknown> = {
      ...row,
      ...(tId ? { tenant_id: row.tenant_id ?? tId } : {}),
      boutique_id: row.boutique_id ?? currentBoutiqueId,
    };
    if (includeUserId) {
      if (tId) next.user_id = row.user_id ?? tId;
    } else {
      delete next.user_id;
    }
    row = next;
  }
  const queueOffline = () => {
    enqueueMutation(config.table, 'upsert', row, undefined, buildMutationLabel(config.table, 'upsert', row));
    notifyRealtimeMutation(config.table);
    return { data: (row as T) ?? null, error: null };
  };
  if (isOffline() && QUEUEABLE_TABLES.has(config.table)) {
    return queueOffline();
  }
  try {
    const runUpsert = async (payloadRow: Record<string, unknown>) => {
      const req = supabase.from(config.table).upsert(payloadRow);
      return QUEUEABLE_TABLES.has(config.table)
        ? await withWriteTimeout<{ data: unknown; error: { message: string } | null }>(req)
        : await req;
    };

    let { data, error } = await runUpsert(row);
    for (let retry = 0; retry < 2 && error; retry++) {
      const missingCol = extractMissingSchemaColumn(error.message);
      if (!missingCol || !(missingCol in row)) break;
      row = stripColumnFromRow(row, missingCol);
      ({ data, error } = await runUpsert(row));
    }

    if (error) {
      if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(error)) {
        return queueOffline();
      }
      return { data: null, error: error.message };
    }
    notifyRealtimeMutation(config.table, config.table === 'entreprise');
    return { data: (data as T) ?? null, error: null };
  } catch (err) {
    if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(err)) {
      return queueOffline();
    }
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─── RPC (for code generation functions) ───────────────────

export async function rpc<T = unknown>(fnName: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  if (fnName === 'generate_client_code') {
    const res = await db.nextClientCode();
    return { data: (res.code as T) ?? null, error: res.error };
  }
  if (isOffline()) {
    const offlineCode = generateOfflineRpcCode(fnName, currentBoutiqueId);
    if (offlineCode !== null) return { data: offlineCode as T, error: null };
    return { data: null, error: 'Hors ligne' };
  }
  try {
    const { data, error } = await supabase.rpc(fnName, args);
    if (error) {
      if (isLikelyNetworkError(error)) {
        const offlineCode = generateOfflineRpcCode(fnName, currentBoutiqueId);
        if (offlineCode !== null) return { data: offlineCode as T, error: null };
      }
      return { data: null, error: error.message };
    }
    return { data: (data as T) ?? null, error: null };
  } catch (err) {
    const offlineCode = generateOfflineRpcCode(fnName, currentBoutiqueId);
    if (offlineCode !== null) return { data: offlineCode as T, error: null };
    return { data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─── Offline persistence guards & mutation overlay ─────────

async function assertSafeToCacheEmptyList(cacheKey: string): Promise<void> {
  const existing = await getCachedWithScopeFallbackAsync<unknown[]>(cacheKey);
  if (!Array.isArray(existing) || existing.length === 0) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
    const hasValidSession = Boolean(session?.access_token) && (!expiresAtMs || expiresAtMs > Date.now() + 5000);
    if (!hasValidSession) {
      throw new OfflineNetworkError('Session non vérifiée — conservation du cache hors-ligne');
    }
  } catch (err) {
    if (err instanceof OfflineNetworkError) throw err;
    throw new OfflineNetworkError('Impossible de vérifier la session — conservation du cache hors-ligne');
  }
}

async function applyPendingClientMutations(
  baseClients: Client[],
  boutiqueId: string | null,
): Promise<Client[]> {
  const pending = await getPendingMutationsForTableAsync('clients');
  if (pending.length === 0) return baseClients;

  const byId = new Map<string, Client>();
  for (const c of baseClients) {
    if (c && c.id) byId.set(c.id, c);
  }

  let mutated = false;
  for (const m of pending) {
    if (m.operation === 'insert') {
      const d = m.data;
      const id = String(d.id ?? '');
      if (!id) continue;
      const rowBoutique = (d.boutique_id as string | null | undefined) ?? null;
      if (boutiqueId && rowBoutique && rowBoutique !== boutiqueId) continue;
      const existing = byId.get(id);
      const merged: Client = {
        ...(existing ?? ({} as Client)),
        id,
        code: String(d.code ?? existing?.code ?? ''),
        nom: String(d.nom ?? existing?.nom ?? ''),
        telephone: (d.telephone as string | null) ?? existing?.telephone ?? null,
        taux_remise: Number(d.taux_remise ?? existing?.taux_remise ?? 0),
        condition_remise:
          d.condition_remise != null
            ? Number(d.condition_remise)
            : (existing?.condition_remise ?? null),
        date_naissance: (d.date_naissance as string | null) ?? existing?.date_naissance ?? null,
        portal_code: (d.portal_code as string | null) ?? existing?.portal_code ?? null,
        created_at: String(d.created_at ?? existing?.created_at ?? m.createdAt),
      };
      byId.set(id, merged);
      mutated = true;
    } else if (m.operation === 'update') {
      const idFilter = m.filters?.find((f) => f.column === 'id' && f.operator === 'eq');
      const targetId = idFilter ? String(idFilter.value ?? '') : '';
      if (!targetId) continue;
      const existing = byId.get(targetId);
      if (existing) {
        byId.set(targetId, {
          ...existing,
          ...(m.data as Partial<Client>),
          taux_remise:
            m.data.taux_remise !== undefined ? Number(m.data.taux_remise) : existing.taux_remise,
          condition_remise:
            m.data.condition_remise !== undefined
              ? (m.data.condition_remise != null ? Number(m.data.condition_remise) : null)
              : existing.condition_remise,
        });
        mutated = true;
      }
    } else if (m.operation === 'delete') {
      const idFilter = m.filters?.find((f) => f.column === 'id' && f.operator === 'eq');
      const targetId = idFilter ? String(idFilter.value ?? '') : '';
      if (targetId && byId.delete(targetId)) {
        mutated = true;
      }
    }
  }

  if (!mutated) return baseClients;
  return Array.from(byId.values()).sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? ''));
}

// ─── Typed convenience wrappers ────────────────────────────

const CLIENT_SELECT_COLUMNS =
  'id, code, nom, telephone, taux_remise, condition_remise, date_naissance, portal_code, boutique_id, created_at';

const inFlightAllClients = new Map<string, Promise<Client[]>>();

function sanitizePostgrestSearchTerm(raw: string): string {
  return raw.replace(/[,()%*]/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapClientRow(r: Record<string, unknown>): Client {
  return {
    ...r,
    taux_remise: Number(r.taux_remise ?? 0),
    condition_remise: r.condition_remise != null ? Number(r.condition_remise) : null,
  } as Client;
}

export const db = {
  // Clients
  getCachedClientsSync(): Client[] | null {
    const cacheKey = bKey('all_clients', currentBoutiqueId);
    const cached = getCached<Client[]>(cacheKey);
    return Array.isArray(cached) ? cached : null;
  },

  searchClientsLocal(term: string, limit = 15): Client[] | null {
    if (!term.trim()) return [];
    const cached = db.getCachedClientsSync();
    if (!cached) return null;
    return searchClientsIndexed(cached, term, limit);
  },

  async searchClientsRemote(term: string, limit = 15): Promise<Client[]> {
    const trimmed = term.trim();
    if (!trimmed) return [];
    const searchFromCache = async (): Promise<Client[]> => {
      const cached = await db.getAllClients();
      return searchClientsIndexed(cached, trimmed, limit);
    };
    if (isOffline()) return searchFromCache();
    const safeTerm = sanitizePostgrestSearchTerm(trimmed);
    if (!safeTerm) return [];
    let q = supabase
      .from('clients')
      .select(CLIENT_SELECT_COLUMNS)
      .or(`nom.ilike.%${safeTerm}%,telephone.ilike.%${safeTerm}%,code.ilike.%${safeTerm}%`)
      .order('nom')
      .limit(limit);
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? searchFromCache() : [];
    return ((data as Record<string, unknown>[]) ?? []).map(mapClientRow);
  },

  async searchClients(term: string, limit = 15): Promise<Client[]> {
    const trimmed = term.trim();
    if (!trimmed) return [];
    const localHits = db.searchClientsLocal(trimmed, limit);
    if (localHits !== null) {
      if (localHits.length > 0 || isOffline()) return localHits;
      // Local cache is warm and returned 0 hits: check remote once in case a client was just created elsewhere
      return db.searchClientsRemote(trimmed, limit);
    }
    return db.searchClientsRemote(trimmed, limit);
  },

  async getAllClients(): Promise<Client[]> {
    const boutiqueAtStart = currentBoutiqueId;
    const cacheKey = bKey('all_clients', boutiqueAtStart);
    const existingInFlight = inFlightAllClients.get(cacheKey);
    if (existingInFlight) return existingInFlight;

    const promise = (async () => {
      const list = await cachedRead(cacheKey, async () => {
        const data = await fetchAllPages<Record<string, unknown>>((from, to) => {
          let q = supabase
            .from('clients')
            .select(CLIENT_SELECT_COLUMNS)
            .order('nom', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to);
          if (boutiqueAtStart) q = q.eq('boutique_id', boutiqueAtStart);
          return q;
        });
        const mapped = data.map(mapClientRow);
        if (mapped.length === 0) {
          await assertSafeToCacheEmptyList(cacheKey);
        }
        observeClientCodes(mapped, boutiqueAtStart);
        return mapped;
      }, []);
      const merged = await applyPendingClientMutations(list, boutiqueAtStart);
      if (merged.length > 0) {
        observeClientCodes(merged, boutiqueAtStart);
      }
      return merged;
    })().finally(() => {
      inFlightAllClients.delete(cacheKey);
    });

    inFlightAllClients.set(cacheKey, promise);
    return promise;
  },

  async getLastDepotDates(clientIds: string[]): Promise<Record<string, { date: string; total: number; count: number }>> {
    const map: Record<string, { date: string; total: number; count: number }> = {};
    if (clientIds.length === 0) return map;
    const idSet = new Set(clientIds);
    const computeFromCache = async () => {
      const cached =
        (await getCachedWithScopeFallbackAsync<DepotWithArticles[]>(bKey('all_depots', currentBoutiqueId))) ?? [];
      for (const d of cached) {
        if (!idSet.has(d.client_id)) continue;
        if (!(d.client_id in map) || d.date_depot > map[d.client_id].date) {
          map[d.client_id] = { date: d.date_depot, total: map[d.client_id]?.total ?? 0, count: map[d.client_id]?.count ?? 0 };
        }
        map[d.client_id].total += Number(d.total);
        map[d.client_id].count += 1;
      }
      return map;
    };
    if (isOffline()) return computeFromCache();
    try {
      const useInFilter = clientIds.length <= 150;
      const rows = await fetchAllPages<{ client_id: string; date_depot: string; total: string | number }>((from, to) => {
        let q = supabase
          .from('depots')
          .select('client_id, date_depot, total')
          .order('date_depot', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (useInFilter) q = q.in('client_id', clientIds);
        if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
        return q;
      });
      for (const d of rows) {
        if (!idSet.has(d.client_id)) continue;
        if (!(d.client_id in map)) {
          map[d.client_id] = { date: d.date_depot, total: 0, count: 0 };
        }
        map[d.client_id].total += Number(d.total);
        map[d.client_id].count += 1;
      }
      return map;
    } catch (err) {
      return isLikelyNetworkError(err) ? computeFromCache() : map;
    }
  },

  async insertClient(row: { code: string; nom: string; telephone: string | null; taux_remise: number; condition_remise: number | null; date_naissance?: string | null }): Promise<{ data: Client | null; error: string | null }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await insert<Client>({ table: 'clients', rows: row, select: '*' });
      if (result.data) {
        const d = result.data as unknown as Record<string, unknown>;
        const client = {
          ...d,
          taux_remise: Number(d.taux_remise ?? row.taux_remise),
          condition_remise: d.condition_remise != null ? Number(d.condition_remise) : null,
        } as unknown as Client;
        observeClientCodes([client], currentBoutiqueId);
        optimisticUpsertClient(client, currentBoutiqueId);
        return { data: client, error: null };
      }
      if (result.error && result.error.includes('duplicate key') && attempt < 2) {
        const { data: newCode } = await rpc<string>('generate_client_code');
        if (newCode) { row = { ...row, code: newCode }; continue; }
      }
      return { data: null, error: result.error };
    }
    return { data: null, error: 'duplicate key' };
  },

  async insertClientsBatch(
    rows: Array<{
      nom: string;
      telephone: string | null;
      taux_remise: number;
      condition_remise: number | null;
      date_naissance?: string | null;
    }>,
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ success: number; errors: string[] }> {
    if (rows.length === 0) return { success: 0, errors: [] };

    const pointCode = getBillingPointCode();
    const resolveStartSeq = async (): Promise<number> => {
      const firstCodeRes = await db.nextClientCode();
      const parsed = parseClientCodeInfo(firstCodeRes.code);
      return parsed?.seq ?? 1;
    };

    let nextSeq = await resolveStartSeq();
    const BATCH_SIZE = 100;
    let success = 0;
    const errors: string[] = [];
    const insertedCodes: Array<{ code: string }> = [];

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const slice = rows.slice(start, start + BATCH_SIZE);
      const buildBatchPayload = (startSeq: number) =>
        slice.map((r, idx) => ({
          code: formatClientCode(startSeq + idx, pointCode),
          nom: r.nom,
          telephone: r.telephone,
          taux_remise: r.taux_remise,
          condition_remise: r.condition_remise,
          ...(r.date_naissance ? { date_naissance: r.date_naissance } : {}),
        }));

      let payload = buildBatchPayload(nextSeq);
      let res = await insert<Client[]>({
        table: 'clients',
        rows: payload,
        select: 'id, code',
        timeoutMs: 25000,
      });

      if (res.error && res.error.includes('duplicate key')) {
        nextSeq = await resolveStartSeq();
        payload = buildBatchPayload(nextSeq);
        res = await insert<Client[]>({
          table: 'clients',
          rows: payload,
          select: 'id, code',
          timeoutMs: 25000,
        });
      }

      if (!res.error) {
        nextSeq += slice.length;
        success += slice.length;
        for (const p of payload) insertedCodes.push({ code: p.code });
      } else {
        // Fallback row-by-row for this chunk so valid rows still succeed and exact failures are reported
        for (const r of slice) {
          const code = formatClientCode(nextSeq++, pointCode);
          const singleRes = await db.insertClient({
            code,
            nom: r.nom,
            telephone: r.telephone,
            taux_remise: r.taux_remise,
            condition_remise: r.condition_remise,
            date_naissance: r.date_naissance ?? null,
          });
          if (singleRes.error) {
            errors.push(`${r.nom}: ${singleRes.error}`);
          } else {
            success++;
            if (singleRes.data?.code) insertedCodes.push({ code: singleRes.data.code });
          }
        }
      }

      onProgress?.(Math.min(start + slice.length, rows.length), rows.length);
    }

    if (insertedCodes.length > 0) {
      observeClientCodes(insertedCodes, currentBoutiqueId);
    }

    return { success, errors };
  },

  async updateClient(id: string, values: { nom: string; telephone: string | null; taux_remise: number; condition_remise: number | null; date_naissance?: string | null }): Promise<string | null> {
    const result = await update({ table: 'clients', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticPatchClient(id, values, currentBoutiqueId);
    return result.error;
  },

  async deleteClient(id: string): Promise<string | null> {
    const result = await remove({ table: 'clients', filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticRemoveClient(id, currentBoutiqueId);
    return result.error;
  },

  async deleteAllClientsForCurrentBoutique(boutiqueId?: string | null): Promise<string | null> {
    if (isOffline()) {
      return 'Connexion internet requise pour supprimer tous les clients.';
    }
    const targetBoutiqueId = boutiqueId !== undefined ? boutiqueId : currentBoutiqueId;
    try {
      let q = supabase.from('clients').delete();
      if (targetBoutiqueId) {
        q = q.eq('boutique_id', targetBoutiqueId);
      } else {
        const tId = await getTenantId();
        if (!tId) return 'Impossible d’identifier le compte.';
        q = q.eq('tenant_id', tId);
      }
      const { error } = await withWriteTimeout<{ error: { message: string } | null }>(q, 60000);
      if (error) return error.message;
      setCached(bKey('all_clients', targetBoutiqueId), []);
      notifyRealtimeMutation('clients');
      notifyRealtimeMutation('depots');
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Erreur réseau lors de la suppression';
    }
  },

  async normalizeBoutiqueClientCodes(
    targetPrefix: string,
    boutiqueId?: string | null,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ updated: number; alreadyCompliant: number; total: number; error: string | null }> {
    if (isOffline()) {
      return {
        updated: 0,
        alreadyCompliant: 0,
        total: 0,
        error: 'Connexion internet requise pour harmoniser les codes clients.',
      };
    }

    const targetBoutiqueId = boutiqueId !== undefined ? boutiqueId : currentBoutiqueId;
    const cleanPrefix = normalizeBillingPointCode(targetPrefix);

    // 1. Try fast atomic server RPC first (if migration is deployed)
    if (targetBoutiqueId) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('normalize_boutique_client_codes', {
          p_boutique_id: targetBoutiqueId,
          p_target_prefix: cleanPrefix,
        });
        if (!rpcErr && rpcData && typeof rpcData === 'object') {
          const payload = rpcData as { updated?: number; already_compliant?: number; total?: number };
          const updated = Number(payload.updated ?? 0);
          const alreadyCompliant = Number(payload.already_compliant ?? 0);
          const total = Number(payload.total ?? updated + alreadyCompliant);
          onProgress?.(updated, updated);
          notifyRealtimeMutation('clients');
          await db.getAllClients();
          return { updated, alreadyCompliant, total, error: null };
        }
        if (
          rpcErr &&
          !rpcErr.message.toLowerCase().includes('could not find the function') &&
          !rpcErr.message.toLowerCase().includes('does not exist') &&
          rpcErr.code !== 'PGRST202' &&
          rpcErr.code !== '42883'
        ) {
          return { updated: 0, alreadyCompliant: 0, total: 0, error: rpcErr.message };
        }
      } catch {
        // Fallback to collision-proof batched client-side update below
      }
    }

    // 2. Fallback: collision-proof batched update using existing tenant RLS policies
    try {
      const allTenantClients = await fetchAllPages<{
        id: string;
        code: string | null;
        boutique_id: string | null;
        created_at: string;
      }>((from, to) =>
        supabase
          .from('clients')
          .select('id, code, boutique_id, created_at')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );

      const usedCodes = new Set<string>();
      const boutiqueClients: typeof allTenantClients = [];
      let maxSeqForPrefix = 0;

      const isConforming = (rawCode: string | null | undefined): boolean => {
        if (!rawCode) return false;
        const parsed = parseClientCodeInfo(rawCode);
        if (!parsed || parsed.pointCode !== cleanPrefix) return false;
        return formatClientCode(parsed.seq, cleanPrefix) === rawCode;
      };

      for (const row of allTenantClients) {
        const parsed = parseClientCodeInfo(row.code);
        if (parsed && parsed.pointCode === cleanPrefix && parsed.seq > maxSeqForPrefix) {
          maxSeqForPrefix = parsed.seq;
        }
        const belongsToTarget = targetBoutiqueId ? row.boutique_id === targetBoutiqueId : true;
        if (belongsToTarget) {
          boutiqueClients.push(row);
        } else if (row.code?.trim()) {
          usedCodes.add(row.code.trim().toUpperCase());
        }
      }

      const conforming: typeof allTenantClients = [];
      const toRename: typeof allTenantClients = [];

      for (const row of boutiqueClients) {
        if (isConforming(row.code)) {
          conforming.push(row);
          if (row.code) usedCodes.add(row.code.toUpperCase());
        } else {
          toRename.push(row);
        }
      }

      if (toRename.length === 0) {
        return {
          updated: 0,
          alreadyCompliant: conforming.length,
          total: boutiqueClients.length,
          error: null,
        };
      }

      let nextSeq = maxSeqForPrefix + 1;
      const plan: Array<{ id: string; oldCode: string; newCode: string }> = [];

      for (const row of toRename) {
        const raw = (row.code ?? '').trim().toUpperCase();
        const trailingMatch = raw.match(/(\d+)$/);
        const extractedSeq = trailingMatch ? parseInt(trailingMatch[1], 10) : NaN;
        let candidate: string | null = null;

        if (Number.isFinite(extractedSeq) && extractedSeq > 0 && extractedSeq < 10_000_000) {
          const tryCode = formatClientCode(extractedSeq, cleanPrefix);
          if (!usedCodes.has(tryCode)) {
            candidate = tryCode;
          }
        }

        if (!candidate) {
          while (usedCodes.has(formatClientCode(nextSeq, cleanPrefix))) {
            nextSeq++;
          }
          candidate = formatClientCode(nextSeq, cleanPrefix);
          nextSeq++;
        }

        usedCodes.add(candidate);
        plan.push({ id: row.id, oldCode: raw, newCode: candidate });
      }

      // Phase 1: Temporarily rename only rows whose old code is needed as another row's new code
      const plannedNewCodes = new Set(plan.map((p) => p.newCode));
      const collidingRows = plan.filter((p) => p.oldCode && plannedNewCodes.has(p.oldCode));
      const CONCURRENCY = 25;

      for (let i = 0; i < collidingRows.length; i += CONCURRENCY) {
        const slice = collidingRows.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          slice.map((item) =>
            supabase
              .from('clients')
              .update({ code: `TMP-${item.id.slice(0, 8)}` })
              .eq('id', item.id),
          ),
        );
        const firstErr = results.find((r) => r.error)?.error;
        if (firstErr) {
          return {
            updated: 0,
            alreadyCompliant: conforming.length,
            total: boutiqueClients.length,
            error: firstErr.message,
          };
        }
      }

      // Phase 2: Write final normalized codes in parallel batches
      let done = 0;
      onProgress?.(0, plan.length);
      for (let i = 0; i < plan.length; i += CONCURRENCY) {
        const slice = plan.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          slice.map((item) =>
            supabase.from('clients').update({ code: item.newCode }).eq('id', item.id),
          ),
        );
        const firstErr = results.find((r) => r.error)?.error;
        if (firstErr) {
          notifyRealtimeMutation('clients');
          return {
            updated: done,
            alreadyCompliant: conforming.length,
            total: boutiqueClients.length,
            error: firstErr.message,
          };
        }
        done += slice.length;
        onProgress?.(done, plan.length);
      }

      observeClientCodes(
        plan.map((p) => ({ code: p.newCode })),
        targetBoutiqueId,
      );
      notifyRealtimeMutation('clients');
      await db.getAllClients();

      return {
        updated: plan.length,
        alreadyCompliant: conforming.length,
        total: boutiqueClients.length,
        error: null,
      };
    } catch (err) {
      return {
        updated: 0,
        alreadyCompliant: 0,
        total: 0,
        error:
          err instanceof Error
            ? err.message
            : 'Erreur lors de la mise en conformité des codes clients',
      };
    }
  },

  // Types traitement
  async getTypesTraitement(): Promise<TypeTraitement[]> {
    const cacheKey = bKey('types_traitement', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase.from('types_traitement').select('*').order('coefficient');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
        ...row,
        coefficient: Number(row.coefficient),
        nb_jours: Number(row.nb_jours),
      })) as TypeTraitement[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      observeTraitementCodes(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async insertTypeTraitement(row: { code: string; libelle: string; coefficient: number; nb_jours: number }): Promise<string | null> {
    const result = await insert({ table: 'types_traitement', rows: row });
    return result.error;
  },

  async updateTypeTraitement(id: string, values: { libelle: string; coefficient: number; nb_jours: number }): Promise<string | null> {
    const result = await update({ table: 'types_traitement', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteTypeTraitement(id: string): Promise<string | null> {
    const result = await remove({ table: 'types_traitement', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  // Modes de règlement
  async getModesReglement(): Promise<ModeReglementRow[]> {
    const cacheKey = bKey('modes_reglement', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase.from('modes_reglement').select('*').order('designation');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        taux_remise: r.taux_remise != null ? Number(r.taux_remise) : 0,
      })) as ModeReglementRow[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      return mapped;
    }, []);
  },

  async insertModeReglement(row: { designation: string; taux_remise?: number }): Promise<string | null> {
    const result = await insert({ table: 'modes_reglement', rows: row });
    return result.error;
  },

  async updateModeReglement(id: number, values: { designation?: string; taux_remise?: number }): Promise<string | null> {
    const result = await update({ table: 'modes_reglement', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteModeReglement(id: number): Promise<string | null> {
    const result = await remove({ table: 'modes_reglement', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  // Articles
  async getArticles(): Promise<ArticleCatalog[]> {
    const cacheKey = bKey('articles', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase.from('articles').select('*').order('designation');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        prix_unitaire: Number(r.prix_unitaire),
        nb_pieces: Number(r.nb_pieces),
      })) as ArticleCatalog[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      observeArticleCodes(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async insertArticle(row: { code: string; designation: string; prix_unitaire: number; nb_pieces: number }): Promise<string | null> {
    const result = await insert<ArticleCatalog>({ table: 'articles', rows: row, select: '*' });
    if (result.data) {
      observeArticleCodes([result.data], currentBoutiqueId);
      optimisticUpsertArticle(result.data, currentBoutiqueId);
    }
    return result.error;
  },

  async insertArticleReturning(row: { code: string; designation: string; prix_unitaire: number; nb_pieces: number }): Promise<{ data: ArticleCatalog | null; error: string | null }> {
    const result = await insert<ArticleCatalog>({ table: 'articles', rows: row, select: '*' });
    if (result.data) {
      observeArticleCodes([result.data], currentBoutiqueId);
      optimisticUpsertArticle(result.data, currentBoutiqueId);
    }
    return { data: result.data ?? null, error: result.error };
  },

  async updateArticle(id: string, values: { designation: string; prix_unitaire: number; nb_pieces: number }): Promise<string | null> {
    const result = await update({ table: 'articles', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteArticle(id: string): Promise<string | null> {
    const result = await remove({ table: 'articles', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  // Article variants
  async getVariantsByArticle(articleId: string): Promise<ArticleVariant[]> {
    const fallbackFromCache = () => {
      const all = getScopedCached<ArticleVariant[]>('all_variants', currentBoutiqueId) ?? [];
      return all.filter((v) => v.article_id === articleId);
    };
    if (isOffline()) return fallbackFromCache();
    let q = supabase
      .from('article_variants')
      .select('*')
      .eq('article_id', articleId)
      .order('created_at');
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? fallbackFromCache() : [];
    return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
      ...r,
      prix_traitement: Number(r.prix_traitement),
    })) as ArticleVariant[];
  },

  async getAllVariants(): Promise<ArticleVariant[]> {
    const cacheKey = bKey('all_variants', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase
        .from('article_variants')
        .select('*')
        .order('designation');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        prix_traitement: Number(r.prix_traitement),
      })) as ArticleVariant[];
    }, []);
  },

  async insertVariant(row: { article_id: string; designation: string; prix_traitement: number }): Promise<string | null> {
    const result = await insert({ table: 'article_variants', rows: row });
    return result.error;
  },

  async updateVariant(id: string, values: { designation: string; prix_traitement: number }): Promise<string | null> {
    const result = await update({ table: 'article_variants', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteVariant(id: string): Promise<string | null> {
    const result = await remove({ table: 'article_variants', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  // Depots
  async getDepotsWithClient(): Promise<DepotWithClient[]> {
    const cacheKey = bKey('recent_depots', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase
        .from('depots')
        .select('*, clients!inner(nom, telephone, portal_code)')
        .order('created_at', { ascending: false })
        .limit(8);
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        total: Number(r.total),
        avance_amount: r.avance_amount != null ? Number(r.avance_amount) : null,
        coefficient: Number(r.coefficient),
        taux_remise: r.taux_remise != null ? Number(r.taux_remise) : null,
        montant_remise: r.montant_remise != null ? Number(r.montant_remise) : null,
      })) as DepotWithClient[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      observeDepotNumeros(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getDepotsForRetrait(): Promise<DepotWithArticles[]> {
    const cacheKey = bKey('depots_retrait', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase
        .from('depots')
        .select('*, clients(nom, telephone, portal_code), depot_articles(*)')
        .eq('statut', 'EN_COURS')
        .order('created_at', { ascending: false })
        .limit(100);
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) {
        console.error('[getDepotsForRetrait]', error.message);
        throw new Error(error.message);
      }
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((depot) => ({
        ...depot,
        total: Number(depot.total),
        avance_amount: depot.avance_amount != null ? Number(depot.avance_amount) : null,
        coefficient: Number(depot.coefficient),
        taux_remise: depot.taux_remise != null ? Number(depot.taux_remise) : null,
        montant_remise: depot.montant_remise != null ? Number(depot.montant_remise) : null,
        articles: ((depot.depot_articles as Record<string, unknown>[]) ?? []).map((a) => ({
          ...a,
          prix_unitaire: Number(a.prix_unitaire),
          prix_traitement: Number(a.prix_traitement),
          quantite: Number(a.quantite),
          nb_pieces: Number(a.nb_pieces),
          prix_total: Number(a.prix_total),
        })),
        client: depot.clients ?? null,
      })) as DepotWithArticles[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      observeDepotNumeros(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getDepotsForPlanning(): Promise<DepotWithClient[]> {
    const boutiqueAtStart = currentBoutiqueId;
    const cacheKey = bKey('depots_planning', boutiqueAtStart);
    return cachedRead(cacheKey, async () => {
      const data = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from('depots')
          .select('*, clients!inner(nom, telephone, portal_code)')
          .order('date_retrait_prevue', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (boutiqueAtStart) q = q.eq('boutique_id', boutiqueAtStart);
        return q;
      });
      const mapped = data.map((r) => ({
        ...r,
        total: Number(r.total),
        avance_amount: r.avance_amount != null ? Number(r.avance_amount) : null,
        coefficient: Number(r.coefficient),
        taux_remise: r.taux_remise != null ? Number(r.taux_remise) : null,
        montant_remise: r.montant_remise != null ? Number(r.montant_remise) : null,
      })) as DepotWithClient[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      observeDepotNumeros(mapped, boutiqueAtStart);
      return mapped;
    }, []);
  },

  async getAllDepotsWithClient(): Promise<DepotWithArticles[]> {
    const boutiqueAtStart = currentBoutiqueId;
    const cacheKey = bKey('all_depots', boutiqueAtStart);
    return cachedRead(cacheKey, async () => {
      const data = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from('depots')
          .select('*, clients!inner(nom, telephone, portal_code), depot_articles(*)')
          .order('date_depot', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (boutiqueAtStart) q = q.eq('boutique_id', boutiqueAtStart);
        return q;
      });
      const mapped = data.map((depot) => ({
        ...depot,
        total: Number(depot.total),
        avance_amount: depot.avance_amount != null ? Number(depot.avance_amount) : null,
        coefficient: Number(depot.coefficient),
        taux_remise: depot.taux_remise != null ? Number(depot.taux_remise) : null,
        montant_remise: depot.montant_remise != null ? Number(depot.montant_remise) : null,
        commercial_id: (depot.commercial_id as string | null) ?? null,
        commission_taux: depot.commission_taux != null ? Number(depot.commission_taux) : null,
        commission_montant: depot.commission_montant != null ? Number(depot.commission_montant) : null,
        articles: ((depot.depot_articles as Record<string, unknown>[]) ?? []).map((a) => ({
          ...a,
          prix_unitaire: Number(a.prix_unitaire),
          prix_traitement: Number(a.prix_traitement),
          quantite: Number(a.quantite),
          nb_pieces: Number(a.nb_pieces),
          prix_total: Number(a.prix_total),
        })),
        client: depot.clients ?? null,
      })) as DepotWithArticles[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      observeDepotNumeros(mapped, boutiqueAtStart);
      return mapped;
    }, []);
  },

  async getDepotsForReleve(clientId: string): Promise<DepotWithArticles[]> {
    const fromCache = async () => {
      const all =
        (await getCachedWithScopeFallbackAsync<DepotWithArticles[]>(bKey('all_depots', currentBoutiqueId))) ?? [];
      return all
        .filter((d) => d.client_id === clientId)
        .sort((a, b) => a.date_depot.localeCompare(b.date_depot));
    };
    if (isOffline()) return fromCache();
    let q = supabase
      .from('depots')
      .select('*, clients!inner(nom, telephone, portal_code), depot_articles(*)')
      .eq('client_id', clientId)
      .order('date_depot', { ascending: true });
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? fromCache() : [];
    return ((data as Record<string, unknown>[]) ?? []).map((depot) => ({
      ...depot,
      total: Number(depot.total),
      avance_amount: depot.avance_amount != null ? Number(depot.avance_amount) : null,
      coefficient: Number(depot.coefficient),
      taux_remise: depot.taux_remise != null ? Number(depot.taux_remise) : null,
      montant_remise: depot.montant_remise != null ? Number(depot.montant_remise) : null,
      articles: ((depot.depot_articles as Record<string, unknown>[]) ?? []).map((a) => ({
        ...a,
        prix_unitaire: Number(a.prix_unitaire),
        prix_traitement: Number(a.prix_traitement),
        quantite: Number(a.quantite),
        nb_pieces: Number(a.nb_pieces),
        prix_total: Number(a.prix_total),
      })),
      client: depot.clients ?? null,
    })) as DepotWithArticles[];
  },

  async insertDepot(row: Record<string, unknown>): Promise<{ data: Depot | null; error: string | null }> {
    const result = await insert<Depot>({ table: 'depots', rows: row, select: '*' });
    if (result.data) {
      const d = result.data as unknown as Record<string, unknown>;
      const depot = {
        ...d,
        total: Number(d.total ?? 0),
        avance_amount: d.avance_amount != null ? Number(d.avance_amount) : null,
        coefficient: Number(d.coefficient ?? 1),
        taux_remise: d.taux_remise != null ? Number(d.taux_remise) : null,
        montant_remise: d.montant_remise != null ? Number(d.montant_remise) : null,
        commercial_id: (d.commercial_id as string | null) ?? null,
        commission_taux: d.commission_taux != null ? Number(d.commission_taux) : null,
        commission_montant: d.commission_montant != null ? Number(d.commission_montant) : null,
      } as unknown as Depot;
      observeDepotNumeros([depot], currentBoutiqueId);
      optimisticInsertDepot(depot, currentBoutiqueId);
      return { data: depot, error: null };
    }
    return { data: null, error: result.error };
  },

  async insertDepotArticles(rows: Record<string, unknown>[]): Promise<string | null> {
    const result = await insert<Record<string, unknown>[]>({ table: 'depot_articles', rows });
    if (!result.error) {
      const insertedRows = Array.isArray(result.data) ? result.data : rows;
      optimisticAttachDepotArticles(insertedRows, currentBoutiqueId);
    }
    return result.error;
  },

  async updateDepot(id: string, values: Record<string, unknown>): Promise<string | null> {
    const result = await update({ table: 'depots', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticPatchDepot(id, values, currentBoutiqueId);
    return result.error;
  },

  async deleteDepot(id: string): Promise<string | null> {
    const result = await remove({ table: 'depots', filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticRemoveDepot(id, currentBoutiqueId);
    return result.error;
  },

  async updateDepotArticle(id: string, values: Record<string, unknown>): Promise<string | null> {
    const result = await update({ table: 'depot_articles', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticPatchDepotArticle(id, values, currentBoutiqueId);
    return result.error;
  },

  async getDepotById(id: string): Promise<DepotWithArticles | null> {
    const fromCache = () => {
      const all = getScopedCached<DepotWithArticles[]>('all_depots', currentBoutiqueId) ?? [];
      const retrait = getScopedCached<DepotWithArticles[]>('depots_retrait', currentBoutiqueId) ?? [];
      return all.find((d) => d.id === id) ?? retrait.find((d) => d.id === id) ?? null;
    };
    if (isOffline()) return fromCache();
    const { data, error } = await supabase
      .from('depots')
      .select('*, clients(nom, telephone, portal_code), depot_articles(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) return isLikelyNetworkError(error) ? fromCache() : null;
    if (!data) return null;
    const d = data as Record<string, unknown>;
    return {
      ...d,
      total: Number(d.total),
      avance_amount: d.avance_amount != null ? Number(d.avance_amount) : null,
      coefficient: Number(d.coefficient),
      taux_remise: d.taux_remise != null ? Number(d.taux_remise) : null,
      montant_remise: d.montant_remise != null ? Number(d.montant_remise) : null,
      articles: ((d.depot_articles as Record<string, unknown>[]) ?? []).map((a) => ({
        ...a,
        prix_unitaire: Number(a.prix_unitaire),
        prix_traitement: Number(a.prix_traitement),
        quantite: Number(a.quantite),
        nb_pieces: Number(a.nb_pieces),
        prix_total: Number(a.prix_total),
      })) as DepotArticle[],
      client: (d.clients ?? null) as { nom: string; telephone: string } | null,
    } as DepotWithArticles;
  },

  // Dashboard stats
  async getDashboardStats(): Promise<{ enCours: number; retires: number; totalJour: number; caJour: number; recettePrevuJour: number }> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey('dashboard_stats', bid), async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();
      const tomorrowISO = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

      let qEnCours = supabase.from('depots').select('*', { count: 'exact', head: true }).eq('statut', 'EN_COURS');
      let qRetires = supabase.from('depots').select('*', { count: 'exact', head: true }).eq('statut', 'RETIRE');
      let qToday = supabase.from('depots').select('total').gte('date_depot', todayISO);
      let qRetraitToday = supabase
        .from('depots')
        .select('total')
        .gte('date_retrait_prevue', todayISO)
        .lt('date_retrait_prevue', tomorrowISO);

      if (bid) {
        qEnCours = qEnCours.eq('boutique_id', bid);
        qRetires = qRetires.eq('boutique_id', bid);
        qToday = qToday.eq('boutique_id', bid);
        qRetraitToday = qRetraitToday.eq('boutique_id', bid);
      }

      const [enCoursRes, retiresRes, todayRes, retraitTodayRes] = await Promise.all([
        qEnCours,
        qRetires,
        qToday,
        qRetraitToday,
      ]);
      throwIfNetworkError(enCoursRes.error || retiresRes.error || todayRes.error || retraitTodayRes.error);

      const todayDeposits = (todayRes.data ?? []) as { total: number }[];
      const retraitTodayDeposits = (retraitTodayRes.data ?? []) as { total: number }[];
      return {
        enCours: enCoursRes.count ?? 0,
        retires: retiresRes.count ?? 0,
        totalJour: todayDeposits.length,
        caJour: todayDeposits.reduce((sum, d) => sum + Number(d.total), 0),
        recettePrevuJour: retraitTodayDeposits.reduce((sum, d) => sum + Number(d.total), 0),
      };
    }, { enCours: 0, retires: 0, totalJour: 0, caJour: 0, recettePrevuJour: 0 });
  },

  // Entreprise (per-user, one row per authenticated user)
  async getCurrentMemberName(): Promise<string | null> {
    let activeUser = readOfflineSessionBackup()?.user ?? null;
    if (!activeUser && !isOffline()) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        activeUser = session?.user ?? null;
      } catch {
        // Offline fallback
      }
    }
    if (!activeUser) return null;
    const cacheKey = `offline_member_name_${activeUser.id}`;
    const fallback = () => {
      try {
        const stored = localStorage.getItem(cacheKey);
        if (stored) return stored;
      } catch {
        // Ignore
      }
      return activeUser?.user_metadata?.full_name || activeUser?.email || null;
    };
    if (isOffline()) return fallback();
    const tId = await getTenantId();
    if (!tId) return fallback();
    try {
      const { data, error } = await supabase
        .from('entreprise_members')
        .select('full_name')
        .eq('tenant_id', tId)
        .eq('user_id', activeUser.id)
        .maybeSingle();
      if (error && isLikelyNetworkError(error)) return fallback();
      const resolved = data?.full_name || activeUser.user_metadata?.full_name || activeUser.email || null;
      if (resolved) {
        try { localStorage.setItem(cacheKey, resolved); } catch { /* ignore */ }
      }
      return resolved;
    } catch {
      return fallback();
    }
  },

  async getEntreprise(): Promise<Entreprise | null> {
    const ent = await cachedRead<Entreprise | null>('entreprise', async () => {
      const tenantId = await getTenantId();
      let data: Record<string, unknown> | null = null;
      if (tenantId) {
        const res = await supabase.from('entreprise').select('*').eq('user_id', tenantId).maybeSingle();
        throwIfNetworkError(res.error);
        if (res.error) return null;
        data = res.data as Record<string, unknown> | null;
      } else {
        const res = await supabase.from('entreprise').select('*').maybeSingle();
        throwIfNetworkError(res.error);
        if (res.error) return null;
        data = res.data as Record<string, unknown> | null;
      }
      if (!data) return null;
      return data as unknown as Entreprise;
    }, null);
    if (ent && ('depot_start_number' in ent || 'depot_start_year' in ent)) {
      syncCompanyDepotStartSeqFromEntreprise(ent.depot_start_number, ent.depot_start_year);
    }
    return ent;
  },

  async upsertEntreprise(row: Record<string, unknown>, userId?: string): Promise<string | null> {
    if (!userId) {
      userId = readOfflineSessionBackup()?.user?.id;
      if (!userId && !isOffline()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          userId = session?.user?.id;
        } catch {
          // Ignore
        }
      }
    }
    if (!userId) return 'Non authentifié';
    let payload: Record<string, unknown> = { ...row, user_id: userId };
    delete payload.id;
    if (isOffline()) {
      enqueueMutation('entreprise', 'upsert', payload, undefined, 'Mise à jour entreprise');
      setCached('entreprise', payload);
      return null;
    }
    let { error } = await supabase.from('entreprise').upsert(payload, { onConflict: 'user_id' });
    for (let retry = 0; retry < 3 && error; retry++) {
      const missingCol = extractMissingSchemaColumn(error.message);
      if (!missingCol || !(missingCol in payload)) break;
      payload = stripColumnFromRow(payload, missingCol);
      ({ error } = await supabase.from('entreprise').upsert(payload, { onConflict: 'user_id' }));
    }
    if (error && isLikelyNetworkError(error)) {
      enqueueMutation('entreprise', 'upsert', payload, undefined, 'Mise à jour entreprise');
      setCached('entreprise', payload);
      return null;
    }
    if (!error) {
      notifyRealtimeMutation('entreprise', true);
    }
    return error?.message ?? null;
  },

  // Counters
  async incrementDepotCounter(): Promise<{ value: number | null; error: string | null }> {
    const { data, error } = await supabase.rpc('increment_depot_counter');
    if (error) return { value: null, error: error.message };
    return { value: (data as number) ?? null, error: null };
  },

  async nextClientCode(): Promise<{ code: string | null; error: string | null }> {
    const pointCode = getBillingPointCode();
    if (isOffline()) {
      return {
        code: generateOfflineClientCode(currentBoutiqueId, pointCode),
        error: null,
      };
    }
    try {
      // Paginate across the entire tenant (clients_code_tenant_idx is tenant-scoped across all boutiques)
      const rows = await fetchAllPages<{ code?: string | null }>((from, to) =>
        supabase
          .from('clients')
          .select('code')
          .order('id', { ascending: true })
          .range(from, to),
      );
      observeClientCodes(rows, currentBoutiqueId);
      const code = computeNextOnlineClientCode(rows, pointCode);
      return { code, error: null };
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        return {
          code: generateOfflineClientCode(currentBoutiqueId, pointCode),
          error: null,
        };
      }
      return {
        code: generateOfflineClientCode(currentBoutiqueId, pointCode),
        error: null,
      };
    }
  },

  getDepotStartNumber(dateDepot?: Date): number | null {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    return getDepotStartSeq(currentBoutiqueId, targetYear, getBillingPointCode());
  },

  getBoutiqueDepotStartNumber(boutiqueId: string, dateDepot?: Date): number | null {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    const direct = getBoutiqueDepotStartSeq(boutiqueId, targetYear);
    if (direct !== null) return direct;
    return getDepotStartSeq(boutiqueId, targetYear, getBillingPointCode());
  },

  getCompanyEnforcedDepotStartNumber(dateDepot?: Date): number | null {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    return getCompanyDepotStartSeq(targetYear);
  },

  setDepotStartNumber(startSeq: number | null, dateDepot?: Date): number | null {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    return setDepotStartSeq(currentBoutiqueId, targetYear, getBillingPointCode(), startSeq);
  },

  /**
   * Saves and enforces a starting deposit counter specifically for one boutique
   * (persisted on `boutiques` AND cached locally so all devices and offline sessions
   * for that boutique honor it immediately without affecting other boutiques).
   */
  async saveBoutiqueDepotStartNumber(
    boutiqueId: string,
    startSeq: number | null,
    dateDepot?: Date,
  ): Promise<{ saved: number | null; error: string | null }> {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    const normalized =
      startSeq !== null && Number.isFinite(startSeq) && startSeq >= 1
        ? Math.max(1, Math.floor(startSeq))
        : null;

    setBoutiqueDepotStartSeq(boutiqueId, normalized, targetYear);

    const isDefaultBoutique = boutiqueId === getDefaultBoutiqueId();
    if (isDefaultBoutique && normalized === null) {
      setCompanyDepotStartSeq(null, targetYear);
    }

    const updateValues = {
      depot_start_number: normalized,
      depot_start_year: normalized !== null ? targetYear : null,
      updated_at: new Date().toISOString(),
    };

    // Update cached boutiques list optimistically
    const cachedBoutiques = getCached<Boutique[]>('boutiques');
    if (cachedBoutiques) {
      setCached(
        'boutiques',
        cachedBoutiques.map((b) =>
          b.id === boutiqueId ? { ...b, ...updateValues } : b,
        ),
      );
    }

    // If clearing default boutique counter, also clear legacy entreprise counter best-effort
    if (isDefaultBoutique && normalized === null) {
      const tenantId = await getTenantId();
      const cachedEnt = getCached<Entreprise | null>('entreprise');
      if (cachedEnt) {
        setCached('entreprise', { ...cachedEnt, ...updateValues });
      }
      if (tenantId && !isOffline()) {
        try {
          await supabase.from('entreprise').update(updateValues).eq('user_id', tenantId);
        } catch {
          // Best-effort legacy sync
        }
      }
    }

    if (isOffline()) {
      enqueueMutation(
        'boutiques',
        'update',
        updateValues,
        [{ column: 'id', operator: 'eq', value: boutiqueId }],
        normalized !== null
          ? `Compteur dépôt boutique : ${normalized}`
          : 'Compteur dépôt boutique automatique',
      );
      return { saved: normalized, error: null };
    }

    try {
      const { error } = await supabase
        .from('boutiques')
        .update(updateValues)
        .eq('id', boutiqueId);
      if (error) {
        if (extractMissingSchemaColumn(error.message)) {
          // Column not yet migrated in remote DB: local per-boutique enforcement still active
          return { saved: normalized, error: null };
        }
        if (isLikelyNetworkError(error)) {
          enqueueMutation(
            'boutiques',
            'update',
            updateValues,
            [{ column: 'id', operator: 'eq', value: boutiqueId }],
            normalized !== null
              ? `Compteur dépôt boutique : ${normalized}`
              : 'Compteur dépôt boutique automatique',
          );
          return { saved: normalized, error: null };
        }
        return { saved: normalized, error: error.message };
      }
      notifyRealtimeMutation('boutiques', true);
      return { saved: normalized, error: null };
    } catch {
      return { saved: normalized, error: null };
    }
  },

  /**
   * Enforces a starting deposit counter for the active boutique (or company-wide fallback
   * when no boutique is selected), persisted remotely AND cached locally.
   */
  async saveEnforcedDepotStartNumber(
    startSeq: number | null,
    dateDepot?: Date,
  ): Promise<{ saved: number | null; error: string | null }> {
    if (currentBoutiqueId) {
      return this.saveBoutiqueDepotStartNumber(currentBoutiqueId, startSeq, dateDepot);
    }

    const targetYear = (dateDepot ?? new Date()).getFullYear();
    const normalized =
      startSeq !== null && Number.isFinite(startSeq) && startSeq >= 1
        ? Math.max(1, Math.floor(startSeq))
        : null;

    setCompanyDepotStartSeq(normalized, targetYear);
    setDepotStartSeq(currentBoutiqueId, targetYear, getBillingPointCode(), normalized);

    const tenantId = await getTenantId();
    if (!tenantId) {
      return { saved: normalized, error: null };
    }

    const updateValues = {
      depot_start_number: normalized,
      depot_start_year: normalized !== null ? targetYear : null,
      updated_at: new Date().toISOString(),
    };

    // Update local entreprise cache optimistically
    const cachedEnt = getCached<Entreprise | null>('entreprise');
    if (cachedEnt) {
      setCached('entreprise', { ...cachedEnt, ...updateValues });
    }

    if (isOffline()) {
      enqueueMutation(
        'entreprise',
        'update',
        updateValues,
        [{ column: 'user_id', operator: 'eq', value: tenantId }],
        normalized !== null ? `Compteur dépôt départ: ${normalized}` : 'Compteur dépôt automatique',
      );
      return { saved: normalized, error: null };
    }

    try {
      const { error } = await supabase
        .from('entreprise')
        .update(updateValues)
        .eq('user_id', tenantId);
      if (error) {
        if (extractMissingSchemaColumn(error.message)) {
          // Column not yet migrated in remote DB: local enforcement still active
          return { saved: normalized, error: null };
        }
        if (isLikelyNetworkError(error)) {
          enqueueMutation(
            'entreprise',
            'update',
            updateValues,
            [{ column: 'user_id', operator: 'eq', value: tenantId }],
            normalized !== null ? `Compteur dépôt départ: ${normalized}` : 'Compteur dépôt automatique',
          );
          return { saved: normalized, error: null };
        }
        return { saved: normalized, error: error.message };
      }
      notifyRealtimeMutation('entreprise', true);
      return { saved: normalized, error: null };
    } catch {
      return { saved: normalized, error: null };
    }
  },

  async previewNextDepotNumero(dateDepot?: Date): Promise<string> {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    const pointCode = getBillingPointCode();
    const bid = currentBoutiqueId;
    if (isOffline()) {
      return previewOfflineDepotNumero(bid, targetYear, pointCode);
    }
    try {
      const pattern = pointCode ? `${pointCode}-D%-${targetYear}` : `D%-${targetYear}`;
      const rows = await fetchAllPages<{ numero?: string | null }>((from, to) => {
        let q = supabase.from('depots').select('numero').order('id', { ascending: true }).range(from, to);
        if (targetYear <= 2026) {
          q = q.or(`numero.like.${pattern},numero.like.D-%`);
        } else {
          q = q.like('numero', pattern);
        }
        if (bid) {
          q = q.eq('boutique_id', bid);
        }
        return q;
      });
      return previewOnlineDepotNumero(rows, bid, targetYear, pointCode);
    } catch {
      return previewOfflineDepotNumero(bid, targetYear, pointCode);
    }
  },

  async nextDepotNumero(dateDepot?: Date): Promise<{ numero: string | null; error: string | null }> {
    const targetYear = (dateDepot ?? new Date()).getFullYear();
    const pointCode = getBillingPointCode();
    const bid = currentBoutiqueId;

    if (isOffline()) {
      return {
        numero: generateOfflineDepotNumero(bid, targetYear, pointCode),
        error: null,
      };
    }

    try {
      const pattern = pointCode ? `${pointCode}-D%-${targetYear}` : `D%-${targetYear}`;
      const rows = await fetchAllPages<{ numero?: string | null }>((from, to) => {
        let q = supabase.from('depots').select('numero').order('id', { ascending: true }).range(from, to);
        if (targetYear <= 2026) {
          q = q.or(`numero.like.${pattern},numero.like.D-%`);
        } else {
          q = q.like('numero', pattern);
        }
        if (bid) {
          q = q.eq('boutique_id', bid);
        }
        return q;
      });
      const numero = computeNextOnlineDepotNumero(rows, bid, targetYear, pointCode);
      return { numero, error: null };
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        return {
          numero: generateOfflineDepotNumero(bid, targetYear, pointCode),
          error: null,
        };
      }
      return {
        numero: generateOfflineDepotNumero(bid, targetYear, pointCode),
        error: null,
      };
    }
  },

  // Depot avances (multiple partial payments)
  async getAvancesForDepot(depotId: string): Promise<DepotAvance[]> {
    const fromCache = () => {
      const all = getScopedCached<DepotAvance[]>('all_avances', currentBoutiqueId) ?? [];
      return all
        .filter((a) => a.depot_id === depotId)
        .sort((a, b) => a.date_paiement.localeCompare(b.date_paiement));
    };
    if (isOffline()) return fromCache();
    let q = supabase
      .from('depot_avances')
      .select('*')
      .eq('depot_id', depotId)
      .order('date_paiement', { ascending: true });
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? fromCache() : [];
    return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
      ...r,
      montant: Number(r.montant),
    })) as DepotAvance[];
  },

  async insertAvance(depotId: string, montant: number, modeReglement?: string, datePaiement?: string): Promise<{ data: DepotAvance | null; error: string | null }> {
    const row: Record<string, unknown> = { depot_id: depotId, montant, mode_reglement: modeReglement ?? null };
    if (datePaiement) row.date_paiement = datePaiement;
    const result = await insert<DepotAvance>({
      table: 'depot_avances',
      rows: row,
      select: '*',
    });
    if (result.data) {
      const d = result.data as unknown as Record<string, unknown>;
      const avance = { ...d, montant: Number(d.montant) } as unknown as DepotAvance;
      optimisticInsertAvance(avance, currentBoutiqueId);
      return { data: avance, error: null };
    }
    return { data: null, error: result.error };
  },

  async getTotalAvances(depotId: string): Promise<number> {
    const fromCache = () => {
      const all = getScopedCached<DepotAvance[]>('all_avances', currentBoutiqueId) ?? [];
      return all.filter((a) => a.depot_id === depotId).reduce((sum, a) => sum + Number(a.montant), 0);
    };
    if (isOffline()) return fromCache();
    let q = supabase
      .from('depot_avances')
      .select('montant')
      .eq('depot_id', depotId);
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? fromCache() : 0;
    return (data as { montant: number }[])?.reduce((sum, a) => sum + Number(a.montant), 0) ?? 0;
  },

  async getAllAvances(): Promise<DepotAvance[]> {
    const bid = currentBoutiqueId;
    const cacheKey = bKey('all_avances', bid);
    return cachedRead(cacheKey, async () => {
      const data = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from('depot_avances')
          .select('*')
          .order('date_paiement', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      const mapped = data.map((r) => ({
        ...r,
        montant: Number(r.montant),
      })) as DepotAvance[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      return mapped;
    }, []);
  },

  // Depenses
  async getAllDepenses(): Promise<Depense[]> {
    const bid = currentBoutiqueId;
    const cacheKey = bKey('depenses', bid);
    return cachedRead(cacheKey, async () => {
      const data = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from('depenses')
          .select('*')
          .order('date_depense', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      const mapped = data.map((r) => ({
        ...r,
        montant: Number(r.montant),
      })) as Depense[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      return mapped;
    }, []);
  },

  async insertDepense(row: { date_depense: string; libelle: string; categorie: string | null; compte_syscohada?: string | null; montant: number; mode_reglement: string | null; notes: string | null }): Promise<{ data: Depense | null; error: string | null }> {
    const result = await insert<Depense>({ table: 'depenses', rows: row, select: '*' });
    if (result.data) {
      const d = result.data as unknown as Record<string, unknown>;
      const depense = { ...d, montant: Number(d.montant) } as unknown as Depense;
      optimisticInsertDepense(depense, currentBoutiqueId);
      return { data: depense, error: null };
    }
    return { data: null, error: result.error };
  },

  async updateDepense(id: string, values: { date_depense: string; libelle: string; categorie: string | null; compte_syscohada?: string | null; montant: number; mode_reglement: string | null; notes: string | null }): Promise<string | null> {
    const result = await update({ table: 'depenses', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticPatchDepense(id, values, currentBoutiqueId);
    return result.error;
  },

  async deleteDepense(id: string): Promise<string | null> {
    const result = await remove({ table: 'depenses', filters: [{ column: 'id', operator: 'eq', value: id }] });
    if (!result.error) optimisticRemoveDepense(id, currentBoutiqueId);
    return result.error;
  },

  // Depense categories
  async getAllDepenseCategories(): Promise<DepenseCategory[]> {
    const cacheKey = bKey('depense_categories', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase
        .from('depense_categories')
        .select('*')
        .order('libelle');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      return (data as DepenseCategory[]) ?? [];
    }, []);
  },

  async insertDepenseCategory(libelle: string, compte_syscohada?: string | null): Promise<{ data: DepenseCategory | null; error: string | null }> {
    const row: Record<string, unknown> = { libelle };
    if (compte_syscohada !== undefined) row.compte_syscohada = compte_syscohada || null;
    const result = await insert<DepenseCategory>({ table: 'depense_categories', rows: row, select: '*' });
    return { data: result.data, error: result.error };
  },

  async updateDepenseCategory(id: string, libelle: string, compte_syscohada?: string | null): Promise<string | null> {
    const values: Record<string, unknown> = { libelle };
    if (compte_syscohada !== undefined) values.compte_syscohada = compte_syscohada || null;
    const result = await update({ table: 'depense_categories', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteDepenseCategory(id: string): Promise<string | null> {
    const result = await remove({ table: 'depense_categories', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async getDistinctFieldValues(field: 'couleur' | 'signe_particulier' | 'griffe'): Promise<string[]> {
    return cachedRead(bKey(`distinct_${field}`, currentBoutiqueId), async () => {
      let q = supabase
        .from('depot_articles')
        .select(field)
        .not(field, 'is', null)
        .neq(field, '')
        .order(field);
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) throw new Error(error?.message ?? 'Erreur lecture');
      const seen = new Set<string>();
      const result: string[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const val = String(row[field] ?? '').trim();
        if (val && !seen.has(val.toLowerCase())) {
          seen.add(val.toLowerCase());
          result.push(val);
        }
      }
      return result;
    }, []);
  },

  // Boutiques
  async getBoutiques(): Promise<Boutique[]> {
    const list = await cachedRead('boutiques', async () => {
      const { data, error } = await supabase
        .from('boutiques')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      const mapped = (data as unknown as Boutique[]) ?? [];
      if (mapped.length === 0) await assertSafeToCacheEmptyList('boutiques');
      return mapped;
    }, []);
    syncBoutiqueDepotStartSeqs(list);
    return hydrateBoutiquesWithReceiptHeader(hydrateBoutiquesWithGeo(list));
  },

  async insertBoutique(row: {
    nom: string;
    adresse?: string | null;
    ville?: string | null;
    telephone?: string | null;
    email?: string | null;
    slogan?: string | null;
    message_pied?: string | null;
    depot_start_number?: number | null;
    depot_start_year?: number | null;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<{ data: Boutique | null; error: string | null }> {
    let tId = await getTenantId();
    if (!tId) {
      resetTenantCache();
      tId = await getTenantId();
    }
    if (!tId) {
      return { data: null, error: 'Unable to determine tenant' };
    }
    const targetYear =
      row.depot_start_year != null && Number.isFinite(row.depot_start_year) && row.depot_start_year >= 2000
        ? Math.floor(row.depot_start_year)
        : new Date().getFullYear();
    const normalizedStart =
      row.depot_start_number != null && Number.isFinite(row.depot_start_number) && row.depot_start_number >= 1
        ? Math.max(1, Math.floor(row.depot_start_number))
        : null;
    const hasValidGeo =
      row.latitude != null &&
      row.longitude != null &&
      Number.isFinite(row.latitude) &&
      Number.isFinite(row.longitude) &&
      row.latitude >= -90 &&
      row.latitude <= 90 &&
      row.longitude >= -180 &&
      row.longitude <= 180;
    const normalizedLat = hasValidGeo ? Math.round(row.latitude! * 1_000_000) / 1_000_000 : null;
    const normalizedLng = hasValidGeo ? Math.round(row.longitude! * 1_000_000) / 1_000_000 : null;
    const normalizedEmail = row.email?.trim() || null;
    const normalizedSlogan = row.slogan?.trim() || null;
    const normalizedFooter = row.message_pied?.trim() || null;

    let insertPayload: Record<string, unknown> = {
      nom: row.nom,
      adresse: row.adresse ?? null,
      ville: row.ville ?? null,
      telephone: row.telephone ?? null,
      tenant_id: tId,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(normalizedSlogan ? { slogan: normalizedSlogan } : {}),
      ...(normalizedFooter ? { message_pied: normalizedFooter } : {}),
      ...(normalizedStart !== null
        ? { depot_start_number: normalizedStart, depot_start_year: targetYear }
        : {}),
      ...(normalizedLat !== null && normalizedLng !== null
        ? { latitude: normalizedLat, longitude: normalizedLng }
        : {}),
    };

    let { data, error } = await supabase
      .from('boutiques')
      .insert(insertPayload)
      .select('*')
      .single();

    for (let retry = 0; retry < 8 && error; retry++) {
      const missingCol = extractMissingSchemaColumn(error.message);
      if (!missingCol || !(missingCol in insertPayload)) break;
      insertPayload = stripColumnFromRow(insertPayload, missingCol);
      ({ data, error } = await supabase
        .from('boutiques')
        .insert(insertPayload)
        .select('*')
        .single());
    }

    if (error) return { data: null, error: error.message };
    const created = data as unknown as Boutique;
    if (created?.id && normalizedStart !== null) {
      setBoutiqueDepotStartSeq(created.id, normalizedStart, targetYear);
    }
    if (created?.id && normalizedLat !== null && normalizedLng !== null) {
      setBoutiqueGeo(created.id, normalizedLat, normalizedLng);
    }
    if (created?.id) {
      setBoutiqueReceiptHeader(created.id, {
        email: normalizedEmail,
        slogan: normalizedSlogan,
        message_pied: normalizedFooter,
      });
    }
    return {
      data: created
        ? {
            ...created,
            latitude: created.latitude ?? normalizedLat,
            longitude: created.longitude ?? normalizedLng,
            email: created.email ?? normalizedEmail,
            slogan: created.slogan ?? normalizedSlogan,
            message_pied: created.message_pied ?? normalizedFooter,
          }
        : null,
      error: null,
    };
  },

  async updateBoutique(
    id: string,
    values: {
      nom?: string;
      adresse?: string | null;
      ville?: string | null;
      telephone?: string | null;
      email?: string | null;
      slogan?: string | null;
      message_pied?: string | null;
      is_default?: boolean;
      depot_start_number?: number | null;
      depot_start_year?: number | null;
      latitude?: number | null;
      longitude?: number | null;
    },
  ): Promise<string | null> {
    const targetYear =
      values.depot_start_year != null && Number.isFinite(values.depot_start_year) && values.depot_start_year >= 2000
        ? Math.floor(values.depot_start_year)
        : new Date().getFullYear();

    const payload: Record<string, unknown> = {
      ...values,
      updated_at: new Date().toISOString(),
    };

    if ('email' in values || 'slogan' in values || 'message_pied' in values) {
      setBoutiqueReceiptHeader(id, {
        ...('email' in values ? { email: values.email?.trim() || null } : {}),
        ...('slogan' in values ? { slogan: values.slogan?.trim() || null } : {}),
        ...('message_pied' in values ? { message_pied: values.message_pied?.trim() || null } : {}),
      });
    }

    if ('latitude' in values || 'longitude' in values) {
      const hasValidGeo =
        values.latitude != null &&
        values.longitude != null &&
        Number.isFinite(values.latitude) &&
        Number.isFinite(values.longitude) &&
        values.latitude >= -90 &&
        values.latitude <= 90 &&
        values.longitude >= -180 &&
        values.longitude <= 180;
      const normalizedLat = hasValidGeo ? Math.round(values.latitude! * 1_000_000) / 1_000_000 : null;
      const normalizedLng = hasValidGeo ? Math.round(values.longitude! * 1_000_000) / 1_000_000 : null;
      payload.latitude = normalizedLat;
      payload.longitude = normalizedLng;
      setBoutiqueGeo(id, normalizedLat, normalizedLng);
    }

    if ('depot_start_number' in values) {
      const normalizedStart =
        values.depot_start_number != null &&
        Number.isFinite(values.depot_start_number) &&
        values.depot_start_number >= 1
          ? Math.max(1, Math.floor(values.depot_start_number))
          : null;
      payload.depot_start_number = normalizedStart;
      payload.depot_start_year = normalizedStart !== null ? targetYear : null;
      setBoutiqueDepotStartSeq(id, normalizedStart, targetYear);
      if (id === getDefaultBoutiqueId() && normalizedStart === null) {
        setCompanyDepotStartSeq(null, targetYear);
        const tenantId = await getTenantId();
        if (tenantId && !isOffline()) {
          try {
            await supabase
              .from('entreprise')
              .update({ depot_start_number: null, depot_start_year: null, updated_at: new Date().toISOString() })
              .eq('user_id', tenantId);
          } catch {
            // Best-effort legacy sync
          }
        }
      }
    }

    const result = await update({ table: 'boutiques', values: payload, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteBoutique(id: string): Promise<string | null> {
    const result = await remove({ table: 'boutiques', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async setDefaultBoutique(id: string): Promise<string | null> {
    const { error } = await supabase.rpc('set_default_boutique', { boutique_id: id });
    return error?.message ?? null;
  },

  // ── Advanced stats for enhanced dashboard ──

  async getRevenueByDay(days: number): Promise<{ date: string; revenue: number; count: number }[]> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey(`revenue_by_day_${days}`, bid), async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      since.setHours(0, 0, 0, 0);
      const data = await fetchAllPages<{ date_depot: string; total: number }>((from, to) => {
        let q = supabase
          .from('depots')
          .select('date_depot, total')
          .gte('date_depot', since.toISOString())
          .not('statut', 'eq', 'COMMANDE')
          .order('date_depot', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      const map = new Map<string, { revenue: number; count: number }>();
      for (const row of data) {
        const day = row.date_depot.slice(0, 10);
        const existing = map.get(day) ?? { revenue: 0, count: 0 };
        existing.revenue += Number(row.total);
        existing.count += 1;
        map.set(day, existing);
      }
      return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }));
    }, []);
  },

  async getTopClients(limit: number): Promise<{ nom: string; totalCA: number; nbDepots: number }[]> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey(`top_clients_${limit}`, bid), async () => {
      const data = await fetchAllPages<{ total: number; clients: { nom: string } | { nom: string }[] | null }>((from, to) => {
        let q = supabase
          .from('depots')
          .select('total, clients!inner(nom)')
          .not('statut', 'eq', 'COMMANDE')
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      const map = new Map<string, { totalCA: number; nbDepots: number }>();
      for (const row of data) {
        const clientRel = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const nom = clientRel?.nom ?? '?';
        const existing = map.get(nom) ?? { totalCA: 0, nbDepots: 0 };
        existing.totalCA += Number(row.total);
        existing.nbDepots += 1;
        map.set(nom, existing);
      }
      return Array.from(map.entries())
        .map(([nom, v]) => ({ nom, ...v }))
        .sort((a, b) => b.totalCA - a.totalCA)
        .slice(0, limit);
    }, []);
  },

  async getPaymentBreakdown(): Promise<{ mode: string; total: number; count: number }[]> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey('payment_breakdown', bid), async () => {
      const data = await fetchAllPages<{ mode_reglement: string | null; total: number }>((from, to) => {
        let q = supabase
          .from('depots')
          .select('mode_reglement, total')
          .not('statut', 'eq', 'COMMANDE')
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      const map = new Map<string, { total: number; count: number }>();
      for (const row of data) {
        const mode = row.mode_reglement || 'Non réglé';
        const existing = map.get(mode) ?? { total: 0, count: 0 };
        existing.total += Number(row.total);
        existing.count += 1;
        map.set(mode, existing);
      }
      return Array.from(map.entries())
        .map(([mode, v]) => ({ mode, ...v }))
        .sort((a, b) => b.total - a.total);
    }, []);
  },

  async getArticleStats(): Promise<{ designation: string; count: number; revenue: number }[]> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey('article_stats', bid), async () => {
      const data = await fetchAllPages<{ designation: string; quantite: number; nb_pieces: number; prix_total: number }>((from, to) => {
        let q = supabase
          .from('depot_articles')
          .select('designation, quantite, nb_pieces, prix_total')
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      const map = new Map<string, { count: number; revenue: number }>();
      for (const row of data) {
        const existing = map.get(row.designation) ?? { count: 0, revenue: 0 };
        existing.count += Number(row.quantite) * Number(row.nb_pieces);
        existing.revenue += Number(row.prix_total);
        map.set(row.designation, existing);
      }
      return Array.from(map.entries())
        .map(([designation, v]) => ({ designation, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
    }, []);
  },

  async getMonthlyComparison(): Promise<{ currentMonth: number; previousMonth: number; currentExpenses: number; previousExpenses: number }> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey('monthly_comparison', bid), async () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const [curData, prevData, curExpData, prevExpData] = await Promise.all([
        fetchAllPages<{ total: number }>((from, to) => {
          let q = supabase
            .from('depots')
            .select('total')
            .gte('date_depot', startOfMonth.toISOString())
            .not('statut', 'eq', 'COMMANDE')
            .order('id', { ascending: true })
            .range(from, to);
          if (bid) q = q.eq('boutique_id', bid);
          return q;
        }),
        fetchAllPages<{ total: number }>((from, to) => {
          let q = supabase
            .from('depots')
            .select('total')
            .gte('date_depot', startOfPrevMonth.toISOString())
            .lt('date_depot', startOfMonth.toISOString())
            .not('statut', 'eq', 'COMMANDE')
            .order('id', { ascending: true })
            .range(from, to);
          if (bid) q = q.eq('boutique_id', bid);
          return q;
        }),
        fetchAllPages<{ montant: number }>((from, to) => {
          let q = supabase
            .from('depenses')
            .select('montant')
            .gte('date_depense', startOfMonth.toISOString())
            .order('id', { ascending: true })
            .range(from, to);
          if (bid) q = q.eq('boutique_id', bid);
          return q;
        }),
        fetchAllPages<{ montant: number }>((from, to) => {
          let q = supabase
            .from('depenses')
            .select('montant')
            .gte('date_depense', startOfPrevMonth.toISOString())
            .lt('date_depense', startOfMonth.toISOString())
            .order('id', { ascending: true })
            .range(from, to);
          if (bid) q = q.eq('boutique_id', bid);
          return q;
        }),
      ]);

      return {
        currentMonth: curData.reduce((s, d) => s + Number(d.total), 0),
        previousMonth: prevData.reduce((s, d) => s + Number(d.total), 0),
        currentExpenses: curExpData.reduce((s, d) => s + Number(d.montant), 0),
        previousExpenses: prevExpData.reduce((s, d) => s + Number(d.montant), 0),
      };
    }, { currentMonth: 0, previousMonth: 0, currentExpenses: 0, previousExpenses: 0 });
  },

  async getUnpaidTotal(): Promise<{ count: number; total: number }> {
    const bid = currentBoutiqueId;
    return cachedRead(bKey('unpaid_total', bid), async () => {
      const data = await fetchAllPages<{ total: number; avance_amount: number | null; mode_reglement: string | null }>((from, to) => {
        let q = supabase
          .from('depots')
          .select('total, avance_amount, mode_reglement')
          .eq('statut', 'EN_COURS')
          .order('id', { ascending: true })
          .range(from, to);
        if (bid) q = q.eq('boutique_id', bid);
        return q;
      });
      let count = 0;
      let total = 0;
      for (const row of data) {
        const t = Number(row.total);
        const paid = row.mode_reglement === 'PAYER_DEPOT' || row.mode_reglement === 'SOLDE' ? t : Number(row.avance_amount ?? 0);
        const reste = t - paid;
        if (reste > 0) {
          count++;
          total += reste;
        }
      }
      return { count, total };
    }, { count: 0, total: 0 });
  },

  // ── Fidelite (loyalty) ──

  async getClientPoints(clientId: string): Promise<number> {
    if (isOffline()) {
      const map = getScopedCached<Record<string, number>>('all_client_points', currentBoutiqueId) ?? {};
      return map[clientId] ?? 0;
    }
    let q = supabase
      .from('fidelite_points')
      .select('total_points')
      .eq('client_id', clientId);
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q.maybeSingle();
    if (error) {
      if (isLikelyNetworkError(error)) {
        const map = getScopedCached<Record<string, number>>('all_client_points', currentBoutiqueId) ?? {};
        return map[clientId] ?? 0;
      }
      return 0;
    }
    if (!data) return 0;
    return Number((data as { total_points: number }).total_points);
  },

  async getAllClientPoints(): Promise<Record<string, number>> {
    return cachedRead(bKey('all_client_points', currentBoutiqueId), async () => {
      const data = await fetchAllPages<{ client_id: string; total_points: number }>((from, to) => {
        let q = supabase
          .from('fidelite_points')
          .select('client_id, total_points')
          .order('client_id', { ascending: true })
          .range(from, to);
        if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
        return q;
      });
      const map: Record<string, number> = {};
      for (const row of data) {
        map[row.client_id] = Number(row.total_points);
      }
      return map;
    }, {});
  },

  async getClientFideliteHistory(clientId: string): Promise<FideliteHistory[]> {
    let q = supabase
      .from('fidelite_history')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as FideliteHistory[];
  },

  async addFidelitePoints(clientId: string, points: number, motif: string, depotId?: string): Promise<string | null> {
    const tId = await getTenantId();
    if (!tId) return 'No tenant';

    const histErr = await insert({
      table: 'fidelite_history',
      rows: {
        client_id: clientId,
        depot_id: depotId ?? null,
        points,
        motif,
        tenant_id: tId,
        boutique_id: currentBoutiqueId,
      },
    });
    if (histErr.error) return histErr.error;

    const applyOptimisticPoints = () => {
      const ptsMap = getScopedCached<Record<string, number>>('all_client_points', currentBoutiqueId) ?? {};
      const nextPts = (ptsMap[clientId] ?? 0) + points;
      setCached(bKey('all_client_points', currentBoutiqueId), { ...ptsMap, [clientId]: nextPts });
    };

    if (isOffline()) {
      applyOptimisticPoints();
      return null;
    }

    try {
      const existing = await supabase
        .from('fidelite_points')
        .select('id, total_points')
        .eq('client_id', clientId)
        .maybeSingle();

      if (existing.error && isLikelyNetworkError(existing.error)) {
        applyOptimisticPoints();
        return null;
      }

      if (existing.data) {
        const newTotal = Number((existing.data as { total_points: number }).total_points) + points;
        const updRes = await update({
          table: 'fidelite_points',
          values: { total_points: newTotal, updated_at: new Date().toISOString() },
          filters: [{ column: 'client_id', operator: 'eq', value: clientId }],
        });
        applyOptimisticPoints();
        return updRes.error;
      } else {
        const res = await insert({
          table: 'fidelite_points',
          rows: {
            client_id: clientId,
            total_points: points,
            tenant_id: tId,
            boutique_id: currentBoutiqueId,
          },
        });
        applyOptimisticPoints();
        return res.error;
      }
    } catch {
      applyOptimisticPoints();
      return null;
    }
  },

  // ── Bons de réduction (coupons) ──

  async getBonsReduction(): Promise<BonReduction[]> {
    return cachedRead('bons_reduction', async () => {
      const { data, error } = await supabaseQuery<BonReduction>({ table: 'bons_reduction', select: '*', order: { column: 'created_at', ascending: false } });
      throwIfNetworkError(error);
      return (data ?? []) as BonReduction[];
    }, []);
  },

  async insertBonReduction(row: { code: string; type_remise: string; valeur: number; date_debut: string; date_fin: string | null; usage_max: number | null; description: string | null }): Promise<{ data: BonReduction | null; error: string | null }> {
    const result = await insert<BonReduction>({ table: 'bons_reduction', rows: row });
    return { data: result.data ?? null, error: result.error };
  },

  async updateBonReduction(id: string, values: Partial<Pick<BonReduction, 'actif' | 'code' | 'type_remise' | 'valeur' | 'date_fin' | 'usage_max' | 'description'>>): Promise<string | null> {
    const result = await update({ table: 'bons_reduction', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async deleteBonReduction(id: string): Promise<string | null> {
    const result = await remove({ table: 'bons_reduction', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  async validateBonReduction(code: string): Promise<{ data: BonReduction | null; error: string | null }> {
    const validateBonObj = (bon: BonReduction | undefined | null): { data: BonReduction | null; error: string | null } => {
      if (!bon || !bon.actif) return { data: null, error: 'Code invalide' };
      const now = new Date();
      if (new Date(bon.date_debut) > now) return { data: null, error: 'Bon pas encore valide' };
      if (bon.date_fin && new Date(bon.date_fin) < now) return { data: null, error: 'Bon expiré' };
      if (bon.usage_max !== null && bon.usage_count >= bon.usage_max) return { data: null, error: 'Bon épuisé' };
      return { data: bon, error: null };
    };

    const upper = code.toUpperCase();
    if (isOffline()) {
      const cachedBons = getScopedCached<BonReduction[]>('bons_reduction', null) ?? [];
      return validateBonObj(cachedBons.find((b) => b.code.toUpperCase() === upper));
    }

    const { data, error } = await supabase
      .from('bons_reduction')
      .select('*')
      .eq('code', upper)
      .eq('actif', true)
      .maybeSingle();
    if (error) {
      if (isLikelyNetworkError(error)) {
        const cachedBons = getScopedCached<BonReduction[]>('bons_reduction', null) ?? [];
        return validateBonObj(cachedBons.find((b) => b.code.toUpperCase() === upper));
      }
      return { data: null, error: error.message };
    }
    return validateBonObj(data as BonReduction | null);
  },

  async incrementBonUsage(id: string): Promise<string | null> {
    if (isOffline()) {
      enqueueMutation('increment_bon_usage', 'rpc', { bon_id: id }, undefined, 'Utilisation bon de réduction');
      return null;
    }
    const { error } = await supabase.rpc('increment_bon_usage', { bon_id: id });
    if (error && isLikelyNetworkError(error)) {
      enqueueMutation('increment_bon_usage', 'rpc', { bon_id: id }, undefined, 'Utilisation bon de réduction');
      return null;
    }
    return error?.message ?? null;
  },

  // ─── Consommables (stock) ─────────────────────────────────
  async getAllConsommables(): Promise<Consommable[]> {
    const cacheKey = bKey('consommables', currentBoutiqueId);
    return cachedRead(cacheKey, async () => {
      let q = supabase.from('consommables').select('*').order('nom');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        quantite: Number(r.quantite),
        seuil_alerte: Number(r.seuil_alerte),
        prix_unitaire: Number(r.prix_unitaire),
      })) as Consommable[];
      if (mapped.length === 0) await assertSafeToCacheEmptyList(cacheKey);
      return mapped;
    }, []);
  },

  async insertConsommable(row: { nom: string; unite: string; quantite: number; seuil_alerte: number; prix_unitaire: number; fournisseur: string | null }): Promise<{ data: Consommable | null; error: string | null }> {
    const result = await insert<Consommable>({ table: 'consommables', rows: row, select: '*' });
    if (result.data) {
      const d = result.data as unknown as Record<string, unknown>;
      return {
        data: { ...d, quantite: Number(d.quantite), seuil_alerte: Number(d.seuil_alerte), prix_unitaire: Number(d.prix_unitaire) } as unknown as Consommable,
        error: null,
      };
    }
    return { data: null, error: result.error };
  },

  async updateConsommable(id: string, values: Record<string, unknown>): Promise<string | null> {
    const { error } = await update({ table: 'consommables', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
    return error;
  },

  async deleteConsommable(id: string): Promise<string | null> {
    const { error } = await remove({ table: 'consommables', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return error;
  },

  async getMouvements(consommableId: string): Promise<ConsommableMouvement[]> {
    const { data, error } = await supabase
      .from('consommable_mouvements')
      .select('*')
      .eq('consommable_id', consommableId)
      .order('date_mouvement', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return [];
    return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
      ...r,
      quantite: Number(r.quantite),
    })) as ConsommableMouvement[];
  },

  async addMouvement(consommableId: string, type_mouvement: 'entree' | 'sortie', quantite: number, motif: string | null): Promise<string | null> {
    const tId = await getTenantId();
    if (!tId) return 'Impossible de déterminer le tenant';
    const mvtRes = await insert({
      table: 'consommable_mouvements',
      rows: {
        consommable_id: consommableId,
        tenant_id: tId,
        boutique_id: currentBoutiqueId,
        type_mouvement,
        quantite,
        motif,
        date_mouvement: new Date().toISOString().slice(0, 10),
      },
    });
    if (mvtRes.error) return mvtRes.error;

    const delta = type_mouvement === 'entree' ? quantite : -quantite;
    optimisticAdjustConsommable(consommableId, delta, currentBoutiqueId);

    if (isOffline()) {
      enqueueMutation('adjust_consommable_stock', 'rpc', { c_id: consommableId, delta }, undefined, 'Ajustement stock consommable');
      return null;
    }
    const { error: updateErr } = await supabase.rpc('adjust_consommable_stock', {
      c_id: consommableId,
      delta,
    });
    if (updateErr && isLikelyNetworkError(updateErr)) {
      enqueueMutation('adjust_consommable_stock', 'rpc', { c_id: consommableId, delta }, undefined, 'Ajustement stock consommable');
      return null;
    }
    return updateErr?.message ?? null;
  },

  // Relances
  async getRelances(limit = 200): Promise<RelanceWithClient[]> {
    return cachedRead(bKey('relances', currentBoutiqueId), async () => {
      let q = supabase
        .from('relances')
        .select('*, clients!inner(nom, telephone)')
        .order('date_relance', { ascending: false })
        .limit(limit);
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) ?? []).map((r) => {
        const client = r.clients as Record<string, unknown> | null;
        return {
          id: r.id as string,
          client_id: r.client_id as string,
          canal: r.canal as Relance['canal'],
          note: (r.note as string | null) ?? null,
          date_relance: r.date_relance as string,
          created_at: r.created_at as string,
          client_nom: (client?.nom as string) ?? '—',
          client_telephone: (client?.telephone as string | null) ?? null,
        };
      });
    }, []);
  },

  async getRelancesByClient(clientId: string): Promise<Relance[]> {
    const { data, error } = await supabase
      .from('relances')
      .select('*')
      .eq('client_id', clientId)
      .order('date_relance', { ascending: false });
    if (error) return [];
    return (data as unknown as Relance[]) ?? [];
  },

  async insertRelance(row: { client_id: string; canal: Relance['canal']; note?: string | null }): Promise<string | null> {
    const result = await insert({ table: 'relances', rows: row });
    return result.error;
  },

  async deleteRelance(id: string): Promise<string | null> {
    const result = await remove({ table: 'relances', filters: [{ column: 'id', operator: 'eq', value: id }] });
    return result.error;
  },

  // Commerciaux & Commissions
  async getCommerciaux(): Promise<{ data: Commercial[]; missingTable: boolean; error: string | null }> {
    const cacheKey = 'all_commerciaux';
    if (isOffline()) {
      return { data: getCached<Commercial[]>(cacheKey) ?? [], missingTable: false, error: null };
    }
    try {
      const tId = await getTenantId();
      let q = supabase.from('commerciaux').select('*').order('nom');
      if (tId) q = q.eq('tenant_id', tId);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) {
          return { data: [], missingTable: true, error: null };
        }
        if (isLikelyNetworkError(error)) {
          return { data: getCached<Commercial[]>(cacheKey) ?? [], missingTable: false, error: null };
        }
        return { data: [], missingTable: false, error: error.message };
      }
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        taux_commission: Number(r.taux_commission ?? 0),
        actif: Boolean(r.actif ?? true),
      })) as Commercial[];
      setCached(cacheKey, mapped);
      return { data: mapped, missingTable: false, error: null };
    } catch (err) {
      return {
        data: getCached<Commercial[]>(cacheKey) ?? [],
        missingTable: false,
        error: err instanceof Error ? err.message : 'Erreur réseau',
      };
    }
  },

  async getActiveCommerciaux(): Promise<Commercial[]> {
    const res = await db.getCommerciaux();
    if (res.missingTable || res.error) return [];
    return res.data.filter((c) => c.actif);
  },

  async insertCommercial(row: {
    nom: string;
    telephone?: string | null;
    email?: string | null;
    taux_commission: number;
    portal_code?: string | null;
    actif?: boolean;
    notes?: string | null;
  }): Promise<{ data: Commercial | null; error: string | null }> {
    const baseRow = {
      nom: row.nom.trim(),
      telephone: row.telephone?.trim() || null,
      email: row.email?.trim() || null,
      taux_commission: row.taux_commission,
      actif: row.actif ?? true,
      notes: row.notes?.trim() || null,
    };
    const code = row.portal_code?.trim().toUpperCase() || generateCommercialPortalCode();

    let result = await insert<Commercial>({
      table: 'commerciaux',
      rows: { ...baseRow, portal_code: code },
      select: '*',
    });

    // Graceful fallback if portal_code column hasn't been added by migration yet
    if (result.error && /portal_code|column/i.test(result.error)) {
      result = await insert<Commercial>({
        table: 'commerciaux',
        rows: baseRow,
        select: '*',
      });
    }

    if (result.data) {
      const c = {
        ...result.data,
        taux_commission: Number(result.data.taux_commission ?? 0),
        actif: Boolean(result.data.actif ?? true),
      };
      return { data: c, error: null };
    }
    return { data: null, error: result.error };
  },

  async updateCommercial(
    id: string,
    values: {
      nom?: string;
      telephone?: string | null;
      email?: string | null;
      taux_commission?: number;
      portal_code?: string | null;
      actif?: boolean;
      notes?: string | null;
    },
  ): Promise<string | null> {
    const cleanValues: Record<string, unknown> = {
      ...values,
      updated_at: new Date().toISOString(),
    };
    if (typeof values.nom === 'string') cleanValues.nom = values.nom.trim();
    if (values.telephone !== undefined) cleanValues.telephone = values.telephone?.trim() || null;
    if (values.email !== undefined) cleanValues.email = values.email?.trim() || null;
    if (values.notes !== undefined) cleanValues.notes = values.notes?.trim() || null;
    if (typeof values.portal_code === 'string') cleanValues.portal_code = values.portal_code.trim().toUpperCase();
    const result = await update({
      table: 'commerciaux',
      values: cleanValues,
      filters: [{ column: 'id', operator: 'eq', value: id }],
    });
    return result.error;
  },

  async regenerateCommercialPortalCode(id: string): Promise<{ code: string | null; error: string | null }> {
    const nextCode = generateCommercialPortalCode();
    const err = await db.updateCommercial(id, { portal_code: nextCode });
    if (err) return { code: null, error: err };
    return { code: nextCode, error: null };
  },

  async deleteCommercial(id: string): Promise<string | null> {
    const result = await remove({
      table: 'commerciaux',
      filters: [{ column: 'id', operator: 'eq', value: id }],
    });
    return result.error;
  },

  // Commercial ↔ Clients (time-bounded assignments)
  async getCommercialClients(
    commercialId?: string,
  ): Promise<{ data: CommercialClientWithDetails[]; missingTable: boolean; error: string | null }> {
    const cacheKey = commercialId ? `commercial_clients_${commercialId}` : 'all_commercial_clients';
    if (isOffline()) {
      return { data: getCached<CommercialClientWithDetails[]>(cacheKey) ?? [], missingTable: false, error: null };
    }
    try {
      const tId = await getTenantId();
      let q = supabase
        .from('commercial_clients')
        .select('*, clients(nom, code, telephone)')
        .order('date_fin', { ascending: false })
        .order('created_at', { ascending: false });
      if (tId) q = q.eq('tenant_id', tId);
      if (commercialId) q = q.eq('commercial_id', commercialId);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) {
          return { data: [], missingTable: true, error: null };
        }
        if (isLikelyNetworkError(error)) {
          return { data: getCached<CommercialClientWithDetails[]>(cacheKey) ?? [], missingTable: false, error: null };
        }
        return { data: [], missingTable: false, error: error.message };
      }
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => {
        const cl = r.clients as Record<string, unknown> | null;
        return {
          id: String(r.id),
          tenant_id: String(r.tenant_id),
          boutique_id: (r.boutique_id as string | null) ?? null,
          commercial_id: String(r.commercial_id),
          client_id: String(r.client_id),
          duree_jours: Number(r.duree_jours ?? 30),
          date_debut: String(r.date_debut ?? '').slice(0, 10),
          date_fin: String(r.date_fin ?? '').slice(0, 10),
          taux_commission: r.taux_commission != null ? Number(r.taux_commission) : null,
          actif: Boolean(r.actif ?? true),
          notes: (r.notes as string | null) ?? null,
          created_at: String(r.created_at ?? ''),
          updated_at: r.updated_at ? String(r.updated_at) : undefined,
          client_nom: (cl?.nom as string) ?? '—',
          client_code: (cl?.code as string | null) ?? null,
          client_telephone: (cl?.telephone as string | null) ?? null,
        };
      }) as CommercialClientWithDetails[];
      setCached(cacheKey, mapped);
      return { data: mapped, missingTable: false, error: null };
    } catch (err) {
      return {
        data: getCached<CommercialClientWithDetails[]>(cacheKey) ?? [],
        missingTable: false,
        error: err instanceof Error ? err.message : 'Erreur réseau',
      };
    }
  },

  async insertCommercialClientsBulk(rows: Array<{
    commercial_id: string;
    client_id: string;
    duree_jours: number;
    date_debut: string;
    date_fin?: string;
    taux_commission?: number | null;
    actif?: boolean;
    notes?: string | null;
  }>): Promise<{ count: number; error: string | null }> {
    if (rows.length === 0) return { count: 0, error: null };
    const tId = await getTenantId();
    if (!tId) {
      return {
        count: 0,
        error: 'Session entreprise introuvable. Veuillez actualiser la page et réessayer.',
      };
    }
    const payload = rows.map((r) => {
      const duree = Math.max(1, Math.min(3650, Math.round(r.duree_jours)));
      const debut = r.date_debut.slice(0, 10);
      const fin = r.date_fin ? r.date_fin.slice(0, 10) : computeDateFinFromDays(debut, duree);
      return {
        tenant_id: tId,
        commercial_id: r.commercial_id,
        client_id: r.client_id,
        duree_jours: duree,
        date_debut: debut,
        date_fin: fin,
        taux_commission: r.taux_commission ?? null,
        actif: r.actif ?? true,
        notes: r.notes?.trim() || null,
      };
    });
    const result = await insert<CommercialClient>({
      table: 'commercial_clients',
      rows: payload,
      select: '*',
    });
    if (result.error) return { count: 0, error: result.error };
    return { count: payload.length, error: null };
  },

  async updateCommercialClient(
    id: string,
    values: {
      commercial_id?: string;
      duree_jours?: number;
      date_debut?: string;
      date_fin?: string;
      taux_commission?: number | null;
      actif?: boolean;
      notes?: string | null;
    },
  ): Promise<string | null> {
    const cleanValues: Record<string, unknown> = {
      ...values,
      updated_at: new Date().toISOString(),
    };
    if (values.notes !== undefined) cleanValues.notes = values.notes?.trim() || null;
    if (values.date_debut) cleanValues.date_debut = values.date_debut.slice(0, 10);
    if (values.date_fin) cleanValues.date_fin = values.date_fin.slice(0, 10);
    const result = await update({
      table: 'commercial_clients',
      values: cleanValues,
      filters: [{ column: 'id', operator: 'eq', value: id }],
    });
    return result.error;
  },

  async deleteCommercialClient(id: string): Promise<string | null> {
    const result = await remove({
      table: 'commercial_clients',
      filters: [{ column: 'id', operator: 'eq', value: id }],
    });
    return result.error;
  },

  // Commercial Portal (public code-authenticated RPCs)
  async getCommercialPortalBranding(entrepriseId: number): Promise<CommercialPortalBranding | null> {
    try {
      const { data, error } = await supabase.rpc('get_commercial_portal_branding', {
        p_entreprise_id: entrepriseId,
      });
      if (error || !data || typeof data !== 'object') return null;
      return data as CommercialPortalBranding;
    } catch {
      return null;
    }
  },

  async getCommercialPortalData(
    portalCode: string,
    entrepriseId?: number | null,
  ): Promise<{ data: CommercialPortalData | null; error: string | null }> {
    const cleanCode = portalCode.trim().toUpperCase();
    if (cleanCode.length < 4) {
      return { data: null, error: "Veuillez saisir un code d'accès valide." };
    }
    try {
      const { data, error } = await supabase.rpc('get_commercial_portal_data', {
        p_portal_code: cleanCode,
        p_entreprise_id: entrepriseId ?? null,
      });
      if (error) {
        if (/get_commercial_portal_data|function.*does not exist/i.test(error.message)) {
          return {
            data: null,
            error: "Le portail commercial n'est pas encore activé sur la base de données. Demandez à votre administrateur d'exécuter la mise à jour SQL.",
          };
        }
        return { data: null, error: error.message };
      }
      if (!data || typeof data !== 'object') {
        return { data: null, error: 'Code invalide ou compte commercial inactif.' };
      }
      const obj = data as Record<string, unknown>;
      if (typeof obj.error === 'string' && obj.error) {
        return { data: null, error: obj.error };
      }
      return { data: obj as unknown as CommercialPortalData, error: null };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Erreur de connexion au portail.',
      };
    }
  },

  async getCommissionVersements(
    commercialId?: string,
  ): Promise<{ data: CommissionVersement[]; missingTable: boolean; error: string | null }> {
    const cacheKey = commercialId ? `commission_versements_${commercialId}` : 'all_commission_versements';
    if (isOffline()) {
      return { data: getCached<CommissionVersement[]>(cacheKey) ?? [], missingTable: false, error: null };
    }
    try {
      const tId = await getTenantId();
      let q = supabase
        .from('commission_versements')
        .select('*')
        .order('date_versement', { ascending: false })
        .order('created_at', { ascending: false });
      if (tId) q = q.eq('tenant_id', tId);
      if (commercialId) q = q.eq('commercial_id', commercialId);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) {
          return { data: [], missingTable: true, error: null };
        }
        if (isLikelyNetworkError(error)) {
          return { data: getCached<CommissionVersement[]>(cacheKey) ?? [], missingTable: false, error: null };
        }
        return { data: [], missingTable: false, error: error.message };
      }
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        montant: Number(r.montant ?? 0),
      })) as CommissionVersement[];
      setCached(cacheKey, mapped);
      return { data: mapped, missingTable: false, error: null };
    } catch (err) {
      return {
        data: getCached<CommissionVersement[]>(cacheKey) ?? [],
        missingTable: false,
        error: err instanceof Error ? err.message : 'Erreur réseau',
      };
    }
  },

  async insertCommissionVersement(row: {
    commercial_id: string;
    montant: number;
    mode_reglement?: string | null;
    date_versement?: string;
    periode_debut?: string | null;
    periode_fin?: string | null;
    reference?: string | null;
    notes?: string | null;
  }): Promise<{ data: CommissionVersement | null; error: string | null }> {
    const result = await insert<CommissionVersement>({
      table: 'commission_versements',
      rows: {
        commercial_id: row.commercial_id,
        montant: row.montant,
        mode_reglement: row.mode_reglement?.trim() || null,
        date_versement: row.date_versement || new Date().toISOString(),
        periode_debut: row.periode_debut || null,
        periode_fin: row.periode_fin || null,
        reference: row.reference?.trim() || null,
        notes: row.notes?.trim() || null,
      },
      select: '*',
    });
    if (result.data) {
      return {
        data: { ...result.data, montant: Number(result.data.montant ?? 0) },
        error: null,
      };
    }
    return { data: null, error: result.error };
  },

  async deleteCommissionVersement(id: string): Promise<string | null> {
    const result = await remove({
      table: 'commission_versements',
      filters: [{ column: 'id', operator: 'eq', value: id }],
    });
    return result.error;
  },

  async getDepotsForCommissions(): Promise<DepotWithClient[]> {
    const cacheKey = 'all_depots_commissions';
    return cachedRead(cacheKey, async () => {
      const tId = await getTenantId();
      const rows = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let q = supabase
          .from('depots')
          .select('id, numero, client_id, statut, total, date_depot, boutique_id, commercial_id, commission_taux, commission_montant, created_at, clients(nom, telephone)')
          .order('date_depot', { ascending: false })
          .range(from, to);
        if (tId) q = q.eq('tenant_id', tId);
        return q;
      });
      return rows.map((r) => ({
        ...r,
        total: Number(r.total ?? 0),
        commercial_id: (r.commercial_id as string | null) ?? null,
        commission_taux: r.commission_taux != null ? Number(r.commission_taux) : null,
        commission_montant: r.commission_montant != null ? Number(r.commission_montant) : null,
      })) as DepotWithClient[];
    }, []);
  },

  // ─── SYSCOHADA Manual Journal Entries (OD) & Fiscal Settings ───
  async getEcrituresComptables(): Promise<{ data: EcritureComptableRecord[]; missingTable: boolean }> {
    const bid = currentBoutiqueId;
    const cacheKey = bKey('ecritures_comptables', bid);
    const localKey = `syscohada_od_local_${bid ?? 'default'}`;

    const readLocalFallback = (): EcritureComptableRecord[] => {
      try {
        const raw = localStorage.getItem(localKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as EcritureComptableRecord[]) : [];
      } catch {
        return [];
      }
    };

    if (isOffline()) {
      const cached = getCached<EcritureComptableRecord[]>(cacheKey);
      return { data: cached ?? readLocalFallback(), missingTable: false };
    }

    try {
      const tId = await getTenantId();
      let q = supabase
        .from('ecritures_comptables')
        .select('*')
        .order('date_ecriture', { ascending: false })
        .order('created_at', { ascending: false });
      if (tId) q = q.eq('tenant_id', tId);
      if (bid) q = q.eq('boutique_id', bid);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) {
          return { data: readLocalFallback(), missingTable: true };
        }
        if (isLikelyNetworkError(error)) {
          return { data: getCached<EcritureComptableRecord[]>(cacheKey) ?? readLocalFallback(), missingTable: false };
        }
        return { data: getCached<EcritureComptableRecord[]>(cacheKey) ?? [], missingTable: false };
      }
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        lignes: Array.isArray(r.lignes) ? (r.lignes as SyscohadaLigneInput[]) : [],
        total_debit: Number(r.total_debit ?? 0),
        total_credit: Number(r.total_credit ?? 0),
      })) as EcritureComptableRecord[];
      setCached(cacheKey, mapped);
      return { data: mapped, missingTable: false };
    } catch {
      return { data: getCached<EcritureComptableRecord[]>(cacheKey) ?? readLocalFallback(), missingTable: false };
    }
  },

  async insertEcritureComptable(row: {
    date_ecriture: string;
    journal: SyscohadaJournalCode;
    numero_piece: string;
    libelle: string;
    lignes: SyscohadaLigneInput[];
    notes?: string | null;
  }): Promise<{ data: EcritureComptableRecord | null; storedLocally?: boolean; error: string | null }> {
    const totalDebit = Math.round(row.lignes.reduce((s, l) => s + Number(l.debit || 0), 0) * 100) / 100;
    const totalCredit = Math.round(row.lignes.reduce((s, l) => s + Number(l.credit || 0), 0) * 100) / 100;
    if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
      return { data: null, error: 'Écriture déséquilibrée : le total Débit doit être strictement égal au total Crédit.' };
    }

    const bid = currentBoutiqueId;
    const localKey = `syscohada_od_local_${bid ?? 'default'}`;

    const saveLocal = (): EcritureComptableRecord => {
      const rec: EcritureComptableRecord = {
        id: generateUuid(),
        boutique_id: bid,
        date_ecriture: row.date_ecriture,
        journal: row.journal,
        numero_piece: row.numero_piece.trim(),
        libelle: row.libelle.trim(),
        lignes: row.lignes,
        total_debit: totalDebit,
        total_credit: totalCredit,
        notes: row.notes?.trim() || null,
        created_at: new Date().toISOString(),
      };
      try {
        const raw = localStorage.getItem(localKey);
        const list: EcritureComptableRecord[] = raw ? JSON.parse(raw) : [];
        localStorage.setItem(localKey, JSON.stringify([rec, ...list]));
      } catch {
        // Ignore storage quota errors
      }
      return rec;
    };

    try {
      const tId = await getTenantId();
      const { data: userRes } = await supabase.auth.getUser();
      const payload: Record<string, unknown> = {
        date_ecriture: row.date_ecriture,
        journal: row.journal,
        numero_piece: row.numero_piece.trim(),
        libelle: row.libelle.trim(),
        lignes: row.lignes,
        total_debit: totalDebit,
        total_credit: totalCredit,
        notes: row.notes?.trim() || null,
        created_by: userRes?.user?.id ?? null,
      };
      if (tId) payload.tenant_id = tId;
      if (bid) payload.boutique_id = bid;

      const { data, error } = await supabase
        .from('ecritures_comptables')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        if (isMissingTableError(error)) {
          const rec = saveLocal();
          return { data: rec, storedLocally: true, error: null };
        }
        return { data: null, error: error.message };
      }

      const mapped: EcritureComptableRecord = {
        ...(data as Record<string, unknown>),
        lignes: Array.isArray((data as Record<string, unknown>).lignes)
          ? ((data as Record<string, unknown>).lignes as SyscohadaLigneInput[])
          : row.lignes,
        total_debit: Number((data as Record<string, unknown>).total_debit ?? totalDebit),
        total_credit: Number((data as Record<string, unknown>).total_credit ?? totalCredit),
      } as EcritureComptableRecord;
      notifyRealtimeMutation('ecritures_comptables');
      return { data: mapped, storedLocally: false, error: null };
    } catch (err) {
      if (isOffline() || isLikelyNetworkError(err)) {
        const rec = saveLocal();
        return { data: rec, storedLocally: true, error: null };
      }
      return { data: null, error: err instanceof Error ? err.message : 'Erreur lors de la création' };
    }
  },

  async deleteEcritureComptable(id: string): Promise<string | null> {
    const bid = currentBoutiqueId;
    const localKey = `syscohada_od_local_${bid ?? 'default'}`;
    try {
      const raw = localStorage.getItem(localKey);
      if (raw) {
        const list: EcritureComptableRecord[] = JSON.parse(raw);
        const filtered = list.filter((e) => e.id !== id);
        if (filtered.length !== list.length) {
          localStorage.setItem(localKey, JSON.stringify(filtered));
          return null;
        }
      }
    } catch {
      // Ignore
    }

    const { error } = await supabase.from('ecritures_comptables').delete().eq('id', id);
    if (error && !isMissingTableError(error)) return error.message;
    notifyRealtimeMutation('ecritures_comptables');
    return null;
  },

  async updateEntrepriseFiscalSettings(
    entrepriseId: string,
    regime_fiscal: 'SMT' | 'NORMAL',
    taux_tva: number,
  ): Promise<string | null> {
    const result = await update({
      table: 'entreprise',
      values: { regime_fiscal, taux_tva },
      filters: [{ column: 'id', operator: 'eq', value: entrepriseId }],
    });
    return result.error;
  },

  // ─── Offline Cache Warmup / Post-Sync Refresh ─────────────
  async prefetchOfflineData(): Promise<void> {
    if (isOffline()) return;
    await Promise.allSettled([
      db.getEntreprise(),
      db.getAllClients(),
      db.getTypesTraitement(),
      db.getModesReglement(),
      db.getArticles(),
      db.getAllVariants(),
      db.getDepotsForRetrait(),
      db.getAllDepotsWithClient(),
      db.getDepotsWithClient(),
      db.getDepotsForPlanning(),
      db.getDashboardStats(),
      db.getAllAvances(),
      db.getAllDepenses(),
      db.getAllDepenseCategories(),
      db.getAllConsommables(),
      db.getBonsReduction(),
      db.getCommerciaux(),
      db.getCommercialClients(),
      db.getCommissionVersements(),
      db.getEcrituresComptables(),
    ]);
    markCacheRefreshedNow();
  },
};

// Automatically refresh read caches in the background after queued offline mutations finish syncing
onPostSync(() => {
  void db.prefetchOfflineData();
});

