"use client";

import {
  Bold,
  Heading2,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
} from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/markdown";
import {
  applyEdit,
  continueList,
  insertLink,
  toggleBlock,
  toggleInline,
  type BlockKind,
  type Edit,
  type InlineMark,
} from "@/lib/markdown-edit";
import { cn } from "@/lib/utils";

/**
 * A scope of work, written by somebody who has never heard of Markdown.
 *
 * The bar alone would not do it. Press bold without one and you get `**text**`
 * on screen, which to most people looks like the thing went wrong — so Preview
 * is half the feature, not a nicety. It renders through the same `<Markdown>`
 * the job page uses, which is the only way to be sure the two agree.
 *
 * Nine buttons, and every one writes syntax the parser already reads. Checklist
 * leads because a scope is a list of things to do and those lines become
 * tickable on site, which is this app's own trick and the one nobody discovers
 * by accident.
 *
 * Works controlled (a form that holds its own state) or uncontrolled (a plain
 * `name=` in a server action's form). Both go through the same path, because
 * every edit is applied to the textarea itself and React hears about it the
 * ordinary way.
 */

type Tool =
  | { kind: "inline"; mark: InlineMark }
  | { kind: "block"; block: BlockKind }
  | { kind: "link" };

const BLOCK_TOOLS: {
  block: BlockKind;
  label: string;
  Icon: typeof List;
  lead?: boolean;
}[] = [
  { block: "checklist", label: "Checklist", Icon: ListChecks, lead: true },
  { block: "bullet", label: "Bulleted list", Icon: List },
  { block: "numbered", label: "Numbered list", Icon: ListOrdered },
  { block: "heading", label: "Heading", Icon: Heading2 },
];

const INLINE_TOOLS: { mark: InlineMark; label: string; Icon: typeof Bold }[] = [
  { mark: "bold", label: "Bold", Icon: Bold },
  { mark: "italic", label: "Italic", Icon: Italic },
  { mark: "highlight", label: "Highlight", Icon: Highlighter },
  { mark: "strike", label: "Strikethrough", Icon: Strikethrough },
];

export function MarkdownEditor({
  id,
  name,
  value,
  defaultValue,
  onChange,
  rows = 8,
  placeholder,
  hint = "Lines you start with the tick become a checklist the crew can tick off on site.",
  autoFocus,
  className,
}: {
  id?: string;
  /** For a form that posts the textarea rather than holding its value. */
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  rows?: number;
  placeholder?: string;
  /** One line under the bar. Null for none. */
  hint?: string | null;
  autoFocus?: boolean;
  className?: string;
}) {
  const box = React.useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = React.useState<"write" | "preview">("write");
  // Only for the preview to read when nobody outside is holding the value.
  const [own, setOwn] = React.useState(defaultValue ?? "");
  const text = value ?? own;

  /**
   * Hands the edit to the browser's own insert command.
   *
   * `execCommand` is on its way out and there is still nothing else that edits
   * a textarea without clearing its undo stack. Where it is refused the value
   * is written directly and the change announced by hand, which costs the undo
   * history for that one press rather than the whole feature.
   */
  function apply(edit: Edit) {
    const el = box.current;
    if (!el) return;

    el.focus();
    el.setSelectionRange(edit.from, edit.to);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, edit.insert);
    } catch {
      inserted = false;
    }

    if (!inserted) {
      const next = applyEdit(el.value, edit);
      el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    // A refused insert leaves React's state untouched, and a controlled box
    // would snap back to the old value on the next render.
    if (!inserted) {
      setOwn(el.value);
      onChange?.(el.value);
    }
  }

  function run(tool: Tool) {
    const el = box.current;
    if (!el) return;

    const { value: source, selectionStart, selectionEnd } = el;
    if (tool.kind === "inline") {
      apply(toggleInline(source, selectionStart, selectionEnd, tool.mark));
    } else if (tool.kind === "block") {
      apply(toggleBlock(source, selectionStart, selectionEnd, tool.block));
    } else {
      apply(insertLink(source, selectionStart, selectionEnd));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;

    if (event.key === "Enter" && !event.shiftKey) {
      // Only when the caret is a caret: Enter over a selection is a replace,
      // and carrying a marker into it would be a surprise.
      if (el.selectionStart !== el.selectionEnd) return;
      const edit = continueList(el.value, el.selectionStart);
      if (!edit) return;
      event.preventDefault();
      apply(edit);
      return;
    }

    if (!event.metaKey && !event.ctrlKey) return;
    const shortcut: Record<string, Tool> = {
      b: { kind: "inline", mark: "bold" },
      i: { kind: "inline", mark: "italic" },
      k: { kind: "link" },
    };
    const tool = shortcut[event.key.toLowerCase()];
    if (!tool) return;
    event.preventDefault();
    run(tool);
  }

  const buttonClass = cn(
    "flex min-h-11 items-center justify-center rounded-lg border border-border",
    "bg-surface-raised transition-colors hover:bg-muted active:bg-muted",
  );

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div
        role="tablist"
        aria-label="Scope editor"
        className="flex gap-0.5 self-start rounded-lg border border-border bg-surface-raised p-0.5"
      >
        {(["write", "preview"] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            aria-selected={tab === one}
            onClick={() => setTab(one)}
            className={cn(
              "min-h-8 rounded-md px-3.5 text-xs transition-colors",
              tab === one
                ? "bg-primary font-semibold text-primary-foreground"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {one === "write" ? "Write" : "Preview"}
          </button>
        ))}
      </div>

      {/* Hidden rather than unmounted: the box keeps its caret, its scroll and
          its undo history while somebody checks the preview. */}
      <div className={cn("flex flex-col gap-1.5", tab === "write" || "hidden")}>
        <div className="grid grid-cols-4 gap-1.5">
          {BLOCK_TOOLS.map(({ block, label, Icon, lead }) => (
            <button
              key={block}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => run({ kind: "block", block })}
              className={cn(buttonClass, lead && "text-primary")}
            >
              <Icon className="size-4.5" />
            </button>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {INLINE_TOOLS.map(({ mark, label, Icon }) => (
            <button
              key={mark}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => run({ kind: "inline", mark })}
              className={buttonClass}
            >
              <Icon className="size-4.5" />
            </button>
          ))}
          <button
            type="button"
            title="Link"
            aria-label="Link"
            onClick={() => run({ kind: "link" })}
            className={buttonClass}
          >
            <LinkIcon className="size-4.5" />
          </button>
        </div>
      </div>

      <textarea
        ref={box}
        id={id}
        name={name}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        // Controlled when somebody outside holds the value, uncontrolled when
        // the surrounding form posts it by name.
        {...(value === undefined
          ? { defaultValue: defaultValue ?? "" }
          : { value })}
        onChange={(event) => {
          setOwn(event.target.value);
          onChange?.(event.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full resize-y rounded-lg border border-border bg-input px-3 py-2",
          "font-mono text-[13px] leading-relaxed text-foreground",
          "placeholder:text-muted-foreground",
          tab === "write" || "hidden",
        )}
      />

      {tab === "preview" ? (
        <div className="min-h-32 rounded-lg border border-border bg-input p-3">
          {text.trim() ? (
            <Markdown source={text} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing written yet.</p>
          )}
        </div>
      ) : null}

      {hint ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {tab === "preview"
            ? "Exactly what the crew will see on the job."
            : hint}
        </p>
      ) : null}
    </div>
  );
}
