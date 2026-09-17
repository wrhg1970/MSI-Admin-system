import { Policy, PolicyLetter, InsuranceRequest } from '../types';
import { format } from 'date-fns';

/**
 * Converts any date format (YYYY-MM-DD, DD/MM/YYYY, ISO timestamp, Firestore Timestamp)
 * into a standard YYYY-MM-DD string for reliable date range filtering and string comparisons.
 */
export function getNormalizedYYYYMMDD(rawDate: any): string {
  if (!rawDate) return '';
  if (typeof rawDate === 'object' && typeof rawDate.toDate === 'function') {
    try {
      return format(rawDate.toDate(), 'yyyy-MM-dd');
    } catch (_) {}
  }
  if (typeof rawDate === 'object' && rawDate.seconds !== undefined) {
    try {
      return format(new Date(rawDate.seconds * 1000), 'yyyy-MM-dd');
    } catch (_) {}
  }
  const str = String(rawDate).trim();
  if (!str) return '';

  // 1. Standard YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  if (/^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(str)) {
    return str.substring(0, 10).replace(/\//g, '-');
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/);
  if (dmyMatch) {
    let p1 = parseInt(dmyMatch[1], 10);
    let p2 = parseInt(dmyMatch[2], 10);
    const year = dmyMatch[3];
    let day = p1;
    let month = p2;
    if (p1 <= 12 && p2 > 12) {
      month = p1;
      day = p2;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // 3. Fallback to JS Date
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return format(parsed, 'yyyy-MM-dd');
    }
  } catch (_) {}

  return '';
}

export const SPANISH_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export const SPANISH_MONTHS_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

/**
 * Formats any raw request/created/policy date safely into DD/Mes/YYYY display format (e.g. 12/Ago/2026).
 */
export function formatDisplayDate(rawDate: any): string {
  const ymd = getNormalizedYYYYMMDD(rawDate);
  if (!ymd) return '-';
  const parts = ymd.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const mIdx = parseInt(parts[1], 10) - 1;
    const day = parts[2];
    if (mIdx >= 0 && mIdx < 12) {
      return `${day}/${SPANISH_MONTHS_SHORT[mIdx]}/${year}`;
    }
    return `${day}/${parts[1]}/${year}`;
  }
  return ymd;
}

/**
 * Formats the policy number according to the rules:
 * - If the policy has a CodigoPoliza set, use it.
 * - Otherwise, map the policy name to its standard code if empty (as fallback for seeded/standard ones).
 * - Append age-based suffix: -UNDER25 for age < 25, and -OVER25 for age >= 25.
 */
export function getPolicyNumber(policy: Policy | undefined, age: number): string {
  let code = policy?.CodigoPoliza || '';

  // Fallback mapping in case the database field isn't set yet (for the standard/seeded ones)
  if (!code && policy?.name) {
    const nameLower = policy.name.toLowerCase();
    if (nameLower.includes('platinum') || nameLower.includes('platino')) {
      code = '26 CC015658';
    } else if (nameLower.includes('bronce') && nameLower.includes('con deducible')) {
      code = '26 CC015653';
    } else if (nameLower.includes('oro') && nameLower.includes('sin deducible')) {
      code = '26 CC015654';
    } else if (nameLower.includes('oro') && nameLower.includes('con deducible')) {
      code = '26 CC015655';
    } else if (nameLower.includes('plata') && nameLower.includes('con deducible')) {
      code = '26 CC015656';
    } else if (nameLower.includes('plata') && nameLower.includes('sin deducible')) {
      code = '26 CC015657';
    }
  }

  // Final fallback to policy ID if no code found
  if (!code) {
    code = policy?.id || '';
  }

  if (!code) return '';

  // Return as is if it already contains the suffix to avoid double suffixing
  if (code.endsWith('-UNDER25') || code.endsWith('-OVER25')) {
    return code;
  }

  const suffix = age < 25 ? '-UNDER25' : '-OVER25';
  return `${code}${suffix}`;
}

function getPolicyTier(nameOrId: string | undefined): string {
  if (!nameOrId) return '';
  const val = nameOrId.toLowerCase();
  if (val.includes('platinum') || val.includes('platino')) return 'platinum';
  if (val.includes('oro') || val.includes('gold')) return 'oro';
  if (val.includes('plata') || val.includes('silver')) return 'plata';
  if (val.includes('bronce') || val.includes('bronze')) return 'bronce';
  return '';
}

