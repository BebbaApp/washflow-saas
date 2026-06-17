import { Plus, MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";

export interface BottomNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface MobileBottomNavProps {
  primary: BottomNavItem[]; // up to 2 left + 2 right (4 total around center)
  overflow: BottomNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewOrder?: () => void;
  showNewOrder?: boolean;
}

/**
 * iOS-style floating bottom navigation. Visible on mobile + tablet only
 * (hidden at lg breakpoint where the desktop sidebar takes over).
 *
 * Layout: [item][item] [ + center FAB ] [item][item][more]
 */
export function MobileBottomNav({
  primary,
  overflow,
  activeId,
  onSelect,
  onNewOrder,
  showNewOrder = true,
}: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const left = primary.slice(0, 2);
  const right = primary.slice(2, 4);

  const renderTab = (item: BottomNavItem) => {
    const isActive = activeId === item.id;
    return (
      <button
        key={item.id}
        onClick={() => onSelect(item.id)}
        className={`flex flex-col items-center justify-center gap-1 flex-1 min-w-0 py-1.5 md:py-2.5 transition-colors ${
          isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
        aria-label={item.label}
      >
        <item.icon className={`w-5 h-5 md:w-6 md:h-6 ${isActive ? "stroke-[2.5]" : ""}`} />
        <span className={`text-[10px] md:text-xs leading-none truncate max-w-full ${isActive ? "font-semibold" : "font-medium"}`}>
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <>
      {/* Spacer so page content isn't hidden behind the floating bar */}
      <div className="lg:hidden h-24" aria-hidden />

      <nav
        className="lg:hidden fixed bottom-3 left-3 right-3 z-40"
        aria-label="Primary"
      >
        <div className="relative mx-auto max-w-md rounded-2xl bg-card/95 backdrop-blur border border-border shadow-[0_8px_30px_rgba(0,0,0,0.12)] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end justify-between gap-1">
            <div className="flex flex-1 justify-around">
              {left.map(renderTab)}
            </div>

            {/* Center FAB slot */}
            <div className="flex-shrink-0 w-16 flex justify-center">
              {showNewOrder ? (
                <button
                  onClick={onNewOrder}
                  aria-label="New Wash Order"
                  className="-mt-7 w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg ring-4 ring-background active:scale-95 transition-transform"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.85) 100%)",
                  }}
                >
                  <Plus className="w-7 h-7" strokeWidth={2.5} />
                </button>
              ) : (
                <div className="w-14 h-14" />
              )}
            </div>

            <div className="flex flex-1 justify-around">
              {right.map(renderTab)}
              {overflow.length > 0 && (
                <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
                  <SheetTrigger asChild>
                    <button
                      className="flex flex-col items-center justify-center gap-1 flex-1 min-w-0 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="More"
                    >
                      <MoreHorizontal className="w-5 h-5" />
                      <span className="text-[10px] leading-none font-medium">More</span>
                    </button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="rounded-t-2xl bg-card border-border">
                    <SheetHeader>
                      <SheetTitle className="text-foreground">More menu</SheetTitle>
                    </SheetHeader>
                    <div className="grid grid-cols-4 gap-3 mt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                      {overflow.map((item) => {
                        const isActive = activeId === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              onSelect(item.id);
                              setMoreOpen(false);
                            }}
                            className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-colors ${
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "bg-secondary text-secondary-foreground hover:bg-muted"
                            }`}
                          >
                            <item.icon className="w-5 h-5" />
                            <span className="text-xs font-medium text-center leading-tight">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </SheetContent>
                </Sheet>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
