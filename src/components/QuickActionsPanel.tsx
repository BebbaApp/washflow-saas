import { Plus, ListOrdered, Gift, CalendarDays, ClipboardCheck, Car } from "lucide-react";

interface QuickActionsPanelProps {
  onNewOrder: () => void;
  onNavigate: (tab: string) => void;
  activeOrders: number;
}

const actions = [
  { id: "new-order", label: "New Order", icon: Plus, color: "bg-primary text-primary-foreground" },
  { id: "queue", label: "Queue", icon: ListOrdered, color: "bg-secondary text-secondary-foreground" },
  { id: "loyalty", label: "Loyalty", icon: Gift, color: "bg-secondary text-secondary-foreground" },
  { id: "schedule", label: "Schedule", icon: CalendarDays, color: "bg-secondary text-secondary-foreground" },
  { id: "complete", label: "Complete", icon: ClipboardCheck, color: "bg-secondary text-secondary-foreground" },
  { id: "services", label: "Services", icon: Car, color: "bg-secondary text-secondary-foreground" },
];

export function QuickActionsPanel({ onNewOrder, onNavigate, activeOrders }: QuickActionsPanelProps) {
  const handleAction = (id: string) => {
    if (id === "new-order") {
      onNewOrder();
    } else if (id === "complete") {
      onNavigate("queue");
    } else {
      onNavigate(id);
    }
  };

  return (
    <div className="md:hidden mb-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h3>
      <div className="grid grid-cols-3 gap-3">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => handleAction(action.id)}
            className={`relative flex flex-col items-center gap-2 p-4 rounded-xl ${action.color} transition-all active:scale-95`}
            style={action.id === "new-order" ? { boxShadow: "var(--shadow-glow)" } : {}}
          >
            <action.icon className="w-6 h-6" />
            <span className="text-xs font-medium">{action.label}</span>
            {action.id === "queue" && activeOrders > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                {activeOrders}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
