/**
 * Nội dung admin chỉnh được (trang /admin.html, API /v1/admin/content): danh sách video chiếu trên
 * màn hình lớn và bộ quest của Hang Quest. Client đọc bản đang dùng ở GET /v1/content; khi API chưa
 * có gì (hoặc không gọi được) thì dùng mặc định dưới đây.
 *
 * Dữ kiện quest mặc định đã đối chiếu ngày 2026-11-12 với Wikipedia (Faker, T1, League of Legends
 * World Championship, Mid-Season Invitational, kkOma, Bengi, Zeus, Doran, Gumayusi), ESPN và
 * GosuGamers (chung kết OGN Champions Summer 2013). Số danh hiệu tính đến hết CKTG 2025.
 */
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id: chữ thường, số, gạch ngang (tối đa 40)");

/** Id (11 ký tự) của một link video YouTube (watch, youtu.be, shorts, embed, live), không phải thì null. */
export function youtubeId(url: string): string | null {
  const m = /^https:\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/][^\s]*)?$/.exec(url.trim());
  return m ? m[1] : null;
}

/**
 * Nguồn video: để trống (chưa có tệp), đường dẫn trên chính site (/videos/abc.mp4), https:// tới một
 * tệp mp4/webm cho phép CORS (vẽ thẳng lên màn hình 3D), hoặc link một video YouTube (phát bằng
 * trình phát nhúng chính thức, đặt khớp vào ô màn hình; video phải cho phép nhúng).
 * Twitch / Facebook / TikTok không dùng được.
 */
export const VideoUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => u === "" || youtubeId(u) !== null || /^\/(?!\/)[^\s]*$/.test(u) || /^https:\/\/[^\s]+$/.test(u), "Đường dẫn phải bắt đầu bằng / hoặc https://")
  .refine((u) => !/(youtube\.com|youtu\.be)/i.test(u) || youtubeId(u) !== null, "Link YouTube phải trỏ tới một video cụ thể (watch?v=…, youtu.be/…, shorts/…)")
  .refine((u) => !/(twitch\.tv|facebook\.com|fb\.watch|tiktok\.com)/i.test(u), "Link Twitch/Facebook/TikTok không chiếu được: dùng link YouTube hoặc tệp mp4/webm");
