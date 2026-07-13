import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Shown a short window before the idle auto-logout fires. Clicking
 * "Stay signed in" calls extendSession() which bumps the shared activity
 * timestamp across all tabs.
 */
export function IdleWarningDialog() {
  const { idleWarning, idleSecondsLeft, extendSession, logout, isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;

  const mins = Math.floor(idleSecondsLeft / 60);
  const secs = idleSecondsLeft % 60;
  const timeLabel = mins > 0
    ? `${mins}m ${secs.toString().padStart(2, "0")}s`
    : `${secs}s`;

  return (
    <AlertDialog open={idleWarning}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You'll be signed out in <span className="font-semibold">{timeLabel}</span> due to inactivity.
            Click "Stay signed in" to keep working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void logout()}>Sign out now</AlertDialogCancel>
          <AlertDialogAction onClick={() => extendSession()}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
