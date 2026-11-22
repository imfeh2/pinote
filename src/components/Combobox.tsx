import { useVirtualizer } from "@tanstack/react-virtual";
import { Command } from "cmdk";
import { Check } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/Popover";

const OPTION_HEIGHT = 28;
const LIST_HEIGHT = 240;
const LIST_PADDING = 4;

function OptionList({
  options,
  value,
  checked,
  query,
  optionStyle,
  onSelect,
}: {
  options: string[];
  value?: string;
  checked: string[];
  query: string;
  optionStyle?: (option: string) => CSSProperties;
  onSelect: (option: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastQuery = useRef(query);
  const [startOffset] = useState(() => {
    const index = value === undefined ? -1 : options.indexOf(value);
    if (index < 0) return 0;
    const total = options.length * OPTION_HEIGHT + LIST_PADDING * 2;
    const centered =
      LIST_PADDING + index * OPTION_HEIGHT - (LIST_HEIGHT - OPTION_HEIGHT) / 2;
    return Math.max(0, Math.min(centered, total - LIST_HEIGHT));
  });
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => OPTION_HEIGHT,
    initialRect: { width: 0, height: LIST_HEIGHT },
    initialOffset: startOffset,
    overscan: 8,
    paddingStart: LIST_PADDING,
    paddingEnd: LIST_PADDING,
  });

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = startOffset;
  }, [startOffset]);

  useLayoutEffect(() => {
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    virtualizer.scrollToOffset(0);
  }, [query, virtualizer]);

  return (
    <Command.List
      ref={listRef}
      className="pinote-scrollbar overflow-y-auto"
      style={{ maxHeight: LIST_HEIGHT }}
    >
      <div
        className="relative mx-1"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const option = options[row.index];
          const marked = option === value || checked.includes(option);
          return (
            <Command.Item
              key={option}
              ref={virtualizer.measureElement}
              data-index={row.index}
              value={option}
              disabled={marked && option !== value}
              onSelect={() => onSelect(option)}
              className="absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs data-[disabled=true]:cursor-default data-[disabled=true]:text-muted-foreground data-[selected=true]:bg-accent"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <span
                className="min-w-0 flex-1 truncate"
                style={optionStyle?.(option)}
              >
                {option}
              </span>
              {marked && (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
            </Command.Item>
          );
        })}
      </div>
    </Command.List>
  );
}

export function Combobox({
  options,
  value,
  checked = [],
  label,
  searchPlaceholder,
  emptyText,
  optionStyle,
  onSelect,
  children,
}: {
  options: string[];
  value?: string;
  checked?: string[];
  label: string;
  searchPlaceholder: string;
  emptyText: string;
  optionStyle?: (option: string) => CSSProperties;
  onSelect: (option: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matches = options.filter((option) =>
    option.toLowerCase().includes(query),
  );
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0">
        <Command label={label} shouldFilter={false} defaultValue={value}>
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
            className="h-8 w-full border-b border-border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
          />
          {matches.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            <OptionList
              options={matches}
              value={value}
              checked={checked}
              query={query}
              optionStyle={optionStyle}
              onSelect={(option) => {
                changeOpen(false);
                onSelect(option);
              }}
            />
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