export const VIDEO_CATEGORIES = { coronation: "Đăng quang", highlight: "Highlight", tears: "Khoảnh khắc buồn", other: "Khác" } as const;
export const ScreenVideo = z
  .object({
    id: Id,
    title: z.string().trim().min(1).max(80),
    category: z.enum(["coronation", "highlight", "tears", "other"]),
    year: z.number().int().min(2012).max(2100).nullable(),
    url: VideoUrl,
    /** Giây; trang admin tự đo khi tải thử. Cần để mọi người xem cùng một khoảnh khắc. */
    durationSec: z.number().min(0).max(3600).nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type ScreenVideo = z.infer<typeof ScreenVideo>;

export const QuestQuestion = z
  .object({
    prompt: z.string().trim().min(1).max(200),
    options: z.tuple([z.string().trim().min(1).max(120), z.string().trim().min(1).max(120), z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)]),
    answer: z.number().int().min(0).max(3),
    note: z.string().trim().max(240),
  })
  .strict()
  .refine((q) => new Set(q.options).size === 4, "Bốn đáp án phải khác nhau");
export type QuestQuestion = z.infer<typeof QuestQuestion>;
export const QuestDef = z
  .object({
    id: Id,
    title: z.string().trim().min(1).max(60),
    blurb: z.string().trim().max(160),
    enabled: z.boolean(),
    questions: z.array(QuestQuestion).min(1).max(5),
  })
  .strict();
export type QuestDef = z.infer<typeof QuestDef>;

const unique = <T extends { id: string }>(list: T[]) => new Set(list.map((x) => x.id)).size === list.length;
export const VideoList = z.array(ScreenVideo).max(100).refine(unique, "Trùng id video");
export const QuestList = z.array(QuestDef).max(50).refine(unique, "Trùng id quest");

export interface ContentDoc {
  videos: ScreenVideo[];
  quests: QuestDef[];
  /** ISO time of the last admin save, null = defaults. */
  updatedAt: string | null;
}
/** Phần client đọc: chỉ video bật và đã có tệp, chỉ quest bật. */
export function publicContent(doc: ContentDoc): ContentDoc {
  return {
    videos: doc.videos.filter((v) => v.enabled && v.url),
    quests: doc.quests.filter((q) => q.enabled),
    updatedAt: doc.updatedAt,
  };
}

/**
 * Danh sách video gợi ý, CHƯA có tệp: clip phát sóng thuộc bản quyền của đơn vị tổ chức / phát
 * sóng, nên người host tự đưa tệp mình có quyền dùng vào (đường dẫn /videos/... hoặc https://).
 */
export const DEFAULT_VIDEOS: readonly ScreenVideo[] = [
  ...[2013, 2015, 2016, 2023, 2024, 2025].map((year): ScreenVideo => ({
    id: `worlds-${year}`, title: `Đăng quang CKTG ${year}`, category: "coronation", year, url: "", durationSec: null, enabled: true,
  })),
  { id: "zed-2013", title: "Faker solo Zed với Ryu (OGN Champions Summer 2013)", category: "highlight", year: 2013, url: "", durationSec: null, enabled: true },
  { id: "edg-10k", title: "Pha combat lật kèo 10k vàng trước EDG", category: "highlight", year: null, url: "", durationSec: null, enabled: true },
  { id: "tears-2017", title: "Faker bật khóc sau chung kết CKTG 2017", category: "tears", year: 2017, url: "", durationSec: null, enabled: true },
  { id: "tears-2022", title: "Keria và đồng đội sau chung kết CKTG 2022", category: "tears", year: 2022, url: "", durationSec: null, enabled: true },
];

export const DEFAULT_QUESTS: readonly QuestDef[] = [
  {
    id: "faker",
    title: "Quỷ vương bất tử",
    enabled: true,
    blurb: "Ba điều fan nào cũng phải thuộc về Faker.",
    questions: [
      { prompt: "Tên thật của Faker là gì?", options: ["Lee Min-hyeong", "Lee Sang-hyeok", "Ryu Min-seok", "Bae Jun-sik"], answer: 1, note: "Lee Sang-hyeok, sinh ngày 7/5/1996." },
      { prompt: "Faker ra mắt thi đấu chuyên nghiệp năm nào?", options: ["2012", "2014", "2013", "2015"], answer: 2, note: "Ngày 6/4/2013, trong màu áo SK Telecom T1." },
      { prompt: "Biệt danh nào gắn liền với Faker?", options: ["Unkillable Demon King", "The Final Boss", "The Emperor", "The Lion King"], answer: 0, note: "Unkillable Demon King: Quỷ vương bất tử." },
    ],
  },
  {
    id: "zed",
    title: "Pha solo để đời",
    enabled: true,
    blurb: "Màn đối đầu năm 2013 mà ai xem cũng nổi da gà.",
    questions: [
      { prompt: "Trong pha solo nổi tiếng với Ryu năm 2013, cả hai cùng dùng tướng nào?", options: ["LeBlanc", "Ahri", "Yasuo", "Zed"], answer: 3, note: "Zed đấu Zed, Faker thắng khi chỉ còn một chút máu." },
      { prompt: "Pha solo đó diễn ra ở trận nào?", options: ["Chung kết CKTG 2013", "Ván 5 chung kết OGN Champions Summer 2013", "Chung kết MSI 2016", "Chung kết Champions Spring 2013"], answer: 1, note: "Ván 5 (cấm chọn mù) gặp KT Bullets, ngày 31/8/2013." },
      { prompt: "SK Telecom T1 thắng loạt chung kết đó với tỉ số nào?", options: ["3-0", "3-1", "3-2", "2-3"], answer: 2, note: "3-2, lội ngược dòng sau khi bị dẫn 0-2." },
    ],
  },
  {
    id: "stars",
    title: "Sáu ngôi sao",
    enabled: true,
    blurb: "Những lần nâng cúp vô địch thế giới.",
    questions: [
      { prompt: "Tính đến hết CKTG 2025, T1 đã vô địch thế giới bao nhiêu lần?", options: ["4", "5", "6", "7"], answer: 2, note: "Sáu lần: 2013, 2015, 2016, 2023, 2024, 2025." },
      { prompt: "Năm nào dưới đây T1 KHÔNG vô địch thế giới?", options: ["2013", "2017", "2016", "2024"], answer: 1, note: "Năm 2017 T1 thua Samsung Galaxy 0-3 ở chung kết." },
      { prompt: "T1 là đội đầu tiên vô địch thế giới ba năm liên tiếp. Đó là các năm nào?", options: ["2013-2015", "2015-2017", "2022-2024", "2023-2025"], answer: 3, note: "2023, 2024 và 2025." },
    ],
  },
  {
    id: "finals",
    title: "Đối thủ ở chung kết",
    enabled: true,
    blurb: "Ai đứng bên kia sân khấu trong ngày đăng quang?",
    questions: [
      { prompt: "Chung kết thế giới 2013, SK Telecom T1 thắng đội nào?", options: ["Royal Club", "Samsung Galaxy", "KOO Tigers", "Fnatic"], answer: 0, note: "Thắng Royal Club 3-0 tại Staples Center, Los Angeles." },
      { prompt: "Chung kết thế giới 2023 ở Seoul, T1 thắng đội nào với tỉ số 3-0?", options: ["JD Gaming", "Bilibili Gaming", "Weibo Gaming", "Gen.G"], answer: 2, note: "Weibo Gaming, tại Gocheok Sky Dome ngày 19/11/2023." },
      { prompt: "Chung kết thế giới 2025 được gọi là \"Telecom Derby\". T1 gặp đội nào?", options: ["Gen.G", "KT Rolster", "Hanwha Life Esports", "Dplus KIA"], answer: 1, note: "T1 thắng KT Rolster 3-2 tại Thành Đô ngày 9/11/2025." },
    ],
  },
  {
    id: "rosters",
    title: "Đội hình vô địch",
    enabled: true,
    blurb: "Những cái tên trên áo đấu.",
    questions: [
      { prompt: "Đội hình vô địch thế giới 2013 gồm những ai?", options: ["MaRin, Bengi, Faker, Bang, Wolf", "Duke, Blank, Faker, Bang, Wolf", "Impact, Bengi, Faker, Piglet, PoohManDu", "Zeus, Oner, Faker, Gumayusi, Keria"], answer: 2, note: "Impact, Bengi, Faker, Piglet và PoohManDu, HLV kkOma." },
      { prompt: "Ngoài Faker, ai có mặt trong cả ba đội hình vô địch 2013, 2015 và 2016?", options: ["Bang", "Wolf", "Impact", "Bengi"], answer: 3, note: "Bengi (Bae Sung-woong), người đi rừng." },
      { prompt: "Sau khi Zeus rời đội cuối năm 2024, ai gia nhập T1?", options: ["Doran", "Kiin", "Kingen", "Canna"], answer: 0, note: "Doran ký với T1 tháng 11/2024; Zeus sang Hanwha Life Esports." },
    ],
  },
  {
    id: "msi-lck",
    title: "MSI và LCK",
    enabled: true,
    blurb: "Không chỉ có CKTG.",
    questions: [
      { prompt: "T1 vô địch MSI vào những năm nào?", options: ["2015 và 2016", "2016 và 2017", "2017 và 2019", "2022 và 2023"], answer: 1, note: "2016 (thắng CLG 3-0) và 2017 (thắng G2 Esports 3-1)." },
      { prompt: "T1 đang giữ kỷ lục bao nhiêu chức vô địch LCK?", options: ["7", "8", "10", "12"], answer: 2, note: "Mười danh hiệu LCK." },
      { prompt: "Mùa giải nào T1 toàn thắng 18-0 ở vòng bảng LCK?", options: ["Mùa Hè 2015", "Mùa Xuân 2020", "Mùa Hè 2024", "Mùa Xuân 2022"], answer: 3, note: "Mùa Xuân 2022: đội đầu tiên toàn thắng 18 trận." },
    ],
  },
  {
    id: "backstage",
    title: "Chuyện hậu trường",
    enabled: true,
    blurb: "Tên đội, ban huấn luyện và người mới.",
    questions: [
      { prompt: "SK Telecom T1 đổi tên thành T1 vào năm nào?", options: ["2019", "2017", "2018", "2021"], answer: 0, note: "Tháng 10/2019, sau khi lập liên doanh với Comcast Spectacor." },
      { prompt: "HLV kkOma tên thật là gì?", options: ["Im Jae-hyeon", "Bae Sung-woong", "Kim Jeong-gyun", "Choi Byung-hoon"], answer: 2, note: "Kim Jeong-gyun; trở lại làm HLV trưởng T1 từ tháng 11/2023." },
      { prompt: "Xạ thủ của T1 cho mùa 2026 là ai?", options: ["Viper", "Peyz", "Ruler", "Smash"], answer: 1, note: "Peyz (Kim Su-hwan) ký tháng 11/2025, thay Gumayusi." },
    ],
  },
];

export const DEFAULT_CONTENT: ContentDoc = {
  videos: DEFAULT_VIDEOS.map((v) => ({ ...v })),
  quests: DEFAULT_QUESTS.map((q) => ({ ...q, questions: q.questions.map((x) => ({ ...x, options: [...x.options] as QuestQuestion["options"] })) })),
  updatedAt: null,
};
