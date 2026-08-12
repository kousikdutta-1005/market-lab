import { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Send, Sparkles, KeyRound, ExternalLink, Trash2, Table2, TriangleAlert } from 'lucide-react';
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { loadChart } from '@/lib/dataSource';
import { askAnalyst, type AnalystResult } from '@/lib/analyst';
import { PROVIDERS, type AIConfig, type ProviderId } from '@/lib/providers';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ChartPoint, Screen } from './types';

/**
 * The assistant runs on the visitor's own free API key.
 *
 * Routing this through a server would mean one shared key paying for every user's tokens
 * — the only part of the product with a per-request cost that grows with traffic. The key
 * lives in this browser's localStorage and is sent only to Google.
 */
const CONFIG_STORAGE = 'ml-ai-config';

function loadConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE);
    if (raw) {
      const c = JSON.parse(raw) as AIConfig;
      if (c?.provider && (c.apiKey || c.provider === 'compatible')) return c;
    }
    // Migrate anyone who had already saved a key under the Gemini-only scheme.
    const legacy = localStorage.getItem('ml-gemini-key');
    if (legacy) return { provider: 'gemini', apiKey: legacy, model: 'gemini-2.0-flash' };
  } catch {
    /* fall through to setup */
  }
  return null;
}

const EXAMPLES = [
  'Small caps with ROE above 20% and low risk',
  'Which stocks have the strongest delivery accumulation?',
  'Compare TCS and INFY',
  'Cheapest large caps by PE that still have momentum',
];

interface Message {
  role: 'user' | 'assistant';
  text: string;
  charts?: { symbol: string; points: ChartPoint[] }[];
  evidence?: AnalystResult['queries'];
  unverified?: string[];
  isError?: boolean;
}

