import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      offset={{ top: "5rem" }}
      mobileOffset={{ top: "4.5rem" }}
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "pointer-events-auto w-[min(92vw,420px)] rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl flex items-start gap-3 bg-card text-card-foreground border-border",
          title: "font-semibold tracking-tight",
          description: "text-xs mt-0.5 opacity-90",
          actionButton: "bg-white/20 text-current rounded-md px-2 py-1 text-xs",
          cancelButton: "bg-black/20 text-current rounded-md px-2 py-1 text-xs",
          success: "bg-emerald-600 text-white border-emerald-500",
          error: "bg-red-600 text-white border-red-500",
          warning: "bg-amber-500 text-white border-amber-400",
          info: "bg-sky-600 text-white border-sky-500",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
