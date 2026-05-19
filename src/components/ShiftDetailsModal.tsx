import { useState, useEffect } from "react";
import { Clock, Calendar, User, Tag, Pencil, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Shift, ShiftTemplate } from "@/hooks/useScheduling";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  templates: ShiftTemplate[];
  staffMembers: { id: string; name: string }[];
  isAdmin: boolean;
  onUpdate: (
    shiftId: string,
    data: {
      staffUserId: string;
      templateId?: string | null;
      shiftDate: string;
      startTime: string;
      endTime: string;
      notes?: string | null;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (shiftId: string) => Promise<boolean>;
}

export const ShiftDetailsModal = ({
  open,
  onOpenChange,
  shift,
  templates,
  staffMembers,
  isAdmin,
  onUpdate,
  onDelete,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [staffId, setStaffId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (shift) {
      setStaffId(shift.staffUserId);
      setTemplateId(shift.templateId || "");
      setDate(shift.shiftDate);
      setStart(shift.startTime.slice(0, 5));
      setEnd(shift.endTime.slice(0, 5));
      setNotes(shift.notes || "");
      setEditing(false);
      setError(null);
    }
  }, [shift]);

  if (!shift) return null;

  const tmpl = templates.find((t) => t.id === shift.templateId);
  const dateLabel = new Date(shift.shiftDate + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await onUpdate(shift.id, {
      staffUserId: staffId,
      templateId: templateId || null,
      shiftDate: date,
      startTime: start,
      endTime: end,
      notes: notes.trim() || null,
    });
    if (!res.ok) {
      setError(res.error || "Could not save changes");
      return;
    }
    setEditing(false);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!confirm("Cancel this shift? This cannot be undone.")) return;
    const ok = await onDelete(shift.id);
    if (ok) onOpenChange(false);
  };

  const handleTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setStart(t.startTime.slice(0, 5));
      setEnd(t.endTime.slice(0, 5));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <span
              className="w-2 h-6 rounded-full"
              style={{ backgroundColor: tmpl?.color || "hsl(var(--primary))" }}
            />
            {editing ? "Edit Shift" : "Shift Details"}
          </DialogTitle>
        </DialogHeader>

        {!editing ? (
          <div className="space-y-4 mt-2">
            <div className="space-y-3">
              <Row icon={User} label="Staff" value={shift.staffName || "Unknown"} />
              <Row icon={Calendar} label="Date" value={dateLabel} />
              <Row
                icon={Clock}
                label="Time"
                value={`${shift.startTime.slice(0, 5)} – ${shift.endTime.slice(0, 5)}`}
              />
              <Row icon={Tag} label="Template" value={tmpl?.name || "Custom"} />
              {shift.notes && (
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{shift.notes}</p>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <button
                  onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive/10 text-destructive font-semibold text-sm hover:bg-destructive/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Cancel Shift
                </button>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Staff Member</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {staffMembers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Template</Label>
              <Select value={templateId} onValueChange={handleTemplate}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder="Custom" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.startTime.slice(0, 5)}–{t.endTime.slice(0, 5)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-secondary border-border text-foreground" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Start</Label>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="bg-secondary border-border text-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">End</Label>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="bg-secondary border-border text-foreground" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <X className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
                Discard
              </button>
              <button type="submit" className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
                Save Changes
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

function Row({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
