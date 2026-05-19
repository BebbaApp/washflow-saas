import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Building2 } from "lucide-react";
import { useTenant } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  compact?: boolean;
}

export function TenantSwitcher({ compact }: Props) {
  const { tenant, memberships, switchTenant } = useTenant();
  const { toast } = useToast();
  const [switching, setSwitching] = useState<string | null>(null);

  if (memberships.length <= 1) return null;

  const handle = async (id: string) => {
    if (id === tenant?.id) return;
    setSwitching(id);
    try {
      await switchTenant(id);
      toast({ title: "Workspace switched" });
    } catch (e: any) {
      toast({ title: "Switch failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSwitching(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className="gap-2 max-w-[200px]"
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{tenant?.name ?? "Workspace"}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={(e) => { e.preventDefault(); handle(m.id); }}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex flex-col min-w-0">
              <span className="truncate text-sm">{m.name}</span>
              <span className="text-[10px] text-muted-foreground capitalize">{m.tenant_role}</span>
            </div>
            {switching === m.id
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : m.id === tenant?.id
                ? <Check className="w-3.5 h-3.5 text-primary" />
                : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
