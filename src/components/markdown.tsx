import * as React from "react";
import { parseMarkdown, type Block } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Renders parsed scope of work. The HTML handed to dangerouslySetInnerHTML has
 * already been escaped and rebuilt from an allowlist in parseMarkdown, so it
 * cannot carry anything the parser did not deliberately emit.
 *
 * Checklist items are handed to `renderCheck` so the caller decides whether
 * they are live controls or static marks.
 */
export function Markdown({
  source,
  className,
  renderCheck,
}: {
  source: string;
  className?: string;
  renderCheck?: (check: { key: string; checked: boolean }) => React.ReactNode;
}) {
  const blocks = parseMarkdown(source);

  return (
    <div className={cn("flex flex-col gap-2 text-sm leading-relaxed", className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} renderCheck={renderCheck} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  renderCheck,
}: {
  block: Block;
  renderCheck?: (check: { key: string; checked: boolean }) => React.ReactNode;
}) {
  switch (block.type) {
    case "heading": {
      const sizes = [
        "text-base font-semibold",
        "text-base font-semibold",
        "text-sm font-semibold",
        "text-sm font-semibold",
        "text-xs font-semibold uppercase tracking-wide",
        "text-xs font-semibold uppercase tracking-wide",
      ];
      return (
        <p
          className={sizes[block.level - 1]}
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );
    }

    case "paragraph":
      return <p dangerouslySetInnerHTML={{ __html: block.html }} />;

    case "quote":
      return (
        <blockquote
          className="border-l-2 border-primary/50 pl-3 text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: block.html }}
        />
      );

    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          <code>{block.text}</code>
        </pre>
      );

    case "rule":
      return <hr className="border-border" />;

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={cn(
            "flex flex-col gap-1.5 pl-5",
            block.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {block.items.map((item, index) => (
            <li
              key={item.check?.key ?? index}
              // Checklist rows carry their own marker, so the bullet is dropped
              // and the row is pulled back into line with the plain items.
              className={item.check ? "-ml-5 list-none" : undefined}
            >
              {item.check ? (
                <span className="flex items-start gap-2">
                  {renderCheck ? (
                    renderCheck(item.check)
                  ) : (
                    <input
                      type="checkbox"
                      checked={item.check.checked}
                      readOnly
                      className="mt-0.5 size-4 accent-[var(--color-primary)]"
                    />
                  )}
                  <span
                    className={cn(item.check.checked && "text-muted-foreground")}
                    dangerouslySetInnerHTML={{ __html: item.html }}
                  />
                </span>
              ) : (
                <span dangerouslySetInnerHTML={{ __html: item.html }} />
              )}
            </li>
          ))}
        </Tag>
      );
    }
  }
}
