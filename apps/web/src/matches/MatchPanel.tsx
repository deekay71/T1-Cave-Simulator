import { useEffect, useState } from 'react';
import { readMatches, type Feed } from './client.js';
import { MatchPanelView } from './MatchPanelView.js';
import { readVideoConfiguration } from './video.js';
import './match-zone.css';

const video = readVideoConfiguration(import.meta.env);
export function MatchPanel() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    const refresh = async () => {
      if (disposed || document.hidden || request) return;
      setRefreshing(true);
      request = new AbortController();
      const active = request;
      const timeout = setTimeout(() => active.abort(), 12_000);
      try {
        const next = await readMatches(active.signal);
        if (!disposed && !active.signal.aborted) { setFeed(next); setError(false); }
      } catch {
        if (!disposed && !document.hidden) setError(true);
      } finally {
        clearTimeout(timeout);
        if (request === active) request = null;
        if (!disposed) {
          setRefreshing(false);
          setNow(Date.now());
          if (!document.hidden) timer = setTimeout(refresh, 30_000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) request?.abort();
      // Restart the effect so an aborted in-flight request cannot delay resuming.
      else setRefreshKey(value => value + 1);
    };
    document.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => { disposed = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [refreshKey]);
  return <MatchPanelView feed={feed} error={error} refreshing={refreshing} now={now} onRefresh={() => setRefreshKey(value => value + 1)} video={video} />;
}
