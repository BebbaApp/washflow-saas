type FactorMap = Record<string, number>;

const GROUPS: FactorMap[] = [
  // Volume — base: liter
  { L: 1, l: 1, ml: 0.001, mL: 0.001 },
  // Mass — base: kilogram
  { kg: 1, g: 0.001, mg: 0.000001 },
];

function findGroup(unit: string): FactorMap | null {
  return GROUPS.find((g) => unit in g) ?? null;
}

export function canConvert(from: string, to: string): boolean {
  if (!from || !to) return false;
  if (from === to) return true;
  const g = findGroup(from);
  return !!g && to in g;
}

export function convertUnits(value: number, from: string, to: string): number | null {
  if (!from || !to || from === to) return value;
  const g = findGroup(from);
  if (!g || !(to in g)) return null;
  const inBase = value * g[from];
  return inBase / g[to];
}

export function compatibleUnits(storageUnit: string): string[] {
  const g = findGroup(storageUnit);
  if (!g) return [storageUnit];
  return Object.keys(g);
}
