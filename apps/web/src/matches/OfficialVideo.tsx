import { useEffect, useId, useRef, useState } from 'react';
import { officialEmbedUrl, type VideoConfiguration } from './video.js';

export function OfficialVideoPlayer({ configuration }: { configuration: VideoConfiguration }) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const headingId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const restorePlayFocus = useRef(false);
  const [compactTwitch, setCompactTwitch] = useState(false);
  const video = configuration.video;
  useEffect(() => {
    const visibility = () => { if (document.hidden) setEmbedUrl(null); };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    if (restorePlayFocus.current && !embedUrl) {
      playButton.current?.focus();
      restorePlayFocus.current = false;
    }
  }, [embedUrl]);
  useEffect(() => {
    if (video?.provider !== 'twitch' || !stage.current) return;
    const observer = new ResizeObserver(entries => {
      const tooSmall = entries[0].contentRect.width < 400;
      setCompactTwitch(tooSmall);
      if (tooSmall) setEmbedUrl(null);
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [video?.provider]);
  if (!video) return <section className="match-video match-video-off" aria-labelledby={headingId}>
    <span className="match-screen-icon" aria-hidden="true">▶</span>
    <div>
      <h3 id={headingId}>Màn hình chờ</h3>
      <p>Chưa bật nguồn phát chính thức. Bạn vẫn có thể theo dõi lịch và kết quả bên dưới.</p>
      {configuration.state !== 'disabled' && <p className="match-warning">Nguồn video chưa đủ điều kiện xác minh hoặc cấu hình chưa hợp lệ.</p>}
    </div>
  </section>;
  const provider = video.provider === 'youtube' ? 'YouTube' : 'Twitch';
  return <section className="match-video" aria-labelledby={headingId}>
    <div className="match-video-heading">
      <div><p className="match-kicker">NGUỒN PHÁT ĐÃ CẤU HÌNH</p><h3 id={headingId}>{video.label}</h3></div>
      <span className="match-provider">{provider}</span>
    </div>
    <div ref={stage}>
    {embedUrl ? <>
      <div className={`match-video-frame${video.provider === 'twitch' ? ' match-video-twitch' : ''}`}>
        <iframe src={embedUrl} title={`${video.label} · trình phát ${provider}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
      <button className="match-secondary" type="button" onClick={() => { restorePlayFocus.current = true; setEmbedUrl(null); }}>Dừng video</button>
    </> : <div className="match-video-poster">
      <span className="match-screen-icon" aria-hidden="true">▶</span>
      <p>Video chỉ tải khi bạn bấm phát.</p>
      {compactTwitch ? <p>Màn hình nhỏ: mở Twitch bằng liên kết bên dưới để xem.</p> : <button ref={playButton} type="button" className="match-play" onClick={() => {
        const url = officialEmbedUrl(video, location.origin);
        setUnavailable(!url);
        setEmbedUrl(url);
      }}>Phát từ {provider}</button>}
    </div>}
    </div>
    {unavailable && <p className="match-warning" role="status">Trình phát không hỗ trợ địa chỉ trang này. Hãy mở nguồn bên dưới.</p>}
    <p className="match-meta">Bấm phát sẽ kết nối tới {provider}. Video có thể lộ kết quả dù đang bật ẩn tỉ số.</p>
    <p className="match-meta">Nguồn này độc lập với lịch đấu; không đảm bảo đang phát trận T1. Không xem được? <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer">Mở nguồn trên {provider} ↗</a></p>
  </section>;
}
