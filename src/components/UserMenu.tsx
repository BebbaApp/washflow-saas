import { useState } from "react";
import { Link } from "react-router-dom";
import {
  LogOut, Settings as SettingsIcon, Sun, Moon, ChevronDown, User as UserIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useTenant } from "@/hooks/useTenant";
import { ProfileDialog } from "@/components/ProfileDialog";

interface UserMenuProps {
  /** Optional handler when "Settings" is clicked. If omitted, item is hidden. */
  onOpenSettings?: () => void;
  /** Show link back to the main app workspace (useful from platform console). */
  showAppLink?: boolean;
}

export function UserMenu({ onOpenSettings, showAppLink = false }: UserMenuProps) {
  const { user, logout, updateProfile } = useAuth();
  const { mode, toggleMode } = useTheme();
  const { isSuperAdmin } = useTenant();
  const [profileOpen, setProfileOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <UserIcon className="w-4 h-4" />
          </div>
          <div className="text-left leading-tight">
            <p className="font-medium text-foreground">{user.name || user.email}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{user.role}</p>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-card border-border">
          <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setProfileOpen(true)}>
            <UserIcon className="w-4 h-4 mr-2" /> My profile
          </DropdownMenuItem>
          {onOpenSettings && (
            <DropdownMenuItem onClick={onOpenSettings}>
              <SettingsIcon className="w-4 h-4 mr-2" /> Settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={toggleMode}>
            {mode === "dark" ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
            {mode === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          {showAppLink && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/"><SettingsIcon className="w-4 h-4 mr-2" /> Back to app</Link>
              </DropdownMenuItem>
            </>
          )}
          {!showAppLink && isSuperAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/platform"><SettingsIcon className="w-4 h-4 mr-2" /> Platform console</Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initialName={user.name || ""}
        initialPhone={user.phone || ""}
        email={user.email}
        onSave={updateProfile}
        reason={user.phone ? "edit" : "missing_phone"}
      />
    </>
  );
}
