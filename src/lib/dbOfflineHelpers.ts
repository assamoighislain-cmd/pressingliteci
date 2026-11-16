import { getCached, setCached, updateCached } from '@/lib/readCache';
import type {
  ArticleCatalog,
  Client,
  Consommable,
  Depense,
  Depot,
  DepotArticle,
  DepotAvance,
  DepotWithArticles,
  DepotWithClient,
  TypeTraitement,
} from '@/types';

export const UUID_PK_TABLES = new Set<string>([
  'clients',
  'types_traitement',
  'articles',
  'depots',
  'depot_articles',
  'depot_avances',
  'depenses',
  'depense_categories',
  'article_variants',
  'fidelite_points',
  'fidelite_history',
  'bons_reduction',
  'consommables',
  'consommable_mouvements',
  'relances',
]);

export function bKey(base: string, boutiqueId: string | null): string {
  return boutiqueId ? `${base}_${boutiqueId}` : base;
}

export function getScopedCached<T>(base: string, boutiqueId: string | null): T | null {
  const scoped = getCached<T>(bKey(base, boutiqueId));
  if (scoped !== null) return scoped;
  return getCached<T>(base);
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parsePrefixedNumber(val: string | null | undefined, prefix: string): number {
  if (!val || !val.startsWith(prefix)) return 0;
  const numPart = val.slice(prefix.length).trim();
  if (!/^\d+$/.test(numPart)) return 0;
  return parseInt(numPart, 10) || 0;
}

function getStoredMaxSeq(counterKey: string): number {
  try {
    return parseInt(localStorage.getItem(`offline_seq_${counterKey}`) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function setStoredMaxSeq(counterKey: string, value: number): void {
  try {
    const cur = getStoredMaxSeq(counterKey);
    if (value > cur) {
      localStorage.setItem(`offline_seq_${counterKey}`, String(value));
    }
  } catch {
    // Ignore
  }
}

export function observeDepotNumeros(
  depots: Array<{ numero?: string | null }>,
  boutiqueId: string | null,
): void {
  const key = `depot_${boutiqueId ?? 'global'}`;
  let max = 0;
  for (const d of depots) {
    const n = parsePrefixedNumber(d.numero, 'D-');
    if (n > max) max = n;
  }
  if (max > 0) setStoredMaxSeq(key, max);
}

export function observeClientCodes(
  clients: Array<{ code?: string | null }>,
  boutiqueId: string | null,
): void {
  const key = `client_${boutiqueId ?? 'global'}`;
  let max = 0;
  for (const c of clients) {
    const n = parsePrefixedNumber(c.code, 'C-');
    if (n > max) max = n;
  }
  if (max > 0) setStoredMaxSeq(key, max);
}

export function observeArticleCodes(
  articles: Array<{ code?: string | null }>,
  boutiqueId: string | null,
): void {
  const key = `article_${boutiqueId ?? 'global'}`;
  let max = 0;
  for (const a of articles) {
    const n = parsePrefixedNumber(a.code, 'A-');
    if (n > max) max = n;
  }
  if (max > 0) setStoredMaxSeq(key, max);
}

export function observeTraitementCodes(
  traitements: Array<{ code?: string | null }>,
  boutiqueId: string | null,
): void {
  const key = `traitement_${boutiqueId ?? 'global'}`;
  let max = 0;
  for (const t of traitements) {
    const n = parsePrefixedNumber(t.code, 'T-');
    if (n > max) max = n;
  }
  if (max > 0) setStoredMaxSeq(key, max);
}

/**
 * Generates a sequential D-XXXX number strictly matching Postgres `next_depot_numero`
 * (`CAST(REPLACE(numero, 'D-', '') AS integer)`).
 */
export function generateOfflineDepotNumero(boutiqueId: string | null): string {
  const key = `depot_${boutiqueId ?? 'global'}`;
  const cachedAll = getScopedCached<DepotWithArticles[]>('all_depots', boutiqueId) ?? [];
  const cachedRecent = getScopedCached<DepotWithClient[]>('recent_depots', boutiqueId) ?? [];
  observeDepotNumeros(cachedAll, boutiqueId);
  observeDepotNumeros(cachedRecent, boutiqueId);

  const next = getStoredMaxSeq(key) + 1;
  setStoredMaxSeq(key, next);
  return `D-${String(next).padStart(4, '0')}`;
}

export function generateOfflineRpcCode(fnName: string, boutiqueId: string | null): string | null {
  if (fnName === 'generate_client_code') {
    const cached = getScopedCached<Client[]>('all_clients', boutiqueId) ?? [];
    observeClientCodes(cached, boutiqueId);
    const key = `client_${boutiqueId ?? 'global'}`;
    const next = getStoredMaxSeq(key) + 1;
    setStoredMaxSeq(key, next);
    return `C-${String(next).padStart(4, '0')}`;
  }
  if (fnName === 'generate_article_code') {
    const cached = getScopedCached<ArticleCatalog[]>('articles', boutiqueId) ?? [];
    observeArticleCodes(cached, boutiqueId);
    const key = `article_${boutiqueId ?? 'global'}`;
    const next = getStoredMaxSeq(key) + 1;
    setStoredMaxSeq(key, next);
    return `A-${String(next).padStart(4, '0')}`;
  }
  if (fnName === 'generate_traitement_code') {
    const cached = getScopedCached<TypeTraitement[]>('types_traitement', boutiqueId) ?? [];
    observeTraitementCodes(cached, boutiqueId);
    const key = `traitement_${boutiqueId ?? 'global'}`;
    const next = getStoredMaxSeq(key) + 1;
    setStoredMaxSeq(key, next);
    return `T-${String(next).padStart(4, '0')}`;
  }
  return null;
}

export function prepareOfflineInsertRows(
  table: string,
  rows: Record<string, unknown>[],
): { dbRows: Record<string, unknown>[]; optimisticRows: Record<string, unknown>[] } {
  const now = new Date().toISOString();
  const dbRows: Record<string, unknown>[] = [];
  const optimisticRows: Record<string, unknown>[] = [];

  for (const r of rows) {
    const dbRow: Record<string, unknown> = { ...r };
    if (UUID_PK_TABLES.has(table) && !dbRow.id) {
      dbRow.id = generateUuid();
    }
    const optRow: Record<string, unknown> = {
      ...dbRow,
      id: dbRow.id ?? Date.now(),
      created_at: dbRow.created_at ?? now,
    };
    if (table === 'clients') {
      optRow.portal_code = optRow.portal_code ?? Math.random().toString(36).slice(2, 8).toUpperCase();
    }
    if (table === 'depot_avances') {
      optRow.date_paiement = optRow.date_paiement ?? now;
    }
    if (table === 'bons_reduction') {
      optRow.actif = optRow.actif ?? true;
      optRow.usage_count = optRow.usage_count ?? 0;
    }
    if (table === 'relances') {
      optRow.date_relance = optRow.date_relance ?? now;
    }
    dbRows.push(dbRow);
    optimisticRows.push(optRow);
  }

  return { dbRows, optimisticRows };
}

export function buildMutationLabel(
  table: string,
  op: 'insert' | 'update' | 'upsert' | 'delete',
  data: Record<string, unknown>,
): string {
  if (table === 'clients') {
    if (op === 'insert') return `Nouveau client : ${String(data.nom ?? '')}`;
    if (op === 'update') return `Modification client : ${String(data.nom ?? '')}`;
    if (op === 'delete') return 'Suppression client';
  }
  if (table === 'depots') {
    if (op === 'insert') return `Nouveau dépôt ${String(data.numero ?? '')}`.trim();
    if (op === 'update') {
      if (data.statut === 'RETIRE') return 'Retrait de dépôt';
      return 'Mise à jour dépôt';
    }
    if (op === 'delete') return 'Suppression dépôt';
  }
  if (table === 'depot_articles') {
    if (op === 'insert') return `Article dépôt : ${String(data.designation ?? '')}`;
    if (op === 'update') return 'Mise à jour article dépôt';
  }
  if (table === 'depot_avances') {
    return `Règlement / Avance (${Number(data.montant ?? 0).toLocaleString('fr-FR')} FCFA)`;
  }
  if (table === 'depenses') {
    if (op === 'insert') return `Nouvelle dépense : ${String(data.libelle ?? '')}`;
    if (op === 'update') return `Modification dépense : ${String(data.libelle ?? '')}`;
    if (op === 'delete') return 'Suppression dépense';
  }
  if (table === 'articles') {
    if (op === 'insert') return `Nouvel article : ${String(data.designation ?? '')}`;
    if (op === 'update') return `Modification article : ${String(data.designation ?? '')}`;
    if (op === 'delete') return 'Suppression article';
  }
  if (table === 'consommables' || table === 'consommable_mouvements') {
    return 'Mouvement de stock consommable';
  }
  const verb = op === 'insert' ? 'Ajout' : op === 'update' ? 'Modification' : op === 'delete' ? 'Suppression' : 'Mise à jour';
  return `${verb} (${table})`;
}

// ─── Optimistic local read-cache updaters ──────────────────

export function optimisticUpsertClient(client: Client, boutiqueId: string | null): void {
  const key = bKey('all_clients', boutiqueId);
  updateCached<Client[]>(key, (list) => {
    const base = list ?? getCached<Client[]>('all_clients') ?? [];
    const idx = base.findIndex((c) => c.id === client.id);
    const next = idx >= 0 ? base.map((c, i) => (i === idx ? { ...c, ...client } : c)) : [...base, client];
    return next.sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? ''));
  });
}

export function optimisticPatchClient(
  id: string,
  values: Partial<Client>,
  boutiqueId: string | null,
): void {
  const key = bKey('all_clients', boutiqueId);
  updateCached<Client[]>(key, (list) => {
    const base = list ?? getCached<Client[]>('all_clients');
    if (!base) return null;
    return base.map((c) => (c.id === id ? { ...c, ...values } : c));
  });
}

export function optimisticRemoveClient(id: string, boutiqueId: string | null): void {
  const key = bKey('all_clients', boutiqueId);
  updateCached<Client[]>(key, (list) => {
    const base = list ?? getCached<Client[]>('all_clients');
    return base ? base.filter((c) => c.id !== id) : null;
  });
}

export function optimisticUpsertArticle(article: ArticleCatalog, boutiqueId: string | null): void {
  const key = bKey('articles', boutiqueId);
  updateCached<ArticleCatalog[]>(key, (list) => {
    const base = list ?? getCached<ArticleCatalog[]>('articles') ?? [];
    const idx = base.findIndex((a) => a.id === article.id);
    const next = idx >= 0 ? base.map((a, i) => (i === idx ? { ...a, ...article } : a)) : [...base, article];
    return next.sort((a, b) => (a.designation ?? '').localeCompare(b.designation ?? ''));
  });
}

export function optimisticInsertDepot(depot: Depot, boutiqueId: string | null): void {
  const clients = getScopedCached<Client[]>('all_clients', boutiqueId) ?? [];
  const matchedClient = clients.find((c) => c.id === depot.client_id);
  const clientRel = matchedClient
    ? {
        nom: matchedClient.nom,
        telephone: matchedClient.telephone ?? '',
        portal_code: matchedClient.portal_code,
      }
    : { nom: 'Client', telephone: '' };

  const withArticles: DepotWithArticles = {
    ...depot,
    articles: [],
    client: clientRel,
    clients: clientRel,
  };
  const withClient: DepotWithClient = {
    ...depot,
    clients: clientRel,
  };

  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), (cur) => [
    withArticles,
    ...(cur ?? []),
  ]);
  if (depot.statut === 'EN_COURS') {
    updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), (cur) => [
      withArticles,
      ...(cur ?? []),
    ]);
  }
  updateCached<DepotWithClient[]>(bKey('recent_depots', boutiqueId), (cur) =>
    [withClient, ...(cur ?? [])].slice(0, 8),
  );
  updateCached<DepotWithClient[]>(bKey('depots_planning', boutiqueId), (cur) => [
    withClient,
    ...(cur ?? []),
  ]);
}

