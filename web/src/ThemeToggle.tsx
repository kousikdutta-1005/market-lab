import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTheme, type ThemeChoice } from '@/lib/theme';

/** Theme switch. Keeps "System" selectable so the OS preference is never silently lost. */
export function ThemeToggle() {
  const { choice, resolved, setChoice } = useTheme();
  const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-10 shrink-0 sm:size-8" title="Theme">
          {resolved === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          <span className="sr-only">Change theme (currently {choice})</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setChoice(value)}>
            <Icon className="mr-2 size-4" />
            {label}
            {choice === value && <span className="ml-auto text-muted-foreground">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
