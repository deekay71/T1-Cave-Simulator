import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { bucketFreshness, type Feed, type Match } from './client.js';
import { OfficialVideoPlayer } from './OfficialVideo.js';
import type { VideoConfiguration } from './video.js';

export const MATCH_TABS = ['running', 'upcoming', 'past'] as const;
export type MatchTab = typeof MATCH_TABS[number];
const tabNames = { running: 'Đang đấu', upcoming: 'Sắp tới', past: 'Kết quả' };
const statusNames: Record<string, string> = {
  running: 'Đang diễn ra', not_started: 'Chưa bắt đầu', finished: 'Đã kết thúc',
  canceled: 'Đã hủy', postponed: 'Hoãn', unknown: 'Chưa xác định',
};
export function preferredMatchTab(feed: Feed | null): MatchTab {
  return MATCH_TABS.find(tab => (feed?.buckets[tab].matches.length ?? 0) > 0) ?? 'running';
}
function localTime(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Chưa có lịch';
}
export function MatchCard({ match, hide, liveScore }: { match: Match; hide: boolean; liveScore: boolean }) {
  const running = match.status === 'running';
  const finished = match.status === 'finished';
  const showScore = !hide && (finished || (running && liveScore));
  return <li className="match-card">
    <div className="match-card-heading">
      <p className="match-meta">{match.competition || 'Chưa rõ giải đấu'}</p>
      {match.bestOf && <span className="match-format">BO{match.bestOf}</span>}
    </div>
    <div className="match-teams">{match.teams.length ? match.teams.map(team => <div key={team.id} className={showScore && finished && match.winnerId === team.id ? 'match-winner' : undefined}>
      <strong>{team.name}</strong>
      <span className="match-score" aria-label={hide ? 'Đang ẩn tỉ số' : showScore && team.score !== null ? `Tỉ số ${team.score}` : 'Chưa có tỉ số được xác minh'}>{hide ? '••' : showScore ? (team.score ?? '—') : '—'}</span>
    </div>) : <p>Chưa xác định đội tham gia.</p>}</div>
    <div className="match-card-bottom">
      <p className={`match-status${running ? ' match-status-running' : ''}`}>
        {statusNames[match.status] ?? 'Trạng thái chưa xác định'}
        {hide && finished ? ' · Đang ẩn kết quả' : ''}
        {!hide && match.forfeit ? ' · Xử thắng/thua bỏ cuộc' : ''}
      </p>
      <p className="match-meta">{match.scheduledAt ? <time dateTime={match.scheduledAt}>{localTime(match.scheduledAt)}</time> : 'Chưa có lịch'}</p>
    </div>
    {match.originalScheduledAt && match.originalScheduledAt !== match.scheduledAt && <p className="match-warning">Lịch đã đổi, trước đó: {localTime(match.originalScheduledAt)}</p>}
    {running && !liveScore && <p className="match-meta">Tỉ số trong trận chưa được xác minh, nên chưa hiển thị.</p>}
  </li>;
}

