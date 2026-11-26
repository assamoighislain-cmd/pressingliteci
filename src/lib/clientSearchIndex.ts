import type { Client } from '@/types';

interface IndexedClient {
  client: Client;
  nomNorm: string;
  nomWords: string[];
  telDigits: string;
  telLower: string;
  codeNorm: string;
}

const indexCache = new WeakMap<Client[], IndexedClient[]>();

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extractDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function getOrBuildIndex(clients: Client[]): IndexedClient[] {
  const cached = indexCache.get(clients);
  if (cached) return cached;

  const built: IndexedClient[] = new Array(clients.length);
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const nomNorm = normalizeSearchText(client.nom ?? '');
    const telRaw = client.telephone ?? '';
    built[i] = {
      client,
      nomNorm,
      nomWords: nomNorm ? nomNorm.split(/\s+/) : [],
      telDigits: extractDigits(telRaw),
      telLower: telRaw.toLowerCase(),
      codeNorm: normalizeSearchText(client.code ?? ''),
    };
  }
  indexCache.set(clients, built);
  return built;
}

/**
 * Instant (<1ms for 4,000-20,000 clients) accent-insensitive, phone-format-insensitive,
 * multi-token client search with relevance ranking.
 */
export function searchClientsIndexed(
  clients: Client[],
  rawTerm: string,
  limit = 15,
): Client[] {
  const normTerm = normalizeSearchText(rawTerm);
  if (!normTerm || clients.length === 0) return [];

  const index = getOrBuildIndex(clients);
  const tokens = normTerm.split(/\s+/).filter(Boolean);
  const queryDigits = extractDigits(rawTerm);
  const isSingleToken = tokens.length === 1;

  // Buckets by match tier (0 = best, 3 = substring) to avoid sorting all 4,000 entries
  const tier0: Client[] = [];
  const tier1: Client[] = [];
  const tier2: Client[] = [];
  const tier3: Client[] = [];

  for (let i = 0; i < index.length; i++) {
    const entry = index[i];

    if (isSingleToken) {
      const q = tokens[0];
      const matchesCode = entry.codeNorm.includes(q);
      const matchesNom = entry.nomNorm.includes(q);
      const matchesTel =
        (queryDigits.length >= 2 && entry.telDigits.includes(queryDigits)) ||
        entry.telLower.includes(q);

      if (!matchesCode && !matchesNom && !matchesTel) continue;

      if (entry.codeNorm === q || entry.nomNorm === q || (queryDigits.length >= 6 && entry.telDigits === queryDigits)) {
        tier0.push(entry.client);
      } else if (entry.nomNorm.startsWith(q) || entry.codeNorm.startsWith(q)) {
        tier1.push(entry.client);
      } else if (
        entry.nomWords.some((w) => w.startsWith(q)) ||
        (queryDigits.length >= 2 && entry.telDigits.startsWith(queryDigits))
      ) {
        tier2.push(entry.client);
      } else if (tier0.length + tier1.length + tier2.length + tier3.length < limit * 2) {
        tier3.push(entry.client);
      }
    } else {
      // Multi-token: every token must match name, code, or phone
      let allMatch = true;
      for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        const tokDigits = extractDigits(tok);
        const ok =
          entry.nomNorm.includes(tok) ||
          entry.codeNorm.includes(tok) ||
          entry.telLower.includes(tok) ||
          (tokDigits.length >= 2 && entry.telDigits.includes(tokDigits));
        if (!ok) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;

      if (entry.nomNorm.startsWith(normTerm)) {
        tier0.push(entry.client);
      } else if (entry.nomNorm.startsWith(tokens[0])) {
        tier1.push(entry.client);
      } else if (entry.nomWords.some((w) => w.startsWith(tokens[0]))) {
        tier2.push(entry.client);
      } else if (tier0.length + tier1.length + tier2.length + tier3.length < limit * 2) {
        tier3.push(entry.client);
      }
    }
  }

  const results: Client[] = [];
  const buckets = [tier0, tier1, tier2, tier3];
  for (let b = 0; b < buckets.length && results.length < limit; b++) {
    const bucket = buckets[b];
    for (let j = 0; j < bucket.length && results.length < limit; j++) {
      results.push(bucket[j]);
    }
  }
  return results;
}
