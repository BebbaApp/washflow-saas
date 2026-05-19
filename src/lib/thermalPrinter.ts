// Bluetooth thermal printer helper (ESC/POS over Web Bluetooth)
// Target: 80mm thermal printer (48 chars per line). Receipt length is
// naturally variable; the 83mm figure is approximate paper feed length.

import type { WashOrder } from "@/hooks/useOrders";

// Known GATT service UUIDs used by common BT thermal printers.
// We request several so most cheap ESC/POS printers are discoverable.
const PRINTER_SERVICES: BluetoothServiceUUID[] = [
  "000018f0-0000-1000-8000-00805f9b34fb", // Common ESC/POS (most cheap printers)
  "0000ff00-0000-1000-8000-00805f9b34fb", // Older Chinese printers
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip
];

const STORAGE_KEY = "aquawash-thermal-printer";
const LINE_WIDTH = 48; // 80mm @ Font A

// ESC/POS byte sequences -----------------------------------------------------
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

// Helpers --------------------------------------------------------------------
const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function pad(s: string, len = LINE_WIDTH, char = " "): string {
  if (s.length >= len) return s.slice(0, len);
  return s + char.repeat(len - s.length);
}

function row(left: string, right: string, width = LINE_WIDTH): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(space) + right;
}

function rule(char = "-", width = LINE_WIDTH) {
  return char.repeat(width) + "\n";
}

function wrap(text: string, width = LINE_WIDTH): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (line ? line + " " : "") + w;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n") + "\n";
}

// Receipt builder ------------------------------------------------------------
export interface ReceiptOptions {
  businessName?: string;
  businessLine2?: string;
  footer?: string;
  currencySymbol?: string;
  vatPercent?: number; // if > 0, show VAT line
}

export function buildReceiptBytes(order: WashOrder, opts: ReceiptOptions = {}): Uint8Array {
  const {
    businessName = "AquaWash",
    businessLine2 = "Premium Car Wash",
    footer = "Thank you for your business!",
    currencySymbol = "R",
    vatPercent = 0,
  } = opts;

  const parts: Uint8Array[] = [];
  const text = (s: string) => parts.push(enc.encode(s));

  parts.push(CMD.init);

  // Header
  parts.push(CMD.alignCenter, CMD.doubleOn, CMD.boldOn);
  text(businessName + "\n");
  parts.push(CMD.doubleOff);
  if (businessLine2) text(businessLine2 + "\n");
  parts.push(CMD.boldOff);
  text("\n");

  // Order info
  parts.push(CMD.alignLeft);
  text(row("Order:", order.orderNumber) + "\n");
  const completed = order.completedAt ? new Date(order.completedAt) : new Date();
  text(row("Date:", completed.toLocaleDateString()) + "\n");
  text(row("Time:", completed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "\n");
  text(rule());

  // Customer
  parts.push(CMD.boldOn);
  text("CUSTOMER\n");
  parts.push(CMD.boldOff);
  text(order.customer + "\n");
  if (order.customerPhone) text(order.customerPhone + "\n");
  text(rule());

  // Vehicle
  parts.push(CMD.boldOn);
  text("VEHICLE\n");
  parts.push(CMD.boldOff);
  text(order.vehicle + "\n");
  text("Plate: " + order.plate + "\n");
  text(rule());

  // Service / total
  parts.push(CMD.boldOn);
  text("SERVICE\n");
  parts.push(CMD.boldOff);
  const priceStr = `${currencySymbol}${order.servicePrice.toFixed(2)}`;
  text(row(order.service, priceStr) + "\n");

  if (vatPercent > 0) {
    const sub = order.servicePrice / (1 + vatPercent / 100);
    const vat = order.servicePrice - sub;
    text(row("Subtotal", `${currencySymbol}${sub.toFixed(2)}`) + "\n");
    text(row(`VAT (${vatPercent}%)`, `${currencySymbol}${vat.toFixed(2)}`) + "\n");
  }

  text(rule("="));
  parts.push(CMD.boldOn, CMD.doubleOn);
  text(row("TOTAL", priceStr, Math.floor(LINE_WIDTH / 2)) + "\n");
  parts.push(CMD.doubleOff, CMD.boldOff);
  text(rule("="));

  if (typeof order.waitMinutes === "number") {
    text(`Service time: ${order.waitMinutes} min\n`);
  }

  if (order.notes && order.notes.trim()) {
    text("\nNotes:\n");
    text(wrap(order.notes.trim()));
  }

  // Footer
  text("\n");
  parts.push(CMD.alignCenter);
  text(wrap(footer));
  text("\n");

  parts.push(CMD.feed(3));
  parts.push(CMD.cut);

  return concat(parts);
}

// Bluetooth connection -------------------------------------------------------
interface SavedPrinter { name?: string; id?: string; }

function loadSaved(): SavedPrinter | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

function saveDevice(device: BluetoothDevice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: device.name, id: device.id }));
  } catch {}
}

export function getSavedPrinterName(): string | null {
  return loadSaved()?.name ?? null;
}

export function forgetPrinter() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

async function findDevice(): Promise<BluetoothDevice> {
  // Prefer previously-paired device if browser supports getDevices()
  const bt: any = (navigator as any).bluetooth;
  const saved = loadSaved();
  if (saved?.id && typeof bt.getDevices === "function") {
    try {
      const devices: BluetoothDevice[] = await bt.getDevices();
      const match = devices.find((d) => d.id === saved.id);
      if (match) return match;
    } catch { /* fall through to picker */ }
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
    } catch { /* skip restricted services */ }
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
    if (useNoResponse) {
      await characteristic.writeValueWithoutResponse(slice);
    } else {
      await characteristic.writeValue(slice);
    }
    // Small breather lets cheap printers' buffers drain
    await new Promise((r) => setTimeout(r, 20));
  }
}

export async function printReceipt(order: WashOrder, opts?: ReceiptOptions): Promise<string> {
  if (!isBluetoothSupported()) {
    throw new Error(
      "Web Bluetooth is not available in this browser. Use Chrome on Android/desktop, or Bluefy on iOS.",
    );
  }
  const device = await findDevice();
  saveDevice(device);
  const server = await device.gatt!.connect();
  try {
    const characteristic = await findWriteCharacteristic(server);
    const bytes = buildReceiptBytes(order, opts);
    await writeChunks(characteristic, bytes);
    return device.name || "printer";
  } finally {
    try { server.disconnect(); } catch { /* noop */ }
  }
}
