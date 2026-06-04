import type { InventoryCategory } from "@/hooks/useInventory";

export interface InventoryPreset {
  id: string;
  name: string;
  category: InventoryCategory;
  unit: string;
  recommendedMin: number;
  recommendedMax: number;
  description?: string;
}

export const INVENTORY_PRESETS: InventoryPreset[] = [
  { id: "shampoo", name: "Car Wash Shampoo / Soap", category: "Soap", unit: "L", recommendedMin: 25, recommendedMax: 50, description: "High-foam wash shampoo" },
  { id: "tyre-shine", name: "Tyre Shine / Gloss", category: "Chemicals", unit: "L", recommendedMin: 25, recommendedMax: 50 },
  { id: "dash-trim", name: "Dash & Trim Cleaner", category: "Chemicals", unit: "L", recommendedMin: 5, recommendedMax: 10 },
  { id: "glass-cleaner", name: "Window / Glass Cleaner", category: "Chemicals", unit: "L", recommendedMin: 5, recommendedMax: 10 },
  { id: "engine-degreaser", name: "Engine Cleaner / Degreaser", category: "Chemicals", unit: "L", recommendedMin: 5, recommendedMax: 20 },
  { id: "carpet-cleaner", name: "Carpet / Upholstery Cleaner", category: "Chemicals", unit: "L", recommendedMin: 5, recommendedMax: 10 },
  { id: "car-perfume", name: "Car Perfume / Fragrance", category: "Chemicals", unit: "L", recommendedMin: 1, recommendedMax: 5, description: "Interior fragrance / scent" },
  { id: "wax", name: "Car Wax / Sealant", category: "Wax", unit: "L", recommendedMin: 5, recommendedMax: 20 },
  { id: "microfiber", name: "Microfiber Towels / Drying Cloths", category: "Towels", unit: "pcs", recommendedMin: 50, recommendedMax: 100, description: "High-quality, varied colors for different jobs" },
  { id: "wash-mitts", name: "Wash Mitts / Sponges", category: "Tools", unit: "pcs", recommendedMin: 10, recommendedMax: 15 },
  { id: "buckets", name: "Buckets (with grit guards)", category: "Tools", unit: "pcs", recommendedMin: 5, recommendedMax: 10 },
  { id: "brushes", name: "Brushes (Rim & Carpet)", category: "Tools", unit: "pcs", recommendedMin: 5, recommendedMax: 10, description: "Assorted types" },
];

export const UNIT_OPTIONS = ["L", "ml", "kg", "g", "pcs", "box", "pack"] as const;
