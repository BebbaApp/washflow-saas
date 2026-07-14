export const VEHICLES = [
  "Sedan",
  "SUV S/Cab",
  "SUV D/Cab",
  "Quantum",
  "Sprinter",
  "4T Truck",
  "8T Truck",
] as const;
export type Vehicle = typeof VEHICLES[number];

export interface ConcentrateRow {
  key: string;
  name: string;
  dilution: string;
  unit: "mL";
  values: Record<Vehicle, number>;
}

export interface WaterRow {
  key: string;
  phase: string;
  unit: "min" | "L";
  values: Record<Vehicle, number>;
  muted?: boolean;
  total?: boolean;
}

export const CONCENTRATES: ConcentrateRow[] = [
  { key: "snow_foam",    name: "Snow foam shampoo",    dilution: "1:50", unit: "mL", values: { Sedan: 102, "SUV S/Cab": 126, "SUV D/Cab": 156, Quantum: 192, Sprinter: 228, "4T Truck": 324, "8T Truck": 516 } },
  { key: "tyre_shine",   name: "Tyre polish",          dilution: "RTU",  unit: "mL", values: { Sedan: 17, "SUV S/Cab": 20, "SUV D/Cab": 24, Quantum: 26, Sprinter: 27, "4T Truck": 43, "8T Truck": 68 } },
  { key: "dash_trim",    name: "Dash & trim dressing", dilution: "RTU",  unit: "mL", values: { Sedan: 50,  "SUV S/Cab": 60,  "SUV D/Cab": 75,  Quantum: 100, Sprinter: 90,  "4T Truck": 120, "8T Truck": 150 } },
  { key: "glass",        name: "Glass cleaner",        dilution: "1:10", unit: "mL", values: { Sedan: 8,   "SUV S/Cab": 10,  "SUV D/Cab": 12,  Quantum: 18,  Sprinter: 16,  "4T Truck": 20,  "8T Truck": 25 } },
  { key: "engine_deg",   name: "Engine degreaser*",    dilution: "1:10", unit: "mL", values: { Sedan: 30,  "SUV S/Cab": 40,  "SUV D/Cab": 50,  Quantum: 60,  Sprinter: 70,  "4T Truck": 120, "8T Truck": 200 } },
  { key: "carpet",       name: "Carpet/upholstery*",   dilution: "1:20", unit: "mL", values: { Sedan: 8,   "SUV S/Cab": 10,  "SUV D/Cab": 13,  Quantum: 20,  Sprinter: 18,  "4T Truck": 15,  "8T Truck": 20 } },
  { key: "perfume",      name: "Car perfume",          dilution: "RTU",  unit: "mL", values: { Sedan: 2,   "SUV S/Cab": 2.5, "SUV D/Cab": 3,   Quantum: 4,   Sprinter: 4,   "4T Truck": 5,   "8T Truck": 6 } },
];

export const WATER: WaterRow[] = [
  { key: "pre_rinse",    phase: "Pre-rinse trigger",     unit: "min", muted: true, values: { Sedan: 2,   "SUV S/Cab": 2.5, "SUV D/Cab": 3, Quantum: 4, Sprinter: 4.5, "4T Truck": 7,   "8T Truck": 11 } },
  { key: "final_rinse",  phase: "Final rinse trigger",   unit: "min", muted: true, values: { Sedan: 2.5, "SUV S/Cab": 3,   "SUV D/Cab": 4, Quantum: 5, Sprinter: 6,   "4T Truck": 8,   "8T Truck": 13 } },
  { key: "pressure",     phase: "Pressure-washer water", unit: "L",                values: { Sedan: 13.9, "SUV S/Cab": 16.8, "SUV D/Cab": 21.7, Quantum: 27.9, Sprinter: 32.4, "4T Truck": 46.3, "8T Truck": 73.8 } },
  { key: "bucket",       phase: "Bucket water",          unit: "L", muted: true,   values: { Sedan: 8.2,  "SUV S/Cab": 10.3, "SUV D/Cab": 12.3, Quantum: 16.4, Sprinter: 16.4, "4T Truck": 20.5, "8T Truck": 32.8 } },
  { key: "total_water",  phase: "Total water per wash",  unit: "L", total: true,   values: { Sedan: 22.1, "SUV S/Cab": 27.1, "SUV D/Cab": 34.0, Quantum: 44.3, Sprinter: 48.8, "4T Truck": 66.8, "8T Truck": 106.6 } },
];

