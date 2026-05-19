/// <reference types="web-bluetooth" />
// Bluetooth thermal printer helper (ESC/POS over Web Bluetooth)
// Target: 80mm thermal printer (48 chars per line). Receipt length is
// naturally variable; the 83mm figure is approximate paper feed length.

import type { WashOrder } from "@/hooks/useOrders";

// Known GATT service UUIDs used by common BT thermal printers.
const PRINTER_SERVICES: BluetoothServiceUUID[] = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

const STORAGE_KEY = "aquawash-thermal-printer";
export const LINE_WIDTH = 48; // 80mm @ Font A

// ── Receipt model ──────────────────────────────────────────────────────────
export type ReceiptAlign = "left" | "center" | "right";

export interface ReceiptLine {
  kind: "text";
  text: string;
  align?: ReceiptAlign;
  bold?: boolean;
  double?: boolean;
}
export interface ReceiptRule { kind: "rule"; char: "-" | "="; }
export interface ReceiptBlank { kind: "blank"; }
export interface ReceiptCols { kind: "cols"; left: string; right: string; bold?: boolean; double?: boolean; }

export type ReceiptSegment = ReceiptLine | ReceiptRule | ReceiptBlank | ReceiptCols;

export interface ReceiptSettings {
  businessName: string;
  businessLine2: string;
  footer: string;
}

export interface ReceiptBuildOpts {
  settings: ReceiptSettings;
  currencySymbol: string;
  vatPercent: number; // 0 to disable VAT line
}

const DEFAULT_SETTINGS: ReceiptSettings = {
  businessName: "AquaWash",
  businessLine2: "Premium Car Wash",
  footer: "Thank you for your business!",
};

export function getDefaultReceiptSettings(): ReceiptSettings {
  return { ...DEFAULT_SETTINGS };
}

export function buildReceiptModel(order: WashOrder, opts: ReceiptBuildOpts): ReceiptSegment[] {
  const { settings, currencySymbol, vatPercent } = opts;
  const segs: ReceiptSegment[] = [];

  // Header
  segs.push({ kind: "text", text: settings.businessName, align: "center", bold: true, double: true });
  if (settings.businessLine2.trim()) {
    segs.push({ kind: "text", text: settings.businessLine2, align: "center", bold: true });
  }
  segs.push({ kind: "blank" });

  // Order info
  segs.push({ kind: "cols", left: "Order:", right: order.orderNumber });
  const completed = order.completedAt ? new Date(order.completedAt) : new Date();
  segs.push({ kind: "cols", left: "Date:", right: completed.toLocaleDateString() });
  segs.push({
    kind: "cols",
    left: "Time:",
    right: completed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  segs.push({ kind: "rule", char: "-" });

  // Customer
  segs.push({ kind: "text", text: "CUSTOMER", bold: true });
  segs.push({ kind: "text", text: order.customer });
  if (order.customerPhone) segs.push({ kind: "text", text: order.customerPhone });
  segs.push({ kind: "rule", char: "-" });

  // Vehicle
  segs.push({ kind: "text", text: "VEHICLE", bold: true });
  segs.push({ kind: "text", text: order.vehicle });
  segs.push({ kind: "text", text: `Plate: ${order.plate}` });
  segs.push({ kind: "rule", char: "-" });

  // Service / pricing
  segs.push({ kind: "text", text: "SERVICE", bold: true });
  const priceStr = `${currencySymbol}${order.servicePrice.toFixed(2)}`;
  segs.push({ kind: "cols", left: order.service, right: priceStr });

  if (vatPercent > 0) {
    const sub = order.servicePrice / (1 + vatPercent / 100);
    const vat = order.servicePrice - sub;
    segs.push({ kind: "cols", left: "Subtotal", right: `${currencySymbol}${sub.toFixed(2)}` });
    segs.push({ kind: "cols", left: `VAT (${vatPercent}%)`, right: `${currencySymbol}${vat.toFixed(2)}` });
  }

  segs.push({ kind: "rule", char: "=" });
  segs.push({ kind: "cols", left: "TOTAL", right: priceStr, bold: true, double: true });
  segs.push({ kind: "rule", char: "=" });

  if (typeof order.waitMinutes === "number") {
    segs.push({ kind: "text", text: `Service time: ${order.waitMinutes} min` });
  }

  if (order.notes && order.notes.trim()) {
    segs.push({ kind: "blank" });
    segs.push({ kind: "text", text: "Notes:", bold: true });
    for (const line of wrap(order.notes.trim(), LINE_WIDTH)) {
      segs.push({ kind: "text", text: line });
    }
  }

  segs.push({ kind: "blank" });
  if (settings.footer.trim()) {
    for (const line of wrap(settings.footer.trim(), LINE_WIDTH)) {
      segs.push({ kind: "text", text: line, align: "center" });
    }
  }

  return segs;
}

// ── Plain-text rendering (used in preview) ─────────────────────────────────
function wrap(text: string, width: number): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((para) => {
      if (!para.trim()) return [""];
      const words = para.split(/\s+/);
      const out: string[] = [];
      let line = "";
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (candidate.length > width) {
          if (line) out.push(line);
          line = w;
        } else {
          line = candidate;
        }
      }
      if (line) out.push(line);
      return out;
    });
}

