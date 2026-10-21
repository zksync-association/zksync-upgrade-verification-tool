// A payload JSON file dropped on the area it wraps (or chosen with OpenJsonFile) is read here in
// the browser and handed over as text, like a paste: nothing is uploaded. While one is mounted, a
// file dropped elsewhere on the page is ignored instead of the browser opening it in place of the
// app (for the single-file build, the whole app).
import { cn } from "@/utils/cn";
import { FileJson, Upload } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

// A payload is small; a larger file is not one (a diamond cut's calldata stays far below this).
const MAX_BYTES = 5_000_000;

const hasFiles = (types: readonly string[] | DOMStringList | undefined) =>
  !!types && Array.from(types as ArrayLike<string>).includes("Files");

export const TOO_LARGE = "The file is larger than 5 MB: not a payload.";

async function readJson(
  file: File | undefined,
  onText: (text: string) => void,
  onError?: (message: string) => void
) {
  if (!file) return;
  if (file.size > MAX_BYTES) onError?.(TOO_LARGE);
  else onText(await file.text());
}

export function JsonDrop({
  onText,
  onError,
  children,
  label = "Drop the payload JSON file to load it",
  className,
}: {
  onText: (text: string) => void;
  onError?: (message: string) => void;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  // Entering a child fires leave on the parent: counted, so the highlight does not flicker.
  const depth = useRef(0);
  useEffect(() => {
    const ignore = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer?.types)) e.preventDefault();
    };
    addEventListener("dragover", ignore);
    addEventListener("drop", ignore);
    return () => {
      removeEventListener("dragover", ignore);
      removeEventListener("drop", ignore);
    };
  }, []);
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(e) => {
        if (!hasFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e.dataTransfer.types)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e.dataTransfer.types)) return;
        e.preventDefault();
        // Not the window's ignore: this one is read.
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        void readJson(e.dataTransfer.files[0], onText, onError);
      }}
      data-testid="json-drop"
    >
      {children}
      {over && (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-brand-600 border-dashed bg-brand-25/95"
          data-testid="json-drop-over"
        >
          <p className="flex items-center gap-2 font-semibold text-[15px] text-brand-700">
            <FileJson aria-hidden className="h-5 w-5" /> {label}
          </p>
        </div>
      )}
    </div>
  );
}

/** Choose a payload JSON file instead of dropping it. */
export function OpenJsonFile({
  onText,
  onError,
  label = "Open file",
}: {
  onText: (text: string) => void;
  onError?: (message: string) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 font-semibold text-[13px] hover:bg-slate-50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-brand-600">
      <Upload aria-hidden className="h-4 w-4" /> {label}
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          void readJson(e.target.files?.[0], onText, onError);
          // The same file chosen again is read again.
          e.target.value = "";
        }}
      />
    </label>
  );
}
