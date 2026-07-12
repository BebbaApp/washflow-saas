import { useMemo, useState } from "react";
import { Calendar, Check, X, Send } from "lucide-react";
import { toast } from "sonner";

import { useScheduling, type TimeOffRequest } from "@/hooks/useScheduling";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

function fmt(d: string) {
  try { return new Date(d + "T00:00:00").toLocaleDateString(); } catch { return d; }
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function StatusBadge({ status }: { status: TimeOffRequest["status"] }) {
  const map: Record<TimeOffRequest["status"], string> = {
    pending: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
    approved: "bg-green-500/15 text-green-700 border-green-500/30",
    rejected: "bg-red-500/15 text-red-700 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`capitalize ${map[status]}`}>{status}</Badge>
  );
}

export function TimeOffPanel() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const canRequest = can("staff.timeOff.request");
  const canApprove = can("staff.timeOff.approve");

  const { staffMembers, timeOffRequests, submitTimeOffRequest, updateTimeOffStatus } = useScheduling();

  const minDate = todayYmd();
  const [targetUserId, setTargetUserId] = useState<string>(user?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requestedDays = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return 0;
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
  }, [startDate, endDate]);


  const sortedStaff = useMemo(
    () => [...staffMembers].sort((a, b) => a.name.localeCompare(b.name)),
    [staffMembers],
  );

  const activeRequests = useMemo(
    () => timeOffRequests
      .filter((r) => r.status === "pending" || r.status === "approved")
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1)),
    [timeOffRequests],
  );
  const otherRequests = useMemo(
    () => timeOffRequests.filter((r) => r.userId !== user?.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [timeOffRequests, user?.id],
  );

  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const historyRequests = useMemo(() => {
    return timeOffRequests
      .filter((r) => {
        if (historyFrom && r.endDate < historyFrom) return false;
        if (historyTo && r.startDate > historyTo) return false;
        return true;
      })
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }, [timeOffRequests, historyFrom, historyTo]);

  const staffNameFor = (r: TimeOffRequest) =>
    r.staffName || staffMembers.find((s) => s.id === r.userId)?.name || "Staff";

  const submit = async () => {
    if (!targetUserId) { toast.error("Select an employee"); return; }
    if (!startDate || !endDate) { toast.error("Pick start and end dates"); return; }
    if (startDate < minDate) { toast.error("Start date must be in the future"); return; }
    if (endDate < startDate) { toast.error("End date must be after start date"); return; }
    setSubmitting(true);
    try {
      await submitTimeOffRequest({
        startDate, endDate, reason: reason.trim(),
        targetUserId: targetUserId !== user?.id ? targetUserId : undefined,
      });
      setStartDate(""); setEndDate(""); setReason("");
      setTargetUserId(user?.id ?? "");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {canRequest && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Request Time Off</h3>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Employee</label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                {sortedStaff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.id === user?.id ? " (you)" : ""}
                  </SelectItem>
                ))}
                {sortedStaff.length === 0 && user?.id && (
                  <SelectItem value={user.id}>You</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Start date</label>
              <Input
                type="date" value={startDate} min={minDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">End date</label>
              <Input
                type="date" value={endDate} min={startDate || minDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {startDate && endDate && (
            <p className="text-xs text-muted-foreground">
              Requesting <span className="font-medium text-foreground">{requestedDays}</span> day{requestedDays !== 1 ? "s" : ""} off
            </p>
          )}
          <div>

            <label className="text-xs text-muted-foreground block mb-1">Reason (optional)</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Personal, medical, family, etc."
              rows={2}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={submitting} size="sm">
              <Send className="w-4 h-4 mr-1" /> Submit request
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Time Off Requested</h3>
        {activeRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending or approved requests.</p>
        ) : (
          <ul className="divide-y divide-border">
            {activeRequests.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{staffNameFor(r)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmt(r.startDate)} → {fmt(r.endDate)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold">History</h3>
          <div className="flex items-center gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From</label>
              <Input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} className="h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">To</label>
              <Input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} className="h-8" />
            </div>
            {(historyFrom || historyTo) && (
              <Button variant="ghost" size="sm" className="mt-4" onClick={() => { setHistoryFrom(""); setHistoryTo(""); }}>
                Clear
              </Button>
            )}
          </div>
        </div>
        {historyRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests in this range.</p>
        ) : (
          <ul className="divide-y divide-border">
            {historyRequests.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{staffNameFor(r)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmt(r.startDate)} → {fmt(r.endDate)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {canApprove && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Team Requests</h3>
          {otherRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending team requests.</p>
          ) : (
            <ul className="divide-y divide-border">
              {otherRequests.map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.staffName || staffMembers.find((s) => s.id === r.userId)?.name || "Staff"}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmt(r.startDate)} → {fmt(r.endDate)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    {r.status === "pending" && (
                      <>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => updateTimeOffStatus(r.id, "approved")}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => updateTimeOffStatus(r.id, "rejected")}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
