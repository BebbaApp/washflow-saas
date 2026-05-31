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
  { key: "snow_foam",    name: "Snow foam shampoo",    dilution: "1:50", unit: "mL", values: { Sedan: 170, "SUV S/Cab": 210, "SUV D/Cab": 260, Quantum: 320, Sprinter: 380, "4T Truck": 540, "8T Truck": 860 } },
  { key: "tyre_shine",   name: "Tyre shine",           dilution: "RTU",  unit: "mL", values: { Sedan: 20, "SUV S/Cab": 24, "SUV D/Cab": 28, Quantum: 30, Sprinter: 32, "4T Truck": 50, "8T Truck": 80 } },
  { key: "dash_trim",    name: "Dash & trim dressing", dilution: "RTU",  unit: "mL", values: { Sedan: 50,  "SUV S/Cab": 60,  "SUV D/Cab": 75,  Quantum: 100, Sprinter: 90,  "4T Truck": 120, "8T Truck": 150 } },
  { key: "glass",        name: "Glass cleaner",        dilution: "1:10", unit: "mL", values: { Sedan: 8,   "SUV S/Cab": 10,  "SUV D/Cab": 12,  Quantum: 18,  Sprinter: 16,  "4T Truck": 20,  "8T Truck": 25 } },
  { key: "engine_deg",   name: "Engine degreaser*",    dilution: "1:10", unit: "mL", values: { Sedan: 30,  "SUV S/Cab": 40,  "SUV D/Cab": 50,  Quantum: 60,  Sprinter: 70,  "4T Truck": 120, "8T Truck": 200 } },
  { key: "carpet",       name: "Carpet/upholstery*",   dilution: "1:20", unit: "mL", values: { Sedan: 8,   "SUV S/Cab": 10,  "SUV D/Cab": 13,  Quantum: 20,  Sprinter: 18,  "4T Truck": 15,  "8T Truck": 20 } },
];

export const WATER: WaterRow[] = [
  { key: "pre_rinse",    phase: "Pre-rinse trigger",     unit: "min", muted: true, values: { Sedan: 2,   "SUV S/Cab": 2.5, "SUV D/Cab": 3, Quantum: 4, Sprinter: 4.5, "4T Truck": 7,   "8T Truck": 11 } },
  { key: "final_rinse",  phase: "Final rinse trigger",   unit: "min", muted: true, values: { Sedan: 2.5, "SUV S/Cab": 3,   "SUV D/Cab": 4, Quantum: 5, Sprinter: 6,   "4T Truck": 8,   "8T Truck": 13 } },
  { key: "pressure",     phase: "Pressure-washer water", unit: "L",                values: { Sedan: 34,  "SUV S/Cab": 41,  "SUV D/Cab": 53, Quantum: 68, Sprinter: 79, "4T Truck": 113, "8T Truck": 180 } },
  { key: "bucket",       phase: "Bucket water",          unit: "L", muted: true,   values: { Sedan: 20,  "SUV S/Cab": 25,  "SUV D/Cab": 30, Quantum: 40, Sprinter: 40, "4T Truck": 50,  "8T Truck": 80 } },
  { key: "total_water",  phase: "Total water per wash",  unit: "L", total: true,   values: { Sedan: 54,  "SUV S/Cab": 66,  "SUV D/Cab": 83, Quantum: 108, Sprinter: 119, "4T Truck": 163, "8T Truck": 260 } },
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
};

export const WATER_KEYWORD = /\bwater\b/i;

export const CONCENTRATE_PRESET_IDS: Record<string, string> = {
  snow_foam:  "shampoo",
  tyre_shine: "tyre-shine",
  dash_trim:  "dash-trim",
  glass:      "glass-cleaner",
  engine_deg: "engine-degreaser",
  carpet:     "carpet-cleaner",
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
    name: "Wax + Tyre Shine",
    description: "Quick exterior refresh: shampoo wax + tyre dressing.",
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
