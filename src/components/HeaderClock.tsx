import { useEffect, useState } from "react";

export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = now.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="hidden sm:flex flex-col items-center justify-center rounded-md border border-border bg-secondary/60 px-2.5 py-1 leading-tight tabular-nums"
      aria-label="Current time and date"
    >
      <span className="text-sm font-semibold text-foreground">{time}</span>
      <span className="text-[11px] text-muted-foreground">{date}</span>
    </div>
  );
}
