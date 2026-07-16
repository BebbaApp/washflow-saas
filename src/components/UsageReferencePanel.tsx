import { useMemo, useState } from "react";
import { Download, Droplets, FlaskConical, Calculator, Link2, AlertTriangle, Wand2, FileSpreadsheet, Sparkles, FileText } from "lucide-react";
import { exportTablePdf } from "@/lib/pdfExport";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useInventory } from "@/hooks/useInventory";
import {
  VEHICLES,
  CONCENTRATES,
  WATER,
  computeUsage,
  CONCENTRATE_KEYWORDS,
  CONCENTRATE_PRESET_IDS,
  WATER_KEYWORD,
  PRODUCT_BUNDLES,
  type Vehicle,
  type ProductBundle,
} from "@/lib/vehicleUsage";

function heatStyle(value: number, min: number, max: number): React.CSSProperties {
  if (max === min) return { backgroundColor: "hsl(var(--success) / 0.18)" };
  const t = (value - min) / (max - min);
  const alpha = 0.08 + t * 0.45;
  return { backgroundColor: `hsl(var(--success) / ${alpha.toFixed(3)})` };
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast.success(`${filename} downloaded`);
}

function fmtMl(mL: number): string {
  if (mL >= 1000) return `${(mL / 1000).toFixed(2)} L`;
  return `${Math.round(mL)} mL`;
}