/**
 * Resolves a policy document from a variety of potential identifiers (ID, Code, Name)
 * using a strict priority order (direct ID first, then code, then name) to prevent
 * incorrect resolutions when multiple policies share code or name fragments.
 */
export function findPolicyPrioritized(
  policyIdentifier: string | undefined,
  policies: Policy[]
): Policy | undefined {
  if (!policyIdentifier) return undefined;

  const cleanVal = (val: string | undefined): string => {
    if (!val) return '';
    return val.replace(/-UNDER25$/i, '').replace(/-OVER25$/i, '').trim().toLowerCase();
  };

  const idToFind = cleanVal(policyIdentifier);
  if (!idToFind) return undefined;

  // Tier 1: Exact direct ID match (the most specific and correct way)
  let found = policies.find(p => p.id && cleanVal(p.id) === idToFind);
  if (found) return found;

  // Tier 2: Exact CodigoPoliza match
  found = policies.find(p => p.CodigoPoliza && cleanVal(p.CodigoPoliza) === idToFind);
  if (found) return found;

  // Tier 3: Exact Name/NombrePoliza match
  found = policies.find(p => {
    const pName = cleanVal(p.name);
    const pNombre = cleanVal(p.NombrePoliza);
    return (pName && pName === idToFind) || (pNombre && pNombre === idToFind);
  });
  if (found) return found;

  // Tier 4: Relaxed fallback match
  found = policies.find(p => {
    const pId = cleanVal(p.id);
    const pCodigo = cleanVal(p.CodigoPoliza);
    const pName = cleanVal(p.name);
    const pNombre = cleanVal(p.NombrePoliza);
    return (
      (pId && pId.includes(idToFind)) ||
      (pCodigo && pCodigo.includes(idToFind)) ||
      (pName && pName.includes(idToFind)) ||
      (pNombre && pNombre.includes(idToFind))
    );
  });

  return found;
}

/**
 * Checks if an insurance request has Spain as destination country.
 */
export function isSpainDestination(destinationCountry?: string | null): boolean {
  if (!destinationCountry) return false;
  const normalized = destinationCountry
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // removes ñ accents -> espana

  return (
    normalized === 'es' ||
    normalized === 'esp' ||
    normalized === 'espana' ||
    normalized === 'spain' ||
    normalized.includes('espana') ||
    normalized.includes('spain')
  );
}

/**
 * Finds all available policy letters (templates) for a given insurance request.
 * It uses a multi-layered fallback strategy and de-duplicates letters by language
 * based on match priority to prevent duplicate templates from appearing.
 */