function colsLine(left: string, right: string, width: number): string {
  if (left.length + right.length + 1 > width) {
    // wrap left onto two lines
    return left.slice(0, width) + "\n" + " ".repeat(Math.max(0, width - right.length)) + right;
  }
  const space = width - left.length - right.length;
  return left + " ".repeat(space) + right;
}

function alignLine(text: string, align: ReceiptAlign | undefined, width: number): string {
  if (!align || align === "left") return text;
  if (text.length >= width) return text;
  if (align === "center") {
    const pad = Math.floor((width - text.length) / 2);
    return " ".repeat(pad) + text;
  }
  return " ".repeat(width - text.length) + text;
}

/** Render the receipt as plain monospace text (for preview only). */
export function renderReceiptText(model: ReceiptSegment[]): string {
  const lines: string[] = [];
  for (const s of model) {
    if (s.kind === "blank") lines.push("");
    else if (s.kind === "rule") lines.push(s.char.repeat(LINE_WIDTH));
    else if (s.kind === "cols") {
      const width = s.double ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
      lines.push(colsLine(s.left, s.right, width));
    } else {
      lines.push(alignLine(s.text, s.align, LINE_WIDTH));
    }
  }
  return lines.join("\n");
}

// ── ESC/POS rendering ──────────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  init: new Uint8Array([ESC, 0x40]),
  alignLeft: new Uint8Array([ESC, 0x61, 0x00]),
  alignCenter: new Uint8Array([ESC, 0x61, 0x01]),
  alignRight: new Uint8Array([ESC, 0x61, 0x02]),
  boldOn: new Uint8Array([ESC, 0x45, 0x01]),
  boldOff: new Uint8Array([ESC, 0x45, 0x00]),
  doubleOn: new Uint8Array([GS, 0x21, 0x11]),
  doubleOff: new Uint8Array([GS, 0x21, 0x00]),
  feed: (n = 1) => new Uint8Array([ESC, 0x64, n]),
  cut: new Uint8Array([GS, 0x56, 0x00]),
  newline: new Uint8Array([LF]),
};

const enc = new TextEncoder();
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function renderReceiptBytes(model: ReceiptSegment[]): Uint8Array {
  const parts: Uint8Array[] = [CMD.init];
  const writeAlign = (a: ReceiptAlign | undefined) => {
    parts.push(a === "center" ? CMD.alignCenter : a === "right" ? CMD.alignRight : CMD.alignLeft);
  };
  for (const s of model) {
    if (s.kind === "blank") { parts.push(CMD.newline); continue; }
    if (s.kind === "rule") {
      writeAlign("left");
      parts.push(enc.encode(s.char.repeat(LINE_WIDTH) + "\n"));
      continue;
    }
    if (s.kind === "cols") {
      writeAlign("left");
      if (s.bold) parts.push(CMD.boldOn);
      if (s.double) parts.push(CMD.doubleOn);
      const width = s.double ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
      parts.push(enc.encode(colsLine(s.left, s.right, width) + "\n"));
      if (s.double) parts.push(CMD.doubleOff);
      if (s.bold) parts.push(CMD.boldOff);
      continue;
    }
    writeAlign(s.align);
    if (s.bold) parts.push(CMD.boldOn);
    if (s.double) parts.push(CMD.doubleOn);
    parts.push(enc.encode(s.text + "\n"));
    if (s.double) parts.push(CMD.doubleOff);
    if (s.bold) parts.push(CMD.boldOff);
  }
  parts.push(CMD.feed(3));
  parts.push(CMD.cut);
  return concat(parts);
}

// ── Bluetooth ──────────────────────────────────────────────────────────────
interface SavedPrinter { name?: string; id?: string; pairedAt?: string; }

const EVENTS_KEY = "aquawash-thermal-printer-events";

export type PrinterEventKind = "paired" | "print_ok" | "print_failed" | "forgotten";
export interface PrinterEvent {
  kind: PrinterEventKind;
  at: string;          // ISO timestamp
  device?: string;
  message?: string;
}

function loadSaved(): SavedPrinter | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}
function saveDevice(device: BluetoothDevice) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ name: device.name, id: device.id, pairedAt: new Date().toISOString() }),
    );
  } catch {}
}
export function getSavedPrinter(): SavedPrinter | null { return loadSaved(); }
export function getSavedPrinterName(): string | null { return loadSaved()?.name ?? null; }