export function matchVehicle(input: string | undefined | null): Vehicle | null {
  if (!input) return null;
  const norm = input.trim().toLowerCase();
  if (!norm) return null;
  for (const v of VEHICLES) {
    if (v.toLowerCase() === norm) return v;
  }
  if (/8\s*t/.test(norm) || norm.includes("8 ton")) return "8T Truck";
  if (/4\s*t/.test(norm) || norm.includes("4 ton")) return "4T Truck";
  if (norm.includes("sprinter")) return "Sprinter";
  if (norm.includes("quantum") || norm.includes("minibus") || norm.includes("kombi")) return "Quantum";
  if (norm.includes("d/cab") || norm.includes("double cab") || norm.includes("dcab") || norm.includes("bakkie")) return "SUV D/Cab";
  if (norm.includes("s/cab") || norm.includes("single cab") || norm.includes("scab") || norm.includes("suv")) return "SUV S/Cab";
  if (norm.includes("sedan") || norm.includes("hatch") || norm.includes("car")) return "Sedan";
  return null;
}

export interface UsageTotals {
  concentrate: { key: string; name: string; mL: number }[];
  waterL: number;
  pressureL: number;
  bucketL: number;
}

export function computeUsage(counts: Partial<Record<Vehicle, number>>): UsageTotals {
  const concentrate = CONCENTRATES.map((row) => {
    let mL = 0;
    for (const v of VEHICLES) mL += (counts[v] ?? 0) * row.values[v];
    return { key: row.key, name: row.name, mL };
  });
  let pressureL = 0, bucketL = 0;
  for (const v of VEHICLES) {
    const n = counts[v] ?? 0;
    pressureL += n * (WATER.find((w) => w.key === "pressure")!.values[v]);
    bucketL   += n * (WATER.find((w) => w.key === "bucket")!.values[v]);
  }
  return { concentrate, pressureL, bucketL, waterL: pressureL + bucketL };
}

export const CONCENTRATE_KEYWORDS: Record<string, RegExp> = {
  snow_foam:  /shampoo|snow ?foam|wash soap|car ?soap/i,
  tyre_shine: /tyre|tire/i,
  dash_trim:  /dash|trim|dressing/i,
  glass:      /glass|window/i,
  engine_deg: /engine|degreas/i,
  carpet:     /carpet|upholster/i,
  perfume:    /perfume|fragrance|air ?freshener|scent/i,
};

export const WATER_KEYWORD = /\bwater\b/i;

export const CONCENTRATE_PRESET_IDS: Record<string, string> = {
  snow_foam:  "shampoo",
  tyre_shine: "tyre-shine",
  dash_trim:  "dash-trim",
  glass:      "glass-cleaner",
  engine_deg: "engine-degreaser",
  carpet:     "carpet-cleaner",
  perfume:    "car-perfume",
};

export interface ProductBundle {
  id: string;
  name: string;
  description: string;
  concentrateKeys: string[];
  includeWater: boolean;
}

export const PRODUCT_BUNDLES: ProductBundle[] = [
  {
    id: "wax_tyre",
    name: "Wax + Tyre Polish",
    description: "Quick exterior refresh: shampoo wax + tyre polish.",
    concentrateKeys: ["snow_foam", "tyre_shine"],
    includeWater: true,
  },
  {
    id: "spotless",
    name: "Spotless Finish",
    description: "Full exterior + interior detail: foam, glass, dash, tyres.",
    concentrateKeys: ["snow_foam", "glass", "dash_trim", "tyre_shine"],
    includeWater: true,
  },
  {
    id: "engine_deep",
    name: "Engine Deep Clean",
    description: "Engine bay degrease with foam pre-wash.",
    concentrateKeys: ["snow_foam", "engine_deg"],
    includeWater: true,
  },
  {
    id: "interior_detail",
    name: "Interior Detail",
    description: "Carpet, upholstery, dash & glass cleaning.",
    concentrateKeys: ["carpet", "dash_trim", "glass"],
    includeWater: false,
  },
];
