import * as React from "react";

import { cn } from "@/lib/utils";

// Input types where auto-capitalising the first letter of each word makes
// sense. Emails, passwords, numbers, dates, etc. are intentionally excluded.
const CAPITALIZE_TYPES = new Set(["text", "search", undefined, ""]);

// Capitalize the first letter of every word without touching the remaining
// characters — this preserves acronyms and user-entered casing mid-word.
const toCapitalizedWords = (value: string): string =>
  value.replace(/(^|\s|[-/(])(\S)/g, (_, prefix: string, char: string) => prefix + char.toUpperCase());

type InputProps = React.ComponentProps<"input"> & {
  /** Set to true to opt out of the global "capitalize words" behaviour. */
  "data-no-capitalize"?: boolean;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onChange, autoCapitalize, ...props }, ref) => {
    const shouldCapitalize =
      CAPITALIZE_TYPES.has(type as string | undefined) &&
      !(props as any)["data-no-capitalize"];

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        if (shouldCapitalize) {
          const el = event.target;
          const original = el.value;
          const transformed = toCapitalizedWords(original);
          if (transformed !== original) {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            el.value = transformed;
            // Restore caret so the user keeps typing where they were.
            if (start !== null && end !== null) {
              try { el.setSelectionRange(start, end); } catch { /* ignore */ }
            }
          }
        }
        onChange?.(event);
      },
      [onChange, shouldCapitalize],
    );

    return (
      <input
        type={type}
        autoCapitalize={autoCapitalize ?? (shouldCapitalize ? "words" : undefined)}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