function recordEvent(e: PrinterEvent) {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    const list: PrinterEvent[] = raw ? JSON.parse(raw) : [];
    list.unshift(e);
    localStorage.setItem(EVENTS_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {}
  try { window.dispatchEvent(new CustomEvent("printer-event", { detail: e })); } catch {}
}
export function getPrinterEvents(): PrinterEvent[] {
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]"); } catch { return []; }
}
export function getLastPrinterEvent(): PrinterEvent | null {
  return getPrinterEvents()[0] ?? null;
}

export function forgetPrinter() {
  const prev = loadSaved();
  localStorage.removeItem(STORAGE_KEY);
  recordEvent({ kind: "forgotten", at: new Date().toISOString(), device: prev?.name });
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

/** Non-intrusive probe: never opens the chooser. Reports whether the saved
 *  device is reachable and whether its GATT server is currently connected. */
export async function probePrinterConnection(): Promise<{
  paired: boolean;
  permitted: boolean;
  connected: boolean;
  deviceName?: string;
}> {
  const saved = loadSaved();
  const paired = !!saved?.id;
  if (!isBluetoothSupported() || !paired) {
    return { paired, permitted: false, connected: false, deviceName: saved?.name };
  }
  const bt: any = (navigator as any).bluetooth;
  try {
    if (typeof bt.getDevices !== "function") {
      return { paired, permitted: false, connected: false, deviceName: saved?.name };
    }
    const devices: BluetoothDevice[] = await bt.getDevices();
    const match = devices.find((d) => d.id === saved!.id);
    if (!match) return { paired, permitted: false, connected: false, deviceName: saved?.name };
    return {
      paired,
      permitted: true,
      connected: !!match.gatt?.connected,
      deviceName: match.name || saved?.name,
    };
  } catch {
    return { paired, permitted: false, connected: false, deviceName: saved?.name };
  }
}

async function findDevice(forcePicker = false): Promise<BluetoothDevice> {
  const bt: any = (navigator as any).bluetooth;
  if (!forcePicker) {
    const saved = loadSaved();
    if (saved?.id && typeof bt.getDevices === "function") {
      try {
        const devices: BluetoothDevice[] = await bt.getDevices();
        const match = devices.find((d) => d.id === saved.id);
        if (match) return match;
      } catch { /* fall through */ }
    }
  }
  return bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });
}

async function findWriteCharacteristic(server: BluetoothRemoteGATTServer) {
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    try {
      const chars = await svc.getCharacteristics();
      const writable = chars.find(
        (c) => c.properties.write || c.properties.writeWithoutResponse,
      );
      if (writable) return writable;
    } catch { /* skip */ }
  }
  throw new Error("No writable characteristic on this device.");
}

async function writeChunks(
  characteristic: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
  chunkSize = 180,
) {
  const useNoResponse = characteristic.properties.writeWithoutResponse;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.slice(i, i + chunkSize);
    if (useNoResponse) await characteristic.writeValueWithoutResponse(slice);
    else await characteristic.writeValue(slice);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Pair a new device. Returns the device name. */
export async function pairPrinter(): Promise<string> {
  if (!isBluetoothSupported()) {
    throw new Error("Web Bluetooth is not available in this browser.");
  }
  try {
    const device = await findDevice(true);
    saveDevice(device);
    recordEvent({ kind: "paired", at: new Date().toISOString(), device: device.name });
    return device.name || "Unnamed printer";
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (!/cancelled|user cancel/i.test(msg)) {
      recordEvent({ kind: "print_failed", at: new Date().toISOString(), message: `Pairing: ${msg}` });
    }
    throw err;
  }
}

/** Send raw bytes to the (saved or newly-picked) printer. */
export async function sendToPrinter(bytes: Uint8Array): Promise<string> {
  if (!isBluetoothSupported()) {
    throw new Error(
      "Web Bluetooth is not available in this browser. Use Chrome on Android/desktop, or Bluefy on iOS.",
    );
  }
  let deviceName = "printer";
  try {
    const device = await findDevice();
    saveDevice(device);
    deviceName = device.name || "printer";
    const server = await device.gatt!.connect();
    try {
      const characteristic = await findWriteCharacteristic(server);
      await writeChunks(characteristic, bytes);
      recordEvent({ kind: "print_ok", at: new Date().toISOString(), device: deviceName });
      return deviceName;
    } finally {
      try { server.disconnect(); } catch { /* noop */ }
    }
  } catch (err: any) {
    recordEvent({
      kind: "print_failed",
      at: new Date().toISOString(),
      device: deviceName,
      message: err?.message || String(err),
    });
    throw err;
  }
}

/** Convenience: build + send a receipt. */
export async function printReceipt(order: WashOrder, opts: ReceiptBuildOpts): Promise<string> {
  const model = buildReceiptModel(order, opts);
  return sendToPrinter(renderReceiptBytes(model));
}