export const UsageReferencePanel = () => {
  const {
    items,
    transactions,
    vehicleMap,
    waterItemId,
    setVehicleMapping,
    setWaterItem,
    consumeForWash,
  } = useInventory();

  const [counts, setCounts] = useState<Partial<Record<Vehicle, number>>>({});
  const [logVehicle, setLogVehicle] = useState<Vehicle>("Sedan");

  const concentrateMinMax = useMemo(
    () => CONCENTRATES.map((row) => {
      const vals = VEHICLES.map((v) => row.values[v]);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    }),
    [],
  );
  const waterMinMax = useMemo(
    () => WATER.map((row) => {
      const vals = VEHICLES.map((v) => row.values[v]);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    }),
    [],
  );

  const totals = useMemo(() => computeUsage(counts), [counts]);
  const totalCars = VEHICLES.reduce((s, v) => s + (counts[v] ?? 0), 0);

  const exportConcentrate = () => {
    const header = ["Concentrate", "Dilution", ...VEHICLES];
    const rows: (string | number)[][] = [header];
    CONCENTRATES.forEach((r) => rows.push([r.name, r.dilution, ...VEHICLES.map((v) => `${r.values[v]} mL`)]));
    downloadCsv("chemical-concentrate-per-vehicle.csv", rows);
  };
  const exportConcentratePdf = () => {
    exportTablePdf({
      title: "Chemical concentrate per vehicle",
      filename: "chemical-concentrate-per-vehicle.pdf",
      headers: ["Concentrate", "Dilution", ...VEHICLES],
      rows: CONCENTRATES.map((r) => [r.name, r.dilution, ...VEHICLES.map((v) => `${r.values[v]} mL`)]),
    });
  };
  const exportWater = () => {
    const header = ["Phase", ...VEHICLES];
    const rows: (string | number)[][] = [header];
    WATER.forEach((r) => rows.push([r.phase, ...VEHICLES.map((v) => `${r.values[v]} ${r.unit}`)]));
    downloadCsv("water-usage-per-vehicle.csv", rows);
  };
  const exportWaterPdf = () => {
    exportTablePdf({
      title: "Water usage per vehicle",
      filename: "water-usage-per-vehicle.pdf",
      headers: ["Phase", ...VEHICLES],
      rows: WATER.map((r) => [r.phase, ...VEHICLES.map((v) => `${r.values[v]} ${r.unit}`)]),
    });
  };
  const exportCalc = () => {
    const header = ["Vehicle", "Count"];
    const rows: (string | number)[][] = [header];
    VEHICLES.forEach((v) => rows.push([v, counts[v] ?? 0]));
    rows.push([]);
    rows.push(["Concentrate", "Total mL"]);
    totals.concentrate.forEach((c) => rows.push([c.name, Math.round(c.mL)]));
    rows.push([]);
    rows.push(["Pressure-washer water (L)", totals.pressureL]);
    rows.push(["Bucket water (L)", totals.bucketL]);
    rows.push(["Total water (L)", totals.waterL]);
    downloadCsv("wash-usage-calculation.csv", rows);
  };
  const exportCalcPdf = () => {
    const rows: (string | number)[][] = [];
    VEHICLES.forEach((v) => rows.push(["Vehicle", v, counts[v] ?? 0]));
    totals.concentrate.forEach((c) => rows.push(["Concentrate", c.name, `${Math.round(c.mL)} mL`]));
    rows.push(["Water", "Pressure-washer", `${totals.pressureL.toFixed(1)} L`]);
    rows.push(["Water", "Bucket", `${totals.bucketL.toFixed(1)} L`]);
    rows.push(["Water", "Total", `${totals.waterL.toFixed(1)} L`]);
    exportTablePdf({
      title: "Wash usage calculation",
      subtitle: `Total vehicles: ${totalCars}`,
      filename: "wash-usage-calculation.pdf",
      headers: ["Category", "Item", "Amount"],
      rows,
    });
  };

  const handleLogUsage = async () => {
    const res = await consumeForWash({ vehicleInput: logVehicle, source: `Manual ${logVehicle} wash` });
    if (!res.ok) {
      toast.error(`Insufficient stock: ${res.negativeItems.join(", ")}`);
      return;
    }
    toast.success(`Recorded usage for 1 × ${logVehicle}`);
  };

  const autoLinkPresets = () => {
    let linked = 0;
    for (const row of CONCENTRATES) {
      if (vehicleMap[row.key]) continue;
      const presetId = CONCENTRATE_PRESET_IDS[row.key];
      const kw = CONCENTRATE_KEYWORDS[row.key];
      const match =
        items.find((i) => presetId && i.presetId === presetId) ??
        items.find((i) => kw && kw.test(i.name));
      if (match) { setVehicleMapping(row.key, match.id); linked++; }
    }
    if (!waterItemId) {
      const water = items.find((i) => WATER_KEYWORD.test(i.name));
      if (water) { setWaterItem(water.id); linked++; }
    }
    toast[linked > 0 ? "success" : "info"](
      linked > 0 ? `Linked ${linked} item${linked === 1 ? "" : "s"} by name` : "No new matches found",
    );
  };

  const findItemFor = (key: string) => {
    const presetId = CONCENTRATE_PRESET_IDS[key];
    const kw = CONCENTRATE_KEYWORDS[key];
    return (
      items.find((i) => presetId && i.presetId === presetId) ??
      items.find((i) => kw && kw.test(i.name)) ??
      null
    );
  };

  const applyBundle = (bundle: ProductBundle) => {
    let linked = 0;
    const missing: string[] = [];
    for (const key of bundle.concentrateKeys) {
      const row = CONCENTRATES.find((c) => c.key === key);
      if (!row) continue;
      const match = findItemFor(key);
      if (match) { setVehicleMapping(key, match.id); linked++; }
      else missing.push(row.name);
    }
    if (bundle.includeWater && !waterItemId) {
      const water = items.find((i) => WATER_KEYWORD.test(i.name));
      if (water) { setWaterItem(water.id); linked++; }
      else missing.push("Water");
    }
    if (linked > 0) {
      toast.success(
        `Applied "${bundle.name}" — linked ${linked} item${linked === 1 ? "" : "s"}` +
        (missing.length ? ` (missing: ${missing.join(", ")})` : ""),
      );
    } else {
      toast.info(
        missing.length
          ? `No inventory items match this bundle. Add: ${missing.join(", ")}`
          : "Bundle already linked",
      );
    }
  };

  const exportWashUsage = () => {
    const washTx = transactions.filter(
      (t) => t.delta < 0 && (/^Order\s/i.test(t.source) || /^Manual\s.*wash/i.test(t.source)),
    );
    if (washTx.length === 0) {
      toast.info("No recorded wash usage yet");
      return;
    }
    const header = [
      "Date", "Order/Source", "Vehicle", "Item", "Quantity used", "Unit",
      "Resulting balance", "Flow", "Notes",
    ];
    const rows: (string | number)[][] = [header];
    for (const t of washTx.slice().reverse()) {
      const item = items.find((i) => i.id === t.itemId);
      const vMatch = (t.notes ?? "").match(/\b(Sedan|SUV S\/Cab|SUV D\/Cab|Quantum|Sprinter|4T Truck|8T Truck)\b/);
      rows.push([
        new Date(t.createdAt).toISOString(),
        t.source,
        vMatch ? vMatch[1] : "",
        t.itemName,
        Math.abs(t.delta),
        item?.unit ?? "",
        t.balance,
        t.flow ?? "",
        t.notes ?? "",
      ]);
    }
    downloadCsv("wash-inventory-usage.csv", rows);
  };

  const exportWashUsagePdf = () => {
    const washTx = transactions.filter(
      (t) => t.delta < 0 && (/^Order\s/i.test(t.source) || /^Manual\s.*wash/i.test(t.source)),
    );
    if (washTx.length === 0) {
      toast.info("No recorded wash usage yet");
      return;
    }
    const headers = ["Date", "Order/Source", "Vehicle", "Item", "Qty", "Unit", "Balance", "Flow", "Notes"];
    const pdfRows = washTx.slice().reverse().map((t) => {
      const item = items.find((i) => i.id === t.itemId);
      const vMatch = (t.notes ?? "").match(/\b(Sedan|SUV S\/Cab|SUV D\/Cab|Quantum|Sprinter|4T Truck|8T Truck)\b/);
      return [
        new Date(t.createdAt).toLocaleString(),
        t.source,
        vMatch ? vMatch[1] : "",
        t.itemName,
        Math.abs(t.delta),
        item?.unit ?? "",
        t.balance,
        t.flow ?? "",
        t.notes ?? "",
      ];
    });
    exportTablePdf({
      title: "Wash inventory usage",
      filename: "wash-inventory-usage.pdf",
      headers,
      rows: pdfRows,
    });
  };

  const updateCount = (v: Vehicle, val: string) => {
    const n = Math.max(0, parseInt(val || "0", 10) || 0);
    setCounts((prev) => ({ ...prev, [v]: n }));
  };

  return (
    <div className="space-y-6">
      {/* Calculator */}
      <section className="glass-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" />
              Wash usage calculator
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Enter how many of each vehicle type you'll wash. We'll compute total chemical concentrate and water needed.
            </p>
          </div>
          <button
            onClick={exportCalc}
            disabled={totalCars === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          {VEHICLES.map((v) => (
            <div key={v} className="space-y-1">
              <label className="text-xs text-muted-foreground">{v}</label>
              <Input
                type="number"
                min={0}
                value={counts[v] ?? 0}
                onChange={(e) => updateCount(v, e.target.value)}
                className="bg-secondary border-border text-foreground"
              />
            </div>
          ))}
        </div>
        {totalCars > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Chemicals required ({totalCars} vehicles)</div>
              <ul className="space-y-1.5 text-sm">
                {totals.concentrate.filter((c) => c.mL > 0).map((c) => (
                  <li key={c.key} className="flex items-center justify-between">
                    <span className="text-foreground">{c.name}</span>
                    <span className="font-mono text-foreground">{fmtMl(c.mL)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Water required</div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center justify-between text-muted-foreground"><span>Pressure-washer</span><span className="font-mono">{totals.pressureL.toFixed(1)} L</span></li>
                <li className="flex items-center justify-between text-muted-foreground"><span>Bucket</span><span className="font-mono">{totals.bucketL.toFixed(1)} L</span></li>
                <li className="flex items-center justify-between font-semibold text-foreground border-t border-border pt-1.5"><span>Total</span><span className="font-mono">{totals.waterL.toFixed(1)} L</span></li>
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* Mapping + Manual log */}
      <section className="glass-card p-5">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Link2 className="w-5 h-5 text-info" />
              Auto-deduct mapping
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Link each chemical to an inventory item. Stock will decrement automatically when a wash for that vehicle type is completed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoLinkPresets}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90"
              title="Auto-link mappings to inventory items by name match"
            >
              <Wand2 className="w-4 h-4" />
              <span className="hidden sm:inline">Auto-link by name</span>
            </button>
            <button
              onClick={exportWashUsage}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90"
              title="Export recorded wash inventory usage as CSV"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="hidden sm:inline">Export usage</span>
            </button>
          </div>
        </div>

        {/* Quick bundle presets */}
        <div className="mb-5 rounded-lg border border-border bg-secondary/30 p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Quick bundle presets</span>
            <span className="text-xs text-muted-foreground">Auto-fill mappings + water for common product combos</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRODUCT_BUNDLES.map((b) => (
              <button
                key={b.id}
                onClick={() => applyBundle(b)}
                title={b.description}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-secondary text-sm text-foreground transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                {b.name}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-medium pb-2 pr-4">Chemical / Resource</th>
                <th className="font-medium pb-2 pr-4">Inventory item</th>
                <th className="font-medium pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {CONCENTRATES.map((row) => {
                const itemId = vehicleMap[row.key] ?? "";
                const item = items.find((i) => i.id === itemId);
                return (
                  <tr key={row.key} className="border-t border-border">
                    <td className="py-2 pr-4 text-foreground">{row.name}</td>
                    <td className="py-2 pr-4">
                      <Select
                        value={itemId || "none"}
                        onValueChange={(v) => setVehicleMapping(row.key, v === "none" ? null : v)}
                      >
                        <SelectTrigger className="bg-secondary border-border text-foreground w-full max-w-xs">
                          <SelectValue placeholder="Pick item" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Not mapped —</SelectItem>
                          {items.map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 text-xs">
                      {item
                        ? <span className="text-success">Linked → {item.quantity.toFixed(2)} {item.unit}</span>
                        : <span className="text-muted-foreground inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />No item linked</span>}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border">
                <td className="py-2 pr-4 text-foreground">Water (Total per wash)</td>
                <td className="py-2 pr-4">
                  <Select
                    value={waterItemId || "none"}
                    onValueChange={(v) => setWaterItem(v === "none" ? null : v)}
                  >
                    <SelectTrigger className="bg-secondary border-border text-foreground w-full max-w-xs">
                      <SelectValue placeholder="Pick item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Not tracked —</SelectItem>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-2 text-xs text-muted-foreground">Optional — only if you stock-track water.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-border bg-secondary/40">
          <div className="flex-1 text-sm text-foreground">
            <span className="font-medium">Log usage now:</span>{" "}
            <span className="text-muted-foreground">deduct stock for one wash without an order.</span>
          </div>
          <Select value={logVehicle} onValueChange={(v) => setLogVehicle(v as Vehicle)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VEHICLES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={handleLogUsage}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90"
          >
            Record wash
          </button>
        </div>
      </section>

      {/* Reference: Chemical concentrate */}
      <section className="glass-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-success" />
              Chemical concentrate per vehicle
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Neat product before dilution. Lower pressure (130 bar) means slightly more shampoo dwell time needed.
            </p>
          </div>
          <button onClick={exportConcentrate} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-medium pb-3 pr-4">Concentrate</th>
                <th className="font-medium pb-3 pr-4">Dilution</th>
                {VEHICLES.map((v) => <th key={v} className="font-medium pb-3 px-3 whitespace-nowrap">{v}</th>)}
              </tr>
            </thead>
            <tbody>
              {CONCENTRATES.map((row, i) => {
                const { min, max } = concentrateMinMax[i];
                return (
                  <tr key={row.name} className="border-t border-border">
                    <td className="py-3 pr-4 font-medium text-foreground">{row.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{row.dilution}</td>
                    {VEHICLES.map((v) => (
                      <td key={v} className="py-3 px-3 text-foreground tabular-nums" style={heatStyle(row.values[v], min, max)}>
                        {row.values[v]} mL
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">* Engine degreaser and carpet/upholstery only when requested.</p>
      </section>

      {/* Reference: Water */}
      <section className="glass-card p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Droplets className="w-5 h-5 text-info" />
              Water usage per vehicle
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Calculated at 7.5 L/min trigger time. Trigger times slightly longer than higher-flow machines because lower flow = more dwell time needed to shift dirt.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportWater} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button onClick={exportWaterPdf} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Export PDF</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-medium pb-3 pr-4">Phase</th>
                {VEHICLES.map((v) => <th key={v} className="font-medium pb-3 px-3 whitespace-nowrap">{v}</th>)}
              </tr>
            </thead>
            <tbody>
              {WATER.map((row, i) => {
                const { min, max } = waterMinMax[i];
                const isHighlight = row.key === "pressure";
                return (
                  <tr key={row.phase} className="border-t border-border">
                    <td className={`py-3 pr-4 ${row.total ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>{row.phase}</td>
                    {VEHICLES.map((v) => (
                      <td
                        key={v}
                        className={`py-3 px-3 tabular-nums ${row.muted ? "text-muted-foreground" : "text-foreground"} ${row.total ? "font-semibold" : ""}`}
                        style={isHighlight ? heatStyle(row.values[v], min, max) : undefined}
                      >
                        {row.values[v]} {row.unit}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
