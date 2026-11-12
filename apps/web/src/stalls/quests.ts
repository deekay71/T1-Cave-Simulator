/**
 * Hang Quest: bộ quest về T1 (mặc định ở packages/shared/src/content.ts, admin sửa ở /admin.html).
 * Mỗi quest vài câu hỏi; đúng hết là xong (sai thì làm lại quest đó). Tiến độ lưu ở trình duyệt
 * (localStorage), chưa có thưởng xu / XP: muốn kiếm XP thì sang Đố vui của Keria, nơi server chấm bài.
 */
import { DEFAULT_QUESTS, type QuestDef, type QuestQuestion } from "@te-liet/shared";

export type Quest = QuestDef;
export type { QuestQuestion };
/** Bộ quest mặc định (khi chưa tải được bản admin đang dùng). */
export const QUESTS: readonly Quest[] = DEFAULT_QUESTS;

const KEY = "tl.quests.v1";
/** Id các quest đã xong (đọc từ trình duyệt; lỗi đọc thì coi như chưa xong quest nào). */
export function loadDone(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage, quests: readonly Quest[] = QUESTS): string[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    const known = new Set(quests.map((q) => q.id));
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
