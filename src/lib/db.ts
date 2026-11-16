import { supabase } from '@/lib/supabase';
import { enqueueMutation, onPostSync } from '@/lib/offlineQueue';
import { notifyRealtimeMutation } from '@/lib/realtimeSync';
import {
  cachedRead,
  setCached,
  isLikelyNetworkError,
  throwIfNetworkError,
  markCacheRefreshedNow,
  OfflineNetworkError,
} from '@/lib/readCache';
import {
  bKey,
  getScopedCached,
  observeDepotNumeros,
  observeClientCodes,
  observeArticleCodes,
  observeTraitementCodes,
  generateOfflineDepotNumero,
  generateOfflineRpcCode,
  prepareOfflineInsertRows,
  buildMutationLabel,
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
} from '@/types';

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
  | 'relances';

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
  const { data: { session } } = await supabase.auth.getSession();
  const fallback = session?.user?.id ?? null;
  if (fallback) setCachedTenantId(fallback);
  return fallback;
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
]);

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
]);

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

const FAST_WRITE_TIMEOUT_MS = 4500;

async function withWriteTimeout<R>(promiseLike: PromiseLike<R>): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promiseLike),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new OfflineNetworkError('Write timeout — continuing in background'));
        }, FAST_WRITE_TIMEOUT_MS);
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
  if (!QUEUEABLE_TABLES.has(table)) return rows;
  // entreprise uses integer identity PK; all QUEUEABLE_TABLES use UUID id PK
  return rows.map((r) => (r.id ? r : { ...r, id: crypto.randomUUID() }));
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
    if (tId) {
      rows = rows.map((r) => ({
        ...r,
        tenant_id: r.tenant_id ?? tId,
        user_id: r.user_id ?? tId,
        boutique_id: r.boutique_id ?? currentBoutiqueId,
      }));
    }
  }

  rows = ensureDeterministicRowIds(config.table, rows);

  if (isOffline() && QUEUEABLE_TABLES.has(config.table)) {
    return enqueueOfflineInsert<T>(config, rows);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(config.table).insert(rows);
    if (config.select || config.table === 'articles' || config.table === 'bons_reduction') {
      q = q.select();
    }
    const { data, error } = QUEUEABLE_TABLES.has(config.table)
      ? await withWriteTimeout<{ data: unknown; error: { message: string } | null }>(q)
      : await q;
    if (error) {
      if (QUEUEABLE_TABLES.has(config.table) && isLikelyNetworkError(error)) {
        return enqueueOfflineInsert<T>(config, rows);
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
  const queueOffline = () => {
    enqueueMutation(
      config.table,
      'update',
      config.values,
      config.filters as unknown as Record<string, unknown>[],
      buildMutationLabel(config.table, 'update', config.values),
    );
    notifyRealtimeMutation(config.table);
    return { data: null, error: null } as MutationResult<T>;
  };

  if (isOffline() && QUEUEABLE_TABLES.has(config.table)) {
    return queueOffline();
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(config.table).update(config.values);
    for (const f of config.filters) {
      q = q[f.operator](f.column, f.value);
    }
    if (config.select) q = q.select();
    const { data, error } = QUEUEABLE_TABLES.has(config.table)
      ? await withWriteTimeout<{ data: unknown; error: { message: string } | null }>(q)
      : await q;
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
    if (tId) row = { ...row, tenant_id: row.tenant_id ?? tId, user_id: row.user_id ?? tId, boutique_id: row.boutique_id ?? currentBoutiqueId };
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
    const req = supabase.from(config.table).upsert(row);
    const { data, error } = QUEUEABLE_TABLES.has(config.table)
      ? await withWriteTimeout<{ data: unknown; error: { message: string } | null }>(req)
      : await req;
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

// ─── Typed convenience wrappers ────────────────────────────

export const db = {
  // Clients
  async searchClients(term: string): Promise<Client[]> {
    if (!term.trim()) return [];
    const t = term.trim();
    const searchFromCache = () => {
      const cached = getScopedCached<Client[]>('all_clients', currentBoutiqueId);
      if (!cached) return [];
      const lower = t.toLowerCase();
      return cached
        .filter(
          (c) =>
            (c.nom ?? '').toLowerCase().includes(lower) ||
            (c.telephone ?? '').toLowerCase().includes(lower) ||
            (c.code ?? '').toLowerCase().includes(lower),
        )
        .slice(0, 10);
    };
    if (isOffline()) return searchFromCache();
    let q = supabase
      .from('clients')
      .select('*')
      .or(`nom.ilike.%${t}%,telephone.ilike.%${t}%,code.ilike.%${t}%`)
      .order('nom')
      .limit(10);
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? searchFromCache() : [];
    return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
      ...r,
      taux_remise: Number(r.taux_remise),
      condition_remise: r.condition_remise != null ? Number(r.condition_remise) : null,
    })) as Client[];
  },

  async getAllClients(): Promise<Client[]> {
    return cachedRead(bKey('all_clients', currentBoutiqueId), async () => {
      let q = supabase.from('clients').select('*').order('nom');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        taux_remise: Number(r.taux_remise),
        condition_remise: r.condition_remise != null ? Number(r.condition_remise) : null,
      })) as Client[];
      observeClientCodes(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getLastDepotDates(clientIds: string[]): Promise<Record<string, { date: string; total: number; count: number }>> {
    const map: Record<string, { date: string; total: number; count: number }> = {};
    if (clientIds.length === 0) return map;
    const computeFromCache = () => {
      const idSet = new Set(clientIds);
      const cached = getScopedCached<DepotWithArticles[]>('all_depots', currentBoutiqueId) ?? [];
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
    let q = supabase
      .from('depots')
      .select('client_id, date_depot, total')
      .in('client_id', clientIds)
      .order('date_depot', { ascending: false });
    if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
    const { data, error } = await q;
    if (error) return isLikelyNetworkError(error) ? computeFromCache() : map;
    for (const d of (data as { client_id: string; date_depot: string; total: string | number }[]) ?? []) {
      if (!(d.client_id in map)) {
        map[d.client_id] = { date: d.date_depot, total: 0, count: 0 };
      }
      map[d.client_id].total += Number(d.total);
      map[d.client_id].count += 1;
    }
    return map;
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

  // Types traitement
  async getTypesTraitement(): Promise<TypeTraitement[]> {
    return cachedRead(bKey('types_traitement', currentBoutiqueId), async () => {
      let q = supabase.from('types_traitement').select('*').order('coefficient');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
        ...row,
        coefficient: Number(row.coefficient),
        nb_jours: Number(row.nb_jours),
      })) as TypeTraitement[];
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
    return cachedRead(bKey('modes_reglement', currentBoutiqueId), async () => {
      let q = supabase.from('modes_reglement').select('*').order('designation');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        taux_remise: r.taux_remise != null ? Number(r.taux_remise) : 0,
      })) as ModeReglementRow[];
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
    return cachedRead(bKey('articles', currentBoutiqueId), async () => {
      let q = supabase.from('articles').select('*').order('designation');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        prix_unitaire: Number(r.prix_unitaire),
        nb_pieces: Number(r.nb_pieces),
      })) as ArticleCatalog[];
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
    return cachedRead(bKey('all_variants', currentBoutiqueId), async () => {
      let q = supabase
        .from('article_variants')
        .select('*')
        .order('designation');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
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
    return cachedRead(bKey('recent_depots', currentBoutiqueId), async () => {
      let q = supabase
        .from('depots')
        .select('*, clients!inner(nom, telephone, portal_code)')
        .order('created_at', { ascending: false })
        .limit(8);
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        total: Number(r.total),
        avance_amount: r.avance_amount != null ? Number(r.avance_amount) : null,
        coefficient: Number(r.coefficient),
        taux_remise: r.taux_remise != null ? Number(r.taux_remise) : null,
        montant_remise: r.montant_remise != null ? Number(r.montant_remise) : null,
      })) as DepotWithClient[];
      observeDepotNumeros(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getDepotsForRetrait(): Promise<DepotWithArticles[]> {
    return cachedRead(bKey('depots_retrait', currentBoutiqueId), async () => {
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
      observeDepotNumeros(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getDepotsForPlanning(): Promise<DepotWithClient[]> {
    return cachedRead(bKey('depots_planning', currentBoutiqueId), async () => {
      let q = supabase
        .from('depots')
        .select('*, clients!inner(nom, telephone, portal_code)')
        .order('date_retrait_prevue', { ascending: true, nullsFirst: false });
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      const mapped = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        total: Number(r.total),
        avance_amount: r.avance_amount != null ? Number(r.avance_amount) : null,
        coefficient: Number(r.coefficient),
        taux_remise: r.taux_remise != null ? Number(r.taux_remise) : null,
        montant_remise: r.montant_remise != null ? Number(r.montant_remise) : null,
      })) as DepotWithClient[];
      observeDepotNumeros(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getAllDepotsWithClient(): Promise<DepotWithArticles[]> {
    return cachedRead(bKey('all_depots', currentBoutiqueId), async () => {
      let q = supabase
        .from('depots')
        .select('*, clients!inner(nom, telephone, portal_code), depot_articles(*)')
        .order('date_depot', { ascending: false });
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
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
      observeDepotNumeros(mapped, currentBoutiqueId);
      return mapped;
    }, []);
  },

  async getDepotsForReleve(clientId: string): Promise<DepotWithArticles[]> {
    const fromCache = () => {
      const all = getScopedCached<DepotWithArticles[]>('all_depots', currentBoutiqueId) ?? [];
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
    return cachedRead(bKey('dashboard_stats', currentBoutiqueId), async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();
      const tomorrowISO = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const bid = currentBoutiqueId;
      const [enCoursRes, retiresRes, todayRes, retraitTodayRes] = await Promise.all([
        supabase.from('depots').select('*', { count: 'exact', head: true }).eq('statut', 'EN_COURS').eq('boutique_id', bid ?? ''),
        supabase.from('depots').select('*', { count: 'exact', head: true }).eq('statut', 'RETIRE').eq('boutique_id', bid ?? ''),
        supabase.from('depots').select('total').gte('date_depot', todayISO).eq('boutique_id', bid ?? ''),
        supabase.from('depots').select('total').gte('date_retrait_prevue', todayISO).lt('date_retrait_prevue', tomorrowISO).eq('boutique_id', bid ?? ''),
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const cacheKey = `offline_member_name_${session.user.id}`;
    const fallback = () => {
      try {
        const stored = localStorage.getItem(cacheKey);
        if (stored) return stored;
      } catch {
        // Ignore
      }
      return session.user.user_metadata?.full_name || session.user.email || null;
    };
    if (isOffline()) return fallback();
    const tId = await getTenantId();
    if (!tId) return fallback();
    const { data, error } = await supabase
      .from('entreprise_members')
      .select('full_name')
      .eq('tenant_id', tId)
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error && isLikelyNetworkError(error)) return fallback();
    const resolved = data?.full_name || session.user.user_metadata?.full_name || session.user.email || null;
    if (resolved) {
      try { localStorage.setItem(cacheKey, resolved); } catch { /* ignore */ }
    }
    return resolved;
  },

  async getEntreprise(): Promise<Entreprise | null> {
    return cachedRead<Entreprise | null>('entreprise', async () => {
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
  },

  async upsertEntreprise(row: Record<string, unknown>, userId?: string): Promise<string | null> {
    if (!userId) {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id;
    }
    if (!userId) return 'Non authentifié';
    const payload = { ...row, user_id: userId };
    delete (payload as Record<string, unknown>).id;
    if (isOffline()) {
      enqueueMutation('entreprise', 'upsert', payload, undefined, 'Mise à jour entreprise');
      setCached('entreprise', payload);
      return null;
    }
    const { error } = await supabase.from('entreprise').upsert(payload, { onConflict: 'user_id' });
    if (error && isLikelyNetworkError(error)) {
      enqueueMutation('entreprise', 'upsert', payload, undefined, 'Mise à jour entreprise');
      setCached('entreprise', payload);
      return null;
    }
    return error?.message ?? null;
  },

  // Counters
  async incrementDepotCounter(): Promise<{ value: number | null; error: string | null }> {
    const { data, error } = await supabase.rpc('increment_depot_counter');
    if (error) return { value: null, error: error.message };
    return { value: (data as number) ?? null, error: null };
  },

  async nextDepotNumero(): Promise<{ numero: string | null; error: string | null }> {
    if (isOffline()) {
      return { numero: generateOfflineDepotNumero(currentBoutiqueId), error: null };
    }
    try {
      const { data, error } = await supabase.rpc('next_depot_numero', { p_boutique_id: currentBoutiqueId });
      if (error) {
        if (isLikelyNetworkError(error)) {
          return { numero: generateOfflineDepotNumero(currentBoutiqueId), error: null };
        }
        return { numero: null, error: error.message };
      }
      const num = (data as string) ?? null;
      if (num) observeDepotNumeros([{ numero: num }], currentBoutiqueId);
      return { numero: num, error: null };
    } catch {
      return { numero: generateOfflineDepotNumero(currentBoutiqueId), error: null };
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

  async insertAvance(depotId: string, montant: number, modeReglement?: string): Promise<{ data: DepotAvance | null; error: string | null }> {
    const result = await insert<DepotAvance>({
      table: 'depot_avances',
      rows: { depot_id: depotId, montant, mode_reglement: modeReglement ?? null },
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
    return cachedRead(bKey('all_avances', currentBoutiqueId), async () => {
      let q = supabase
        .from('depot_avances')
        .select('*');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        montant: Number(r.montant),
      })) as DepotAvance[];
    }, []);
  },

  // Depenses
  async getAllDepenses(): Promise<Depense[]> {
    return cachedRead(bKey('depenses', currentBoutiqueId), async () => {
      let q = supabase
        .from('depenses')
        .select('*')
        .order('date_depense', { ascending: false });
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        montant: Number(r.montant),
      })) as Depense[];
    }, []);
  },

  async insertDepense(row: { date_depense: string; libelle: string; categorie: string | null; montant: number; mode_reglement: string | null; notes: string | null }): Promise<{ data: Depense | null; error: string | null }> {
    const result = await insert<Depense>({ table: 'depenses', rows: row, select: '*' });
    if (result.data) {
      const d = result.data as unknown as Record<string, unknown>;
      const depense = { ...d, montant: Number(d.montant) } as unknown as Depense;
      optimisticInsertDepense(depense, currentBoutiqueId);
      return { data: depense, error: null };
    }
    return { data: null, error: result.error };
  },

  async updateDepense(id: string, values: { date_depense: string; libelle: string; categorie: string | null; montant: number; mode_reglement: string | null; notes: string | null }): Promise<string | null> {
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
    return cachedRead(bKey('depense_categories', currentBoutiqueId), async () => {
      let q = supabase
        .from('depense_categories')
        .select('*')
        .order('libelle');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      return (data as DepenseCategory[]) ?? [];
    }, []);
  },

  async insertDepenseCategory(libelle: string): Promise<{ data: DepenseCategory | null; error: string | null }> {
    const result = await insert<DepenseCategory>({ table: 'depense_categories', rows: { libelle }, select: '*' });
    return { data: result.data, error: result.error };
  },

  async updateDepenseCategory(id: string, libelle: string): Promise<string | null> {
    const result = await update({ table: 'depense_categories', values: { libelle }, filters: [{ column: 'id', operator: 'eq', value: id }] });
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
      if (error || !data) return [];
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
    return cachedRead('boutiques', async () => {
      const { data, error } = await supabase
        .from('boutiques')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      throwIfNetworkError(error);
      if (error) return [];
      return (data as unknown as Boutique[]) ?? [];
    }, []);
  },

  async insertBoutique(row: { nom: string; adresse?: string | null; ville?: string | null; telephone?: string | null }): Promise<{ data: Boutique | null; error: string | null }> {
    let tId = await getTenantId();
    if (!tId) {
      resetTenantCache();
      tId = await getTenantId();
    }
    if (!tId) {
      return { data: null, error: 'Unable to determine tenant' };
    }
    const { data, error } = await supabase
      .from('boutiques')
      .insert({ ...row, tenant_id: tId })
      .select('*')
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as unknown as Boutique, error: null };
  },

  async updateBoutique(id: string, values: { nom?: string; adresse?: string | null; ville?: string | null; telephone?: string | null; is_default?: boolean }): Promise<string | null> {
    const result = await update({ table: 'boutiques', values, filters: [{ column: 'id', operator: 'eq', value: id }] });
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
    return cachedRead(bKey(`revenue_by_day_${days}`, currentBoutiqueId), async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      since.setHours(0, 0, 0, 0);
      let q = supabase
        .from('depots')
        .select('date_depot, total')
        .gte('date_depot', since.toISOString())
        .not('statut', 'eq', 'COMMANDE')
        .order('date_depot', { ascending: true });
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) return [];
      const map = new Map<string, { revenue: number; count: number }>();
      for (const row of data as { date_depot: string; total: number }[]) {
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
    return cachedRead(bKey(`top_clients_${limit}`, currentBoutiqueId), async () => {
      let q = supabase
        .from('depots')
        .select('total, clients!inner(nom)')
        .not('statut', 'eq', 'COMMANDE');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) return [];
      const map = new Map<string, { totalCA: number; nbDepots: number }>();
      for (const row of data as unknown as { total: number; clients: { nom: string } | { nom: string }[] | null }[]) {
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
    return cachedRead(bKey('payment_breakdown', currentBoutiqueId), async () => {
      let q = supabase
        .from('depots')
        .select('mode_reglement, total')
        .not('statut', 'eq', 'COMMANDE');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) return [];
      const map = new Map<string, { total: number; count: number }>();
      for (const row of data as { mode_reglement: string | null; total: number }[]) {
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
    return cachedRead(bKey('article_stats', currentBoutiqueId), async () => {
      let q = supabase
        .from('depot_articles')
        .select('designation, quantite, nb_pieces, prix_total');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) return [];
      const map = new Map<string, { count: number; revenue: number }>();
      for (const row of data as { designation: string; quantite: number; nb_pieces: number; prix_total: number }[]) {
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
    return cachedRead(bKey('monthly_comparison', currentBoutiqueId), async () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      
      const bid = currentBoutiqueId;
      const [curRes, prevRes, curExpRes, prevExpRes] = await Promise.all([
        supabase.from('depots').select('total').gte('date_depot', startOfMonth.toISOString()).not('statut', 'eq', 'COMMANDE').eq('boutique_id', bid ?? ''),
        supabase.from('depots').select('total').gte('date_depot', startOfPrevMonth.toISOString()).lt('date_depot', startOfMonth.toISOString()).not('statut', 'eq', 'COMMANDE').eq('boutique_id', bid ?? ''),
        supabase.from('depenses').select('montant').gte('date_depense', startOfMonth.toISOString()).eq('boutique_id', bid ?? ''),
        supabase.from('depenses').select('montant').gte('date_depense', startOfPrevMonth.toISOString()).lt('date_depense', startOfMonth.toISOString()).eq('boutique_id', bid ?? ''),
      ]);
      throwIfNetworkError(curRes.error || prevRes.error || curExpRes.error || prevExpRes.error);
      
      return {
        currentMonth: ((curRes.data ?? []) as { total: number }[]).reduce((s, d) => s + Number(d.total), 0),
        previousMonth: ((prevRes.data ?? []) as { total: number }[]).reduce((s, d) => s + Number(d.total), 0),
        currentExpenses: ((curExpRes.data ?? []) as { montant: number }[]).reduce((s, d) => s + Number(d.montant), 0),
        previousExpenses: ((prevExpRes.data ?? []) as { montant: number }[]).reduce((s, d) => s + Number(d.montant), 0),
      };
    }, { currentMonth: 0, previousMonth: 0, currentExpenses: 0, previousExpenses: 0 });
  },

  async getUnpaidTotal(): Promise<{ count: number; total: number }> {
    return cachedRead(bKey('unpaid_total', currentBoutiqueId), async () => {
      let q = supabase
        .from('depots')
        .select('total, avance_amount, mode_reglement')
        .eq('statut', 'EN_COURS');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) return { count: 0, total: 0 };
      let count = 0;
      let total = 0;
      for (const row of data as { total: number; avance_amount: number | null; mode_reglement: string | null }[]) {
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
      let q = supabase.from('fidelite_points').select('client_id, total_points');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error || !data) return {};
      const map: Record<string, number> = {};
      for (const row of data as { client_id: string; total_points: number }[]) {
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

    if (isOffline()) {
      const ptsMap = getScopedCached<Record<string, number>>('all_client_points', currentBoutiqueId) ?? {};
      const nextPts = (ptsMap[clientId] ?? 0) + points;
      setCached(bKey('all_client_points', currentBoutiqueId), { ...ptsMap, [clientId]: nextPts });
      return null;
    }

    const existing = await supabase
      .from('fidelite_points')
      .select('id, total_points')
      .eq('client_id', clientId)
      .maybeSingle();

    if (existing.error && isLikelyNetworkError(existing.error)) {
      return null;
    }

    if (existing.data) {
      const newTotal = Number((existing.data as { total_points: number }).total_points) + points;
      const { error } = await supabase
        .from('fidelite_points')
        .update({ total_points: newTotal, updated_at: new Date().toISOString() })
        .eq('client_id', clientId);
      return error?.message ?? null;
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
      return res.error;
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
    return cachedRead(bKey('consommables', currentBoutiqueId), async () => {
      let q = supabase.from('consommables').select('*').order('nom');
      if (currentBoutiqueId) q = q.eq('boutique_id', currentBoutiqueId);
      const { data, error } = await q;
      throwIfNetworkError(error);
      if (error) return [];
      return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
        ...r,
        quantite: Number(r.quantite),
        seuil_alerte: Number(r.seuil_alerte),
        prix_unitaire: Number(r.prix_unitaire),
      })) as Consommable[];
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
      if (error) return [];
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
    ]);
    markCacheRefreshedNow();
  },
};

// Automatically refresh read caches in the background after queued offline mutations finish syncing
onPostSync(() => {
  void db.prefetchOfflineData();
});

