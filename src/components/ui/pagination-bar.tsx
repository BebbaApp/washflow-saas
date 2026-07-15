import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationBarProps {
  page: number;                // 1-indexed
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

/**
 * Compact numbered pagination bar with prev/next + optional page-size selector.
 * Renders nothing when there is only one page and no size selector is offered.
 */
export function PaginationBar({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  className = "",
}: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  if (totalCount === 0) return null;

  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, totalCount);

  // Build a compact page list: 1 … c-1 c c+1 … last
  const pages: (number | "…")[] = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  if (current - 1 > 2) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(totalPages - 1, current + 1); p++) add(p);
  if (current + 1 < totalPages - 1) pages.push("…");
  if (totalPages > 1) add(totalPages);

  return (
    <div className={`flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground ${className}`}>
      <span>
        Showing <span className="text-foreground font-semibold">{from}</span>–
        <span className="text-foreground font-semibold">{to}</span> of{" "}
        <span className="text-foreground font-semibold">{totalCount}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground disabled:opacity-40 hover:opacity-90"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-2">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[28px] px-2 py-1.5 rounded-md border text-xs font-semibold ${
                p === current
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-secondary text-secondary-foreground hover:opacity-90"
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onPageChange(current + 1)}
          disabled={current >= totalPages}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-border bg-secondary text-secondary-foreground disabled:opacity-40 hover:opacity-90"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="ml-2 bg-card border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