export function optimisticAttachDepotArticles(
  rows: Record<string, unknown>[],
  boutiqueId: string | null,
): void {
  if (!rows.length) return;
  const depotId = String(rows[0].depot_id ?? '');
  if (!depotId) return;

  const now = new Date().toISOString();
  const normalized: DepotArticle[] = rows.map((a) => ({
    id: String(a.id ?? generateUuid()),
    depot_id: depotId,
    article_id: (a.article_id as string | null) ?? null,
    designation: String(a.designation ?? ''),
    prix_unitaire: Number(a.prix_unitaire ?? 0),
    prix_traitement: Number(a.prix_traitement ?? 0),
    quantite: Number(a.quantite ?? 1),
    nb_pieces: Number(a.nb_pieces ?? 1),
    couleur: String(a.couleur ?? ''),
    marque: String(a.marque ?? ''),
    signe_particulier: String(a.signe_particulier ?? ''),
    griffe: String(a.griffe ?? ''),
    emplacement: String(a.emplacement ?? ''),
    checked_out: Boolean(a.checked_out ?? false),
    date_retrait: (a.date_retrait as string | null) ?? null,
    photo_url: (a.photo_url as string | null) ?? null,
    prix_total: Number(a.prix_total ?? 0),
    created_at: String(a.created_at ?? now),
  }));

  const attach = (list: DepotWithArticles[] | null): DepotWithArticles[] | null => {
    if (!list) return null;
    return list.map((d) =>
      d.id === depotId ? { ...d, articles: [...(d.articles ?? []), ...normalized] } : d,
    );
  };

  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), attach);
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), attach);
}