export function getAvailableLettersForInsurance(
  insurance: InsuranceRequest | undefined,
  policyLetters: PolicyLetter[],
  policies: Policy[]
): PolicyLetter[] {
  if (!insurance) return [];

  // Helper to normalize and strip -UNDER25 or -OVER25 suffix
  const clean = (val: string | undefined): string => {
    if (!val) return '';
    return val.replace(/-UNDER25$/i, '').replace(/-OVER25$/i, '').trim().toLowerCase();
  };

  const insPolicyIdClean = clean(insurance.policyId);
  const insPolicyNumClean = clean(insurance.policyNumber);
  const insPolicyNameClean = clean(insurance.policyName);

  // 1. Find the actual policy document of the insurance using strict priorities to prevent mis-association when policies share the same CodigoPoliza in DB
  let policy = findPolicyPrioritized(insurance.policyId, policies);
  if (!policy) {
    policy = findPolicyPrioritized(insurance.policyNumber, policies);
  }
  if (!policy) {
    policy = findPolicyPrioritized(insurance.policyName, policies);
  }

  const actualPolicyId = policy ? policy.id : insurance.policyId;
  const actualPolicyIdClean = clean(actualPolicyId);

  // 2. Score and filter letters
  const scoredLetters = policyLetters
    .map(l => {
      if (!l.policyId) return { letter: l, priority: Infinity };
      const lPolicyIdClean = clean(l.policyId);

      let priority = Infinity;

      // Priority 1: Direct match with resolved policy ID or raw policyId
      if (lPolicyIdClean === actualPolicyIdClean || lPolicyIdClean === insPolicyIdClean) {
        priority = 1;
      }
      // Priority 2: Direct match with policy code
      else if (policy && lPolicyIdClean === clean(policy.CodigoPoliza)) {
        priority = 2;
      }
      // Priority 3: Direct match with policy name
      else if (policy && (lPolicyIdClean === clean(policy.name) || lPolicyIdClean === clean(policy.NombrePoliza))) {
        priority = 3;
      }
      else {
        // Resolve the policy that is linked to the letter
        const letterPolicy = policies.find(p => {
          const pId = clean(p.id);
          const pCodigo = clean(p.CodigoPoliza);
          const pName = clean(p.name);
          const pNombre = clean(p.NombrePoliza);
          return pId === lPolicyIdClean || pCodigo === lPolicyIdClean || pName === lPolicyIdClean || pNombre === lPolicyIdClean;
        });

        if (letterPolicy) {
          // Priority 4: Letter's resolved policy matches target policy ID
          if (clean(letterPolicy.id) === actualPolicyIdClean || (policy && clean(letterPolicy.id) === clean(policy.id))) {
            priority = 4;
          }
          // Priority 5: Match of the letter's policy name with the insurance policy name
          else if (
            insurance.policyName &&
            ((letterPolicy.name && clean(letterPolicy.name) === insPolicyNameClean) ||
             (letterPolicy.NombrePoliza && clean(letterPolicy.NombrePoliza) === insPolicyNameClean))
          ) {
            priority = 5;
          }
          // Priority 6: Check structural equivalence (Plan, deductible, region)
          else if (policy) {
            const plansMatch = letterPolicy.plan && policy.plan && clean(letterPolicy.plan) === clean(policy.plan);
            const deductiblesMatch = letterPolicy.deductible === policy.deductible;
            const regionsMatch = letterPolicy.region === policy.region;
            const letterPolicyTier = getPolicyTier(letterPolicy.name || letterPolicy.NombrePoliza || letterPolicy.id);
            const policyTier = getPolicyTier(policy.name || policy.NombrePoliza || policy.id);
            const tierMatch = letterPolicyTier === policyTier;
            if (plansMatch && deductiblesMatch && regionsMatch && tierMatch) {
              priority = 6;
            }
          }
        }
        // Priority 7: String match fallback
        else if (insurance.policyName && lPolicyIdClean === insPolicyNameClean) {
          priority = 7;
        }
      }

      return { letter: l, priority };
    })
    .filter(item => item.priority !== Infinity);

  // 3. Group by normalized language and keep the highest priority letter (lowest priority number)
  const languageGroups = new Map<string, typeof scoredLetters[0]>();

  scoredLetters.forEach(item => {
    const lang = (item.letter.language || 'es').toLowerCase().trim();
    const existing = languageGroups.get(lang);
    if (!existing || item.priority < existing.priority) {
      languageGroups.set(lang, item);
    }
  });

  const hasSpainDest = isSpainDestination(insurance.destinationCountry);

  if (hasSpainDest) {
    // If no explicit 'es_spain' or 'embajada_spain' letter exists for this policy, derive them from 'es' or first available
    if (!languageGroups.has('es_spain')) {
      const esItem = languageGroups.get('es') || Array.from(languageGroups.values())[0];
      if (esItem) {
        const derivedSpainLetter: PolicyLetter = {
          ...esItem.letter,
          id: `${esItem.letter.id || 'default'}_es_spain`,
          language: 'es_spain',
          title: esItem.letter.title && esItem.letter.title !== 'A quien corresponda'
            ? esItem.letter.title
            : 'CERTIFICADO DE COBERTURA / ESPAÑA',
        };
        languageGroups.set('es_spain', { letter: derivedSpainLetter, priority: esItem.priority + 0.1 });
      }
    }

    if (!languageGroups.has('embajada_spain')) {
      const esItem = languageGroups.get('es') || Array.from(languageGroups.values())[0];
      if (esItem) {
        const derivedEmbajadaLetter: PolicyLetter = {
          ...esItem.letter,
          id: `${esItem.letter.id || 'default'}_embajada_spain`,
          language: 'embajada_spain',
          title: 'CERTIFICADO DE COBERTURA / EMBAJADA DE ESPAÑA',
        };
        languageGroups.set('embajada_spain', { letter: derivedEmbajadaLetter, priority: esItem.priority + 0.2 });
      }
    }
  } else {
    // Destination is not Spain: remove Spain & Embassy of Spain letters so they only appear when destination is Spain
    languageGroups.delete('es_spain');
    languageGroups.delete('embajada_spain');
  }

  // Return the best letter for each language
  return Array.from(languageGroups.values()).map(item => item.letter);
}

/**
 * Normalizes a string by trimming, converting to lower case, removing diacritics, and collapsing spaces.
 */
export function normalizeDuplicateField(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, ' '); // normalize spaces
}

