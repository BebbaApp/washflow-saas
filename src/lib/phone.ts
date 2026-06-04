// Phone helpers tuned for South African numbers but tolerant of international input.

/** Strip everything except digits and a leading '+'. */
export const normalizePhone = (raw: string): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
};

/**
 * Format a phone number for display.
 */
export const formatPhone = (raw: string): string => {
  const n = normalizePhone(raw);
  if (!n) return "";
  if (n.startsWith("+27") && n.length === 12) {
    const r = n.slice(3);
    return `+27 ${r.slice(0, 2)} ${r.slice(2, 5)} ${r.slice(5)}`;
  }
  if (/^0\d{9}$/.test(n)) {
    return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (n.startsWith("+") && n.length >= 8) {
    return `${n.slice(0, 3)} ${n.slice(3).replace(/(\d{3})(?=\d)/g, "$1 ")}`;
  }
  return n;
};

/** Returns null if valid, otherwise an error message. */
export const validatePhone = (raw: string, { required = false } = {}): string | null => {
  const n = normalizePhone(raw);
  if (!n) return required ? "Phone number is required" : null;
  if (/^0\d{9}$/.test(n)) return null;
  if (/^\+\d{8,15}$/.test(n)) return null;
  return "Enter a valid phone number (e.g. 082 123 4567)";
};

/** tel: href safe value. */
export const telHref = (raw: string): string => normalizePhone(raw);

/** Strip everything except digits — for fuzzy phone matching in searches. */
export const phoneDigits = (raw: string | undefined | null): string =>
  (raw ?? "").replace(/\D/g, "");
