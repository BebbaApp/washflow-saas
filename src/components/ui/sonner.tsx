import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "pointer-events-auto w-[min(92vw,420px)] rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl flex items-start gap-3 bg-gradient-to-br from-primary/90 via-accent/85 to-info/90 text-primary-foreground border-white/20",
          title: "font-semibold tracking-tight",
          description: "text-primary-foreground/90 text-xs mt-0.5",
          actionButton: "bg-white/20 text-primary-foreground rounded-md px-2 py-1 text-xs",
          cancelButton: "bg-black/20 text-primary-foreground rounded-md px-2 py-1 text-xs",
          success:
            "bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 text-white border-white/30",
          error:
            "bg-gradient-to-br from-rose-500 via-pink-500 to-orange-500 text-white border-white/30",
          warning:
            "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white border-white/30",
          info:
            "bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-500 text-white border-white/30",
        },
      }}
      style={
        {
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster, toast };