export interface DuplicateGroup {
  key: string;
  sharedInfo: {
    actionType: string;
    fullName: string;
    birthDate: string;
    startDate: string;
    originCountry: string;
    destinationCountry: string;
    plan: string;
    policyName: string;
    sampleInsurance: InsuranceRequest;
  };
  items: InsuranceRequest[];
}

/**
 * Generates the grouping key for identifying duplicate policies based on:
 * 1. Tipo de accion
 * 2. Nombre Completo
 * 3. Fecha de nacimiento
 * 4. Fecha de inicio
 * 5. Origen
 * 6. Destino
 * 7. Plan
 * 8. Poliza
 */
export function getDuplicatePolicyKey(ins: InsuranceRequest, policies: Policy[] = [], policyMap?: Map<string, Policy>): string {
  const policy = policyMap ? policyMap.get(ins.policyId) : policies.find(p => p.id === ins.policyId);
  const actionType = normalizeDuplicateField(ins.actionType || 'NEW').toUpperCase();
  const fullName = normalizeDuplicateField(`${ins.firstName || ''} ${ins.lastName || ''}`);
  const birthDate = getNormalizedYYYYMMDD(ins.birthDate) || normalizeDuplicateField(ins.birthDate);
  const startDate = getNormalizedYYYYMMDD(ins.startDate) || normalizeDuplicateField(ins.startDate);
  const origin = normalizeDuplicateField(ins.originCountry);
  const destination = normalizeDuplicateField(ins.destinationCountry);
  const plan = normalizeDuplicateField(ins.plan || policy?.plan || ins.subcategoryName || (ins.policyId ? ins.policyId.split('-')[0] : ''));
  const poliza = normalizeDuplicateField(ins.policyName || policy?.name || ins.policyNumber || ins.policyId || '');

  return `${actionType}|${fullName}|${birthDate}|${startDate}|${origin}|${destination}|${plan}|${poliza}`;
}

export function findDuplicatePolicyGroups(insurances: InsuranceRequest[], policies: Policy[] = []): DuplicateGroup[] {
  const policyMap = new Map<string, Policy>();
  policies.forEach(p => {
    if (p.id) policyMap.set(p.id, p);
  });

  const map = new Map<string, InsuranceRequest[]>();

  insurances.forEach(ins => {
    const key = getDuplicatePolicyKey(ins, policies, policyMap);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(ins);
  });

  const duplicateGroups: DuplicateGroup[] = [];

  map.forEach((items, key) => {
    if (items.length > 1) {
      const sample = items[0];
      const policy = policyMap.get(sample.policyId);
      const actionType = (sample.actionType || 'NEW').toUpperCase();
      const fullName = `${sample.firstName || ''} ${sample.lastName || ''}`.trim();
      const birthDate = sample.birthDate || '';
      const startDate = sample.startDate || '';
      const originCountry = sample.originCountry || '';
      const destinationCountry = sample.destinationCountry || '';
      const plan = sample.plan || policy?.plan || sample.subcategoryName || (sample.policyId ? sample.policyId.split('-')[0] : '');
      const policyName = sample.policyName || policy?.name || sample.policyNumber || sample.policyId || '';

      duplicateGroups.push({
        key,
        sharedInfo: {
          actionType,
          fullName,
          birthDate,
          startDate,
          originCountry,
          destinationCountry,
          plan,
          policyName,
          sampleInsurance: sample,
        },
        // Sort items by request/created date descending so the newest is at the top
        items: [...items].sort((a, b) => {
          const dateA = a.requestDate || (a.createdAt?.toDate ? a.createdAt.toDate().toISOString() : a.createdAt ? new Date(a.createdAt).toISOString() : '');
          const dateB = b.requestDate || (b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : b.createdAt ? new Date(b.createdAt).toISOString() : '');
          return dateB.localeCompare(dateA);
        })
      });
    }
  });

  return duplicateGroups;
}

/**
 * Calculates the effective provider cost for a policy:
 * - If cost is positive and not CAN, it is positive (sums).
 * - If cost is negative, it is negative (subtracts).
 * - If actionType is 'CAN' (cancellation), cost is negative (subtracts).
 */
export function getPolicyEffectiveCost(ins: { totalCost?: number; actionType?: string } | null | undefined): number {
  if (!ins) return 0;
  const rawCost = Number(ins.totalCost) || 0;
  const isCan = ins.actionType?.toUpperCase() === 'CAN';
  if (isCan) {
    return -Math.abs(rawCost);
  }
  return rawCost;
}
