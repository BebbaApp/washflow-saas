import { Construction } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export const ComingSoon = ({ title, description }: ComingSoonProps) => {
  return (
    <div className="glass-card p-12 flex flex-col items-center justify-center text-center space-y-3">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Construction className="w-7 h-7 text-primary" />
      </div>
      <h3 className="text-xl font-bold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {description || "This module is coming soon. Let us know if you'd like it built out."}
      </p>
    </div>
  );
};
