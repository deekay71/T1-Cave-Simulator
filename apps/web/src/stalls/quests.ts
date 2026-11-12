/**
 * Hang Quest: các quest về T1. Mỗi quest là một chủ đề với ba câu hỏi; trả lời đúng cả ba là xong
 * quest (sai thì làm lại quest đó). Tiến độ lưu ở trình duyệt (localStorage), chưa có thưởng xu / XP:
 * muốn kiếm XP thì sang Đố vui của Keria, nơi server chấm bài.
 *
 * Dữ kiện đã đối chiếu ngày 2026-11-12 với Wikipedia (Faker, T1, League of Legends World
 * Championship, Mid-Season Invitational, kkOma, Bengi, Zeus, Doran, Gumayusi), ESPN và GosuGamers
 * (trận chung kết OGN Champions Summer 2013). Số danh hiệu tính đến hết CKTG 2025.
 */
export interface QuestQuestion {
  prompt: string;
  options: readonly [string, string, string, string];
  /** Vị trí đáp án đúng trong `options`. */
  answer: number;
  /** Một dòng hiện sau khi trả lời. */
  note: string;
}
export interface Quest {
  id: string;
  title: string;
  blurb: string;
  questions: readonly [QuestQuestion, QuestQuestion, QuestQuestion];
}

export const QUESTS: readonly Quest[] = [
  {
    id: "faker",
    title: "Quỷ vương bất tử",
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
    blurb: "Tên đội, ban huấn luyện và người mới.",
    questions: [
      { prompt: "SK Telecom T1 đổi tên thành T1 vào năm nào?", options: ["2019", "2017", "2018", "2021"], answer: 0, note: "Tháng 10/2019, sau khi lập liên doanh với Comcast Spectacor." },
      { prompt: "HLV kkOma tên thật là gì?", options: ["Im Jae-hyeon", "Bae Sung-woong", "Kim Jeong-gyun", "Choi Byung-hoon"], answer: 2, note: "Kim Jeong-gyun; trở lại làm HLV trưởng T1 từ tháng 11/2023." },
      { prompt: "Xạ thủ của T1 cho mùa 2026 là ai?", options: ["Viper", "Peyz", "Ruler", "Smash"], answer: 1, note: "Peyz (Kim Su-hwan) ký tháng 11/2025, thay Gumayusi." },
    ],
  },
];

const KEY = "tl.quests.v1";
/** Id các quest đã xong (đọc từ trình duyệt; lỗi đọc thì coi như chưa xong quest nào). */
export function loadDone(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    const known = new Set(QUESTS.map((q) => q.id));
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
  } catch {
    return [];
  }
}
export function saveDone(done: readonly string[], storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify([...new Set(done)]));
  } catch {
    /* chế độ riêng tư hoặc hết chỗ: tiến độ chỉ sống trong tab */
  }
}
/** Số câu đúng của một lượt trả lời. */
export function gradeQuest(quest: Quest, answers: readonly number[]): number {
  return quest.questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
}

/** Sáu chức vô địch thế giới của SK Telecom T1 / T1, kèm ảnh thật (giấy phép tự do, xem public/memories/CREDITS.md). */
export interface Title {
  year: number;
  name: string;
  final: string;
  place: string;
  date: string;
  roster: string;
  note: string;
  photo: { src: string; shows: string; author: string; license: string; licenseUrl: string; source: string };
}
const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;
export const TITLES: readonly Title[] = [
  {
    year: 2013, name: "Ngôi sao đầu tiên", final: "SK Telecom T1 K 3-0 Royal Club", place: "Staples Center, Los Angeles", date: "4/10/2013",
    roster: "Impact · Bengi · Faker · Piglet · PoohManDu", note: "HLV kkOma. Mùa đầu tiên của Faker.",
    photo: { src: "/memories/worlds-2013.jpg", shows: "Đội hình SK Telecom T1 tại CKTG 2013", author: "artubr", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: commons("SK_Telecom_T1_at_LoL_World_Championship_2013.jpg") },
  },
  {
    year: 2015, name: "Trở lại đỉnh cao", final: "SK Telecom T1 3-1 KOO Tigers", place: "Mercedes-Benz Arena, Berlin", date: "31/10/2015",
    roster: "MaRin · Bengi · Faker · Bang · Wolf (dự bị: Easyhoon)", note: "Cả giải chỉ thua đúng một ván. MVP: MaRin.",
    photo: { src: "/memories/worlds-2015.jpg", shows: "SK Telecom T1 bên chiếc cúp vô địch 2015", author: "Bruce Liu (Liuyicun)", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/deed.en", source: commons("SK_Telecom_T1_with_2015_League_of_Legends_World_Champtionship_trophy.jpg") },
  },
  {
    year: 2016, name: "Ba ngôi sao trên ngực áo", final: "SK Telecom T1 3-2 Samsung Galaxy", place: "Staples Center, Los Angeles", date: "29/10/2016",
    roster: "Duke · Bengi / Blank · Faker · Bang · Wolf", note: "Trận chung kết đầu tiên kéo dài đủ năm ván. MVP chung kết: Faker.",
    photo: { src: "/memories/worlds-2016.jpg", shows: "Staples Center trước trận chung kết 2016 (chưa tìm được ảnh nâng cúp có giấy phép tự do)", author: "Patar knight", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.en", source: commons("LOL2016WorldsFinalsArena.jpg") },
  },
  {
    year: 2023, name: "Lời hẹn sau bảy mùa", final: "T1 3-0 Weibo Gaming", place: "Gocheok Sky Dome, Seoul", date: "19/11/2023",
    roster: "Zeus · Oner · Faker · Gumayusi · Keria", note: "Ngôi sao thứ tư, ngay trên sân nhà. MVP chung kết: Zeus.",
    photo: { src: "/memories/worlds-2023.jpg", shows: "T1 nâng cúp trên sân khấu chung kết 2023", author: "Creative Silver", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0", source: commons("T1_hold_2023_Summoners_Cup.jpg") },
  },
  {
    year: 2024, name: "Chúng ta lại làm được", final: "T1 3-2 Bilibili Gaming", place: "The O2 Arena, London", date: "2/11/2024",
    roster: "Zeus · Oner · Faker · Gumayusi · Keria", note: "Bảo vệ thành công ngôi vương. MVP chung kết: Faker.",
    photo: { src: "/memories/worlds-2024.jpg", shows: "The O2 Arena trong trận chung kết T1 gặp BLG", author: "fomos esports", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0", source: commons("T1_vs_BLG_2024_Worlds_Finals.jpg") },
  },
  {
    year: 2025, name: "Ba năm liên tiếp", final: "T1 3-2 KT Rolster", place: "Dong'an Lake Sports Park, Thành Đô", date: "9/11/2025",
    roster: "Doran · Oner · Faker · Gumayusi · Keria", note: "Đội đầu tiên vô địch thế giới ba năm liền. MVP chung kết: Gumayusi.",
    photo: { src: "/memories/worlds-2025.jpg", shows: "T1 trong ngày họp báo trước chung kết 2025 (chưa tìm được ảnh nâng cúp có giấy phép tự do)", author: "Fomos Esports", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0", source: commons("T1_Worlds_2025_Media_Day.jpg") },
  },
];