export function Chat({
  open,
  onOpenChange,
  setCustomFormula,
  screen,
  onSelectStock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setCustomFormula: (formula: string) => void;
  screen: Screen;
  onSelectStock: (symbol: string) => void;
}) {
  const [config, setConfig] = useState<AIConfig | null>(loadConfig);
  const [draftProvider, setDraftProvider] = useState<ProviderId>('gemini');
  const [draftKey, setDraftKey] = useState('');
  const [draftModel, setDraftModel] = useState('');
  const [draftBase, setDraftBase] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const spec = PROVIDERS.find((p) => p.id === draftProvider)!;

  const saveConfig = () => {
    // A local model needs no key, so only the hosted providers require one.
    if (!draftKey.trim() && draftProvider !== 'compatible') return;
    const cfg: AIConfig = {
      provider: draftProvider,
      apiKey: draftKey.trim(),
      model: (draftModel.trim() || spec.defaultModel),
      baseUrl: draftBase.trim() || undefined,
    };
    localStorage.setItem(CONFIG_STORAGE, JSON.stringify(cfg));
    setConfig(cfg);
    setDraftKey('');
  };

  const ask = async (question: string) => {
    if (!question.trim() || loading || !config) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setLoading(true);
    setStage('Reading the board…');

    try {
      const result = await askAnalyst(config, question, screen);
      setStage('Charting…');

      if (result.applyFormula) setCustomFormula(result.applyFormula);

      const charts: { symbol: string; points: ChartPoint[] }[] = [];
      if (result.charts.length) {
        const loaded = await Promise.all(
          result.charts.map(async (sym) => {
            try {
              const c = await loadChart(sym.toUpperCase().trim(), '6m');
              return { symbol: c.symbol, points: c.points };
            } catch {
              return null;
            }
          }),
        );
        loaded.forEach((c) => c && charts.push(c));
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: result.answer,
          charts: charts.length ? charts : undefined,
          evidence: result.queries.length ? result.queries : undefined,
          unverified: result.unverified,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: e instanceof Error ? e.message : String(e), isError: true },
      ]);
    } finally {
      setLoading(false);
      setStage('');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 data-[side=right]:w-full data-[side=right]:sm:w-[560px] data-[side=right]:lg:w-[640px] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI assistant
          </SheetTitle>
          {/* Says the boundary up front rather than deflecting after someone asks. The
              model is instructed the same way, but an instruction is a request — this is
              what the reader actually sees. */}
          <p className="t-meta text-muted-foreground">
            Answers from the data on this board and quotes the rows it used. It will not tell
            you what to buy or sell, name price targets, or predict prices.
          </p>
        </SheetHeader>

        {!config ? (
          <div className="flex-1 space-y-4 overflow-auto p-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <KeyRound className="size-4" />
                Connect any AI model
              </div>
              <p className="mt-2 t-body text-muted-foreground">
                This site has no paid backend, which is how it stays free. The assistant runs on
                your own key, stored only in this browser and sent only to the provider you pick —
                it never reaches us, because there is no server to reach.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveConfig();
              }}
              className="space-y-3"
            >
              <div>
                <label className="mb-1.5 block t-label">Provider</label>
                <Select
                  value={draftProvider}
                  onValueChange={(v) => {
                    setDraftProvider(v as ProviderId);
                    setDraftModel('');
                  }}
                >
                  <SelectTrigger aria-label="AI provider" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 t-meta text-muted-foreground">{spec.keyHint}</p>
              </div>

              {spec.needsBaseUrl && (
                <div>
                  <label className="mb-1.5 block t-label" htmlFor="ai-base">API base URL</label>
                  <Input
                    id="ai-base"
                    value={draftBase}
                    onChange={(e) => setDraftBase(e.target.value)}
                    placeholder="https://openrouter.ai/api/v1"
                  />
                  {spec.note && <p className="mt-1 t-meta text-muted-foreground">{spec.note}</p>}
                </div>
              )}

              <div>
                <label className="mb-1.5 block t-label" htmlFor="ai-model">Model</label>
                <Input
                  id="ai-model"
                  value={draftModel}
                  onChange={(e) => setDraftModel(e.target.value)}
                  placeholder={spec.defaultModel}
                />
              </div>

              <div>
                <label className="mb-1.5 block t-label" htmlFor="ai-key">
                  API key{spec.needsBaseUrl ? ' (leave blank for a local model)' : ''}
                </label>
                <Input
                  id="ai-key"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="sk-…"
                  type="password"
                  autoComplete="off"
                />
                {spec.keyUrl && (
                  <a
                    href={spec.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 t-meta font-medium text-primary hover:underline"
                  >
                    Get a key from {spec.label}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={!draftKey.trim() && draftProvider !== 'compatible'}>
                Connect
              </Button>
            </form>

            <p className="t-meta text-muted-foreground">Everything else here works without a key.</p>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      I query the live board — all {screen.stocks.length.toLocaleString('en-IN')}{' '}
                      scored stocks from the {screen.last_trading_session} session — and answer from
                      the actual rows. Every number I quote is one you can verify below the answer.
                    </p>
                    <div className="flex flex-col gap-2">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => ask(ex)}
                          className="rounded-lg border px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, i) => (
                  <div key={i} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : m.isError
                            ? 'border border-destructive/20 bg-destructive/10 text-destructive'
                            : 'bg-muted text-foreground'
                      }`}
                    >
                      {m.text}
                    </div>

                    {/* A named stock that was not in any result is mechanically detectable,
                        so it is surfaced rather than quietly trusted. */}
                    {m.unverified && m.unverified.length > 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[12px] text-warning">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          {m.unverified.join(', ')} {m.unverified.length === 1 ? 'was' : 'were'} named
                          but did not appear in the query results below. Verify on the board before
                          relying on anything said about {m.unverified.length === 1 ? 'it' : 'them'}.
                        </span>
                      </div>
                    )}

                    {/* The audit trail: exactly which rows the answer was written from. */}
                    {m.evidence?.map((q) => (
                      <details key={q.name} className="w-full rounded-lg border bg-card px-3 py-2">
                        <summary className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                          <Table2 className="size-3" />
                          {q.name}
                          <Badge variant="outline" className="ml-auto">
                            {q.matched.toLocaleString('en-IN')} matched
                          </Badge>
                        </summary>
                        {q.spec.filter && (
                          <code className="mt-2 block overflow-x-auto rounded bg-muted px-2 py-1 text-[11px]">
                            {q.spec.filter}
                          </code>
                        )}
                        <div className="mt-2 max-h-56 overflow-auto">
                          <table className="w-full text-[11px]">
                            <tbody className="divide-y">
                              {q.rows.map((row, ri) => (
                                <tr
                                  key={ri}
                                  className="cursor-pointer hover:bg-muted"
                                  onClick={() => row.symbol && onSelectStock(String(row.symbol))}
                                >
                                  {Object.entries(row).map(([k, v]) => (
                                    <td key={k} className="py-1 pr-2 tabular-nums text-muted-foreground">
                                      {typeof v === 'number' ? Number(v.toFixed(2)) : String(v ?? '—')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}

                    {m.charts?.map((chart) => (
                      <div key={chart.symbol} className="mt-2 w-full rounded-xl border bg-card p-3">
                        <button
                          type="button"
                          onClick={() => onSelectStock(chart.symbol)}
                          className="mb-2 text-sm font-semibold hover:underline"
                        >
                          {chart.symbol}
                        </button>
                        <div className="h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chart.points}>
                              <XAxis dataKey="date" hide />
                              <YAxis domain={['auto', 'auto']} hide />
                              <Tooltip
                                contentStyle={{
                                  borderRadius: 'var(--radius)',
                                  background: 'var(--popover)',
                                  color: 'var(--popover-foreground)',
                                  fontSize: '12px',
                                }}
                              />
                              <Line type="monotone" dataKey="close" stroke="var(--primary)" strokeWidth={2} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {loading && (
                  <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> {stage || 'Thinking…'}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="border-t bg-background p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(input);
                }}
                className="flex items-center gap-2"
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about any stock or screen…"
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={!input.trim() || loading}>
                  <Send className="size-4" />
                  <span className="sr-only">Send question</span>
                </Button>
              </form>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(CONFIG_STORAGE);
                  localStorage.removeItem('ml-gemini-key');
                  setConfig(null);
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="size-3" />
                Change model or remove key
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
