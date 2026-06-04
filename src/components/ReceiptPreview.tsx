import { renderReceiptText, type ReceiptSegment, type ReceiptLine, type ReceiptCols, LINE_WIDTH } from "@/lib/thermalPrinter";

interface Props {
  model: ReceiptSegment[];
  className?: string;
}

/**
 * Visual approximation of the ESC/POS receipt: 80mm paper, monospace,
 * honoring bold/double/alignment so the operator sees what will print.
 */
export const ReceiptPreview = ({ model, className = "" }: Props) => {
  return (
    <div
      className={`mx-auto bg-white text-black rounded-md shadow-lg p-4 font-mono text-[12px] leading-[1.35] w-fit max-w-full overflow-x-auto ${className}`}
      // Width is driven by the 48-char monospace pre below so the rule lines never get clipped.
    >
      <pre className="m-0 whitespace-pre" style={{ width: `${LINE_WIDTH}ch` }}>
        {model.map((s, i) => <SegmentLine key={i} seg={s} />)}
      </pre>
    </div>
  );
};

function SegmentLine({ seg }: { seg: ReceiptSegment }) {
  if (seg.kind === "blank") return <div>{"\u00A0"}</div>;
  if (seg.kind === "rule") return <div>{seg.char.repeat(LINE_WIDTH)}</div>;

  if (seg.kind === "cols") {
    return (
      <div
        className={`${seg.bold ? "font-bold" : ""} ${seg.double ? "text-[18px] leading-[1.2]" : ""} flex justify-between gap-3`}
      >
        <span>{seg.left}</span>
        <span>{seg.right}</span>
      </div>
    );
  }

  const t = seg as ReceiptLine;
  const align = t.align === "center" ? "text-center" : t.align === "right" ? "text-right" : "text-left";
  return (
    <div className={`${align} ${t.bold ? "font-bold" : ""} ${t.double ? "text-[18px] leading-[1.2]" : ""}`}>
      {t.text || "\u00A0"}
    </div>
  );
}

/** Renders the plain monospace text version — used if you want raw output. */
export const ReceiptPlainText = ({ model }: { model: ReceiptSegment[] }) => (
  <pre className="font-mono text-xs whitespace-pre bg-white text-black p-3 rounded">
    {renderReceiptText(model)}
  </pre>
);