export function optimisticPatchDepot(
  id: string,
  values: Record<string, unknown>,
  boutiqueId: string | null,
): void {
  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithArticles) : d)) : null,
  );
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), (list) => {
    if (!list) return null;
    if (values.statut && values.statut !== 'EN_COURS') {
      return list.filter((d) => d.id !== id);
    }
    return list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithArticles) : d));
  });
  updateCached<DepotWithClient[]>(bKey('recent_depots', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithClient) : d)) : null,
  );
  updateCached<DepotWithClient[]>(bKey('depots_planning', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? ({ ...d, ...values } as DepotWithClient) : d)) : null,
  );
}

export function optimisticRemoveDepot(id: string, boutiqueId: string | null): void {
  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
  updateCached<DepotWithClient[]>(bKey('recent_depots', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
  updateCached<DepotWithClient[]>(bKey('depots_planning', boutiqueId), (l) =>
    l ? l.filter((d) => d.id !== id) : null,
  );
}

export function optimisticPatchDepotArticle(
  articleRowId: string,
  values: Record<string, unknown>,
  boutiqueId: string | null,
): void {
  const patchList = (list: DepotWithArticles[] | null): DepotWithArticles[] | null => {
    if (!list) return null;
    return list.map((d) => ({
      ...d,
      articles: (d.articles ?? []).map((a) =>
        a.id === articleRowId ? ({ ...a, ...values } as DepotArticle) : a,
      ),
    }));
  };
  updateCached<DepotWithArticles[]>(bKey('all_depots', boutiqueId), patchList);
  updateCached<DepotWithArticles[]>(bKey('depots_retrait', boutiqueId), patchList);
}

export function optimisticInsertAvance(avance: DepotAvance, boutiqueId: string | null): void {
  updateCached<DepotAvance[]>(bKey('all_avances', boutiqueId), (list) => [
    ...(list ?? []),
    avance,
  ]);
}

export function optimisticInsertDepense(depense: Depense, boutiqueId: string | null): void {
  updateCached<Depense[]>(bKey('depenses', boutiqueId), (list) => [depense, ...(list ?? [])]);
}

export function optimisticPatchDepense(
  id: string,
  values: Partial<Depense>,
  boutiqueId: string | null,
): void {
  updateCached<Depense[]>(bKey('depenses', boutiqueId), (list) =>
    list ? list.map((d) => (d.id === id ? { ...d, ...values } : d)) : null,
  );
}

export function optimisticRemoveDepense(id: string, boutiqueId: string | null): void {
  updateCached<Depense[]>(bKey('depenses', boutiqueId), (list) =>
    list ? list.filter((d) => d.id !== id) : null,
  );
}

export function optimisticAdjustConsommable(
  consommableId: string,
  delta: number,
  boutiqueId: string | null,
): void {
  const key = bKey('consommables', boutiqueId);
  const current = getScopedCached<Consommable[]>('consommables', boutiqueId);
  if (!current) return;
  setCached(
    key,
    current.map((c) =>
      c.id === consommableId ? { ...c, quantite: Math.max(0, Number(c.quantite) + delta) } : c,
    ),
  );
}
