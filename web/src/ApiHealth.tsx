import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Plug, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SourceProbe } from './types';
import { loadSources } from '@/lib/dataSource';

export function ApiHealth() {
  const [probes, setProbes] = useState<SourceProbe[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  // A static deploy cannot probe NSE from the visitor's browser (CORS, and it would put
  // a million users on the exchange's endpoints). It reports what the last build saw.
  const [live, setLive] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const j = await loadSources();
      setProbes(j.sources);
      setLive(j.live);
      setCheckedAt(j.checked_at);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (failed) {
    return (
      <section>
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Plug className="size-4" />
              Source status is unavailable in this build. The board below is served from static
              files and works without it.
            </span>
          </CardContent>
        </Card>
      </section>
    );
  }

  const ok = probes?.filter((p) => p.ok).length ?? 0;
  const total = probes?.length ?? 0;

  return (
    <section>
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center gap-3 border-b">
          <Plug className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">Data sources</CardTitle>
          <Badge variant="outline">
            {probes ? `${ok} of ${total} reachable` : 'checking…'}
          </Badge>
          {live && (
            <Button onClick={check} disabled={checking} variant="outline" size="sm" className="ml-auto">
              <RotateCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
              Re-check
            </Button>
          )}
        </CardHeader>

        <div className="divide-y">
          {!probes && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading source status…
            </div>
          )}
          {probes?.map((p) => (
            <div key={p.name} className="flex items-start gap-3 p-3">
              {p.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-foreground">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.detail}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{p.ms} ms</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{p.note}</p>
              </div>
            </div>
          ))}
          {probes && probes.length > 0 && !live && (
            <p className="p-3 text-xs leading-relaxed text-muted-foreground">
              Recorded when the data was last built
              {checkedAt ? ` (${new Date(checkedAt).toLocaleString('en-IN')})` : ''}. The public site
              serves pre-built files, so it never calls the exchanges from your browser.
            </p>
          )}
          {probes && probes.length === 0 && (
            <p className="p-3 text-xs leading-relaxed text-muted-foreground">
              No source snapshot was recorded in this build.
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}
