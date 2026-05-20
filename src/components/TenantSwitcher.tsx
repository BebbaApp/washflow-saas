import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Building2, AlertTriangle } from "lucide-react";
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
  const { tenant, memberships, switchTenant, switchError, clearSwitchError } = useTenant();
  const { toast } = useToast();
  const [switching, setSwitching] = useState<string | null>(null);

  if (memberships.length <= 1) return null;

  const handle = async (id: string) => {
    if (id === tenant?.id) return;
    setSwitching(id);
    clearSwitchError();
    try {
      await switchTenant(id);
      toast({ title: "Workspace switched" });
    } catch (e: any) {
      toast({
        title: "Switch failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSwitching(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={switchError ? "destructive" : "outline"}
          size={compact ? "sm" : "default"}
          className="gap-2 max-w-[220px]"
        >
          {switchError
            ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            : <Building2 className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">{tenant?.name ?? "Workspace"}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {switchError && (
          <>
            <div className="px-2 py-2 text-[11px] text-destructive flex gap-1.5 items-start">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="leading-snug">{switchError}</span>
            </div>
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); clearSwitchError(); }}
              className="text-xs justify-center"
            >
              Dismiss
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
