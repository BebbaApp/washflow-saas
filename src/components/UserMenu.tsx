import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown, LogOut, Moon, Sun, User as UserIcon,
  Settings as SettingsIcon, Shield, ArrowLeft,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileDialog } from "@/components/ProfileDialog";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useTheme } from "@/hooks/useTheme";

interface UserMenuProps {
  /** Optional click handler for the Settings item (e.g. switch tab in-app).
   *  If omitted, navigates to /settings. */
  onOpenSettings?: () => void;
  /** Hide the Settings entry entirely (e.g. on the Platform console). */
  hideSettings?: boolean;
}

export function UserMenu({ onOpenSettings, hideSettings }: UserMenuProps) {
  const { user, logout, updateProfile } = useAuth();
  const { isSuperAdmin } = useTenant();
  const { mode, toggleMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);

  const onPlatform = location.pathname.startsWith("/platform");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <UserIcon className="w-4 h-4" />
          </div>
          <div className="text-left leading-tight hidden sm:block">
            <p className="font-medium text-foreground">{user?.name || user?.email}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{user?.role}</p>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-card border-border">
          <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setProfileOpen(true)}>
            <UserIcon className="w-4 h-4 mr-2" /> My profile
          </DropdownMenuItem>
          {!hideSettings && (
            <DropdownMenuItem
              onClick={() => (onOpenSettings ? onOpenSettings() : navigate("/settings"))}
            >
              <SettingsIcon className="w-4 h-4 mr-2" /> Settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={toggleMode}>
            {mode === "dark" ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
            {mode === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          {isSuperAdmin && (
            <>
              <DropdownMenuSeparator />
              {onPlatform ? (
                <DropdownMenuItem asChild>
                  <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" /> Back to app</Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild>
                  <Link to="/platform"><Shield className="w-4 h-4 mr-2" /> Platform console</Link>
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {user && (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          user={user}
          onSave={updateProfile}
        />
      )}
    </>
  );
}