type Props = {
  feed: Feed | null;
  error: boolean;
  refreshing: boolean;
  now: number;
  onRefresh: () => void;
  video: VideoConfiguration;
};
export function MatchPanelView({ feed, error, refreshing, now, onRefresh, video }: Props) {
  const [hide, setHide] = useState(true);
  const [selection, setSelection] = useState<MatchTab | null>(null);
  const tab = selection ?? preferredMatchTab(feed);
  const ids = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Choose a useful first tab once data arrives, then respect the viewer's selection.
  useEffect(() => { if (feed?.enabled) setSelection(current => current ?? preferredMatchTab(feed)); }, [feed]);
  const bucket = feed?.buckets[tab];
  const warning = bucket ? bucketFreshness(bucket, now, tab === 'running') : null;
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % MATCH_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + MATCH_TABS.length - 1) % MATCH_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MATCH_TABS.length - 1;
    else return;
    event.preventDefault();
    setSelection(MATCH_TABS[next]);
    tabRefs.current[next]?.focus();
  };
  return <div className="match-panel match-zone">
    <div className="match-zone-heading">
      <p className="match-kicker">GÓC XEM TRẬN</p>
      <h2>T1 <span>· League of Legends</span></h2>
      <p>Lịch đấu, kết quả và một chỗ ngồi cùng fan trong hang.</p>
    </div>
    <OfficialVideoPlayer configuration={video} />
    <div className="match-controls">
      <label className="match-spoilers"><input type="checkbox" checked={hide} onChange={event => setHide(event.target.checked)} /> <span>Ẩn tỉ số và kết quả</span></label>
      <button type="button" className="match-secondary" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Đang tải…' : 'Cập nhật'}</button>
    </div>
    <div className="match-feed-status" role="status" aria-live="polite" aria-atomic="true">
      {!feed && !error && <p>Đang tải lịch đấu…</p>}
      {error && <p className="match-warning">Không cập nhật được lịch đấu. {feed ? 'Đang giữ bản gần nhất; dữ liệu có thể đã thay đổi.' : 'Hệ thống sẽ thử lại khi bảng này đang mở.'}</p>}
      {feed && !feed.enabled && <p>Nguồn lịch đấu chưa được bật. Chưa có dữ liệu thật để hiển thị.</p>}
    </div>
    {feed?.enabled && <>
      {feed.buckets.past.matches.length > 0 && <div className="match-results-notice">
        <div>
          <strong>Đã có {feed.buckets.past.matches.length} trận đã đấu</strong>
          <p>{hide ? 'Tỉ số đang được ẩn để tránh lộ kết quả. Bấm bên cạnh để xem.' : 'Kết quả lấy từ nguồn PandaScore; xem thời điểm kiểm tra ở từng tab.'}</p>
        </div>
        <button type="button" className="match-secondary" onClick={() => { setSelection('past'); setHide(false); }}>
          {hide ? 'Hiện kết quả đã đấu' : 'Xem các trận đã đấu'}
        </button>
      </div>}
      <div className="match-tabs" role="tablist" aria-label="Lịch thi đấu T1">
        {MATCH_TABS.map((key, index) => <button key={key} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" id={`${ids}-tab-${key}`} aria-controls={`${ids}-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setSelection(key)} onKeyDown={event => onTabKey(event, index)}>
          {tabNames[key]} <span className="match-count" aria-label={`${feed.buckets[key].matches.length} trận`}>{feed.buckets[key].matches.length}</span>
        </button>)}
      </div>
      {MATCH_TABS.map(key => <section className="match-group" role="tabpanel" key={key} id={`${ids}-panel-${key}`} aria-labelledby={`${ids}-tab-${key}`} hidden={tab !== key} tabIndex={tab === key ? 0 : -1}>
        {tab === key && bucket && <>
          <div className="match-freshness" role="status" aria-live="polite">
            <span className={`match-freshness-dot${warning || error ? ' is-stale' : ''}`} aria-hidden="true" />
            <p className="match-meta">{bucket.checkedAt ? <>Nguồn kiểm tra lúc <time dateTime={bucket.checkedAt}>{localTime(bucket.checkedAt)}</time></> : 'Nguồn chưa có lần cập nhật được xác minh.'}</p>
          </div>
          {warning && <p className="match-warning">{warning}</p>}
          {bucket.matches.length ? <ul aria-label={`Các trận ${tabNames[key].toLowerCase()}`}>{bucket.matches.map(match => <MatchCard key={match.id} match={match} hide={hide} liveScore={feed.capabilities.inProgressScore} />)}</ul> : <div className="match-empty">
            <span className="match-empty-symbol" aria-hidden="true">◇</span>
            <h3>{key === 'running' ? 'Chưa ghi nhận trận đang đấu' : key === 'upcoming' ? 'Chưa có lịch sắp tới' : 'Chưa có kết quả được ghi nhận'}</h3>
            <p>{key === 'running' ? 'Xem lịch sắp tới hoặc những trận gần đây ở tab bên cạnh.' : 'Lịch và kết quả sẽ xuất hiện khi nguồn dữ liệu cập nhật.'}</p>
          </div>}
        </>}
      </section>)}
    </>}
    <div className="match-source">
      <p><a href="https://pandascore.co/" target="_blank" rel="noopener noreferrer">Source: PandaScore ↗</a> <span>· Giờ trên thiết bị</span></p>
      <p>Tự kiểm tra khoảng 30 giây khi bảng đang mở. Nguồn có thể chậm hơn; đây không phải dữ liệu trực tiếp từng giây.</p>
    </div>
  </div>;
}
