import { Columns3, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  COLUMNS, COLUMN_GROUPS, PRESETS, presetColumns,
  type ColumnContext,
} from './lib/columns';

export function ColumnPicker({
  visible,
  onChange,
  ctx,
  activePreset,
  onPreset,
}: {
  visible: string[];
  onChange: (ids: string[]) => void;
  ctx: ColumnContext;
  activePreset: string | null;
  onPreset: (id: string) => void;
}) {
  const set = new Set(visible);
  const count = COLUMNS.filter((c) => c.pinned || set.has(c.id)).length;

  function toggle(id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 sm:h-8">
          <Columns3 className="size-4" />
          Columns
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {count}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-foreground">Views</DropdownMenuLabel>
        {PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={(e) => {
              e.preventDefault();
              onPreset(p.id);
              onChange(presetColumns(p.id));
            }}
          >
            <span className="flex-1">
              <span className="block">{p.label}</span>
              <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
            </span>
            {activePreset === p.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}

        {COLUMN_GROUPS.map((group) => {
          const cols = COLUMNS.filter((c) => c.group === group && !c.pinned);
          if (!cols.length) return null;
          return (
            <div key={group}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-foreground">{group}</DropdownMenuLabel>
              {cols.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={set.has(c.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggle(c.id)}
                >
                  {c.label(ctx)}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
