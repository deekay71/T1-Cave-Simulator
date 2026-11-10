import { randomInt } from 'node:crypto';
import type { QuizQuestion } from '../../../../packages/shared/src/progression.js';

/** Server-only bank. Frozen historical facts, not live roster or trophy totals.
 * References: https://lolesports.com/ ; https://www.t1.gg/about
 * Event years in each prompt make answers stable as new seasons are played.
 */
export interface GradedQuestion extends QuizQuestion { answer: number }
const rows: Array<[string, string, string[], number]> = [
  ['worlds-2013', 'SK Telecom T1 vô địch Worlds lần đầu vào năm nào?', ['2011', '2012', '2013', '2014'], 2],
  ['worlds-2015', 'Đội nào vô địch Worlds 2015?', ['SK Telecom T1', 'Fnatic', 'KT Rolster', 'EDward Gaming'], 0],
  ['worlds-2016', 'SKT gặp đội nào ở chung kết Worlds 2016?', ['ROX Tigers', 'Samsung Galaxy', 'Cloud9', 'G2 Esports'], 1],
  ['worlds-2023', 'T1 gặp đội nào ở chung kết Worlds 2023?', ['JDG', 'Gen.G', 'Bilibili Gaming', 'Weibo Gaming'], 3],
  ['worlds-2024', 'T1 gặp đội nào ở chung kết Worlds 2024?', ['Bilibili Gaming', 'Weibo Gaming', 'Dplus KIA', 'FlyQuest'], 0],
  ['faker-role', 'Faker thi đấu ở vị trí nào trong đội hình vô địch Worlds 2023?', ['Đi rừng', 'Đường giữa', 'Hỗ trợ', 'Xạ thủ'], 1],
  ['faker-name', 'Tên thật của Faker là gì?', ['Kim Hyuk-kyu', 'Lee Sang-hyeok', 'Park Jae-hyuk', 'Jeong Ji-hoon'], 1],
  ['faker-debut', 'Faker ra mắt chuyên nghiệp với SKT vào năm nào?', ['2010', '2011', '2013', '2017'], 2],
  ['zeus-2023', 'Ai chơi đường trên cho T1 tại Worlds 2023?', ['Khan', 'Canna', 'Doran', 'Zeus'], 3],
  ['oner-2023', 'Ai đi rừng cho T1 tại Worlds 2023?', ['Oner', 'Bengi', 'Canyon', 'Peanut'], 0],
  ['guma-2023', 'Ai chơi xạ thủ cho T1 tại Worlds 2023?', ['Bang', 'Teddy', 'Gumayusi', 'Deft'], 2],
  ['keria-2023', 'Ai chơi hỗ trợ cho T1 tại Worlds 2023?', ['Wolf', 'Keria', 'Mata', 'Effort'], 1],
  ['bengi-role', 'Bengi chơi vị trí nào khi vô địch Worlds 2016 cùng SKT?', ['Đường trên', 'Xạ thủ', 'Hỗ trợ', 'Đi rừng'], 3],
  ['bang-role', 'Bang chơi vị trí nào trong đội hình SKT vô địch Worlds 2015?', ['Xạ thủ', 'Đường giữa', 'Hỗ trợ', 'Đường trên'], 0],
  ['wolf-role', 'Wolf chơi vị trí nào trong đội hình SKT vô địch Worlds 2015?', ['Đi rừng', 'Hỗ trợ', 'Đường giữa', 'Đường trên'], 1],
  ['marin-2015', 'Ai chơi đường trên cho SKT tại Worlds 2015?', ['Duke', 'Impact', 'MaRin', 'Huni'], 2],
  ['duke-2016', 'Ai chơi đường trên cho SKT tại Worlds 2016?', ['Duke', 'MaRin', 'Zeus', 'Khan'], 0],
  ['impact-2013', 'Ai chơi đường trên cho SKT tại Worlds 2013?', ['Huni', 'Impact', 'Duke', 'Canna'], 1],
  ['final-2015', 'Đối thủ của SKT ở chung kết Worlds 2015 là ai?', ['KOO Tigers', 'Samsung Galaxy', 'Royal Club', 'Fnatic'], 0],
  ['final-2013', 'Đối thủ của SKT ở chung kết Worlds 2013 là ai?', ['OMG', 'Najin Black Sword', 'Royal Club', 'Fnatic'], 2],
  ['final-2017', 'SKT đối đầu đội nào tại chung kết Worlds 2017?', ['Samsung Galaxy', 'Longzhu Gaming', 'Team WE', 'RNG'], 0],
  ['final-2022', 'T1 đối đầu đội nào tại chung kết Worlds 2022?', ['Gen.G', 'DRX', 'JDG', 'RNG'], 1],
  ['msi-2016', 'Đội nào vô địch MSI 2016?', ['CLG', 'RNG', 'SK Telecom T1', 'G2 Esports'], 2],
  ['msi-2017', 'Đối thủ của SKT ở chung kết MSI 2017 là ai?', ['G2 Esports', 'Team Liquid', 'RNG', 'Fnatic'], 0],
  ['region', 'T1 thi đấu ở giải khu vực nào trong mùa 2023?', ['LPL', 'LEC', 'LCS', 'LCK'], 3],
  ['country', 'T1 là tổ chức thể thao điện tử có trụ sở tại quốc gia nào?', ['Nhật Bản', 'Hàn Quốc', 'Trung Quốc', 'Thái Lan'], 1],
  ['2023-host', 'Worlds 2023, nơi T1 đăng quang, được tổ chức ở quốc gia nào?', ['Hàn Quốc', 'Mỹ', 'Pháp', 'Đức'], 0],
  ['2024-final-city', 'Chung kết Worlds 2024 mà T1 giành chiến thắng diễn ra ở thành phố nào?', ['Seoul', 'Paris', 'Berlin', 'London'], 3],
  ['2023-score', 'Tỷ số chung kết Worlds 2023 giữa T1 và Weibo Gaming là bao nhiêu?', ['3–2', '3–1', '3–0', '2–0'], 2],
  ['2024-score', 'Tỷ số chung kết Worlds 2024 giữa T1 và Bilibili Gaming là bao nhiêu?', ['3–0', '3–1', '3–2', '2–1'], 2],
];
export const T1_QUESTION_BANK: readonly GradedQuestion[] = rows.map(([id, prompt, options, answer]) => ({ id, prompt, options, answer }));
export function pickQuestions(): GradedQuestion[] {
  const pool = [...T1_QUESTION_BANK];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 5).map(question => ({ ...question, options: [...question.options] }));
}
export function publicQuestions(questions: GradedQuestion[]): QuizQuestion[] {
  return questions.map(({ id, prompt, options }) => ({ id, prompt, options: [...options] }));
}
