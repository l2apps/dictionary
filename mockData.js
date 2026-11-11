// Dùng .js (ES module) thay cho .json để import trực tiếp, không cần fetch.
export const MOCK_WORDS = {
  formidability: {
    word: "Formidability",
    pos: "noun",
    ipa: "/ˌfɔːmɪdəˈbɪləti/",
    audio: "",
    definition_en: "The quality of being formidable: inspiring fear, respect, or awe through size, power, or excellence.",
    cefr: "C2",
    saved: true,
    analysis: {
      vietnamese_meaning: "sự đáng gờm, sức mạnh đáng nể",
      simple_explanation: "Là cảm giác người khác vừa sợ vừa nể bạn (hoặc một đội, một vật) vì quá mạnh hoặc quá giỏi.",
      etymology: {
        breakdown: "formid- (nỗi sợ, từ Latin formido) + -able (có thể) + -ity (hậu tố danh từ)",
        memory_hook: "Formid- = sợ: thứ gì 'đáng sợ' thì có formidability.",
        related_words: ["formidable (adj): đáng gờm", "daunting (adj): làm nản chí", "feeble (adj): yếu ớt (trái nghĩa)"]
      },
      collocations: [
        { phrase: "the formidability of the opponent", meaning: "sự đáng gờm của đối thủ" },
        { phrase: "underestimate someone's formidability", meaning: "đánh giá thấp sức mạnh của ai đó" },
        { phrase: "intellectual formidability", meaning: "trí tuệ đáng nể" }
      ],
      nuance_comparison: "'Strength' chỉ sức mạnh nói chung. 'Formidability' mang sắc thái trang trọng: sức mạnh đó khiến người khác phải dè chừng, nể sợ."
    },
    context_prompt: "Bạn vừa xem một đội bóng nhỏ bất ngờ thắng đội vô địch. Hãy viết câu về sự đáng gờm của đội thắng.",
    examples: [
      {
        id: "ex-mock-1",
        text: "The team's formidability became clear after they won ten matches in a row.",
        score: 9.0,
        grammar_feedback: "Ngữ pháp chính xác, cấu trúc 'became clear after...' rất tự nhiên.",
        nuance_feedback: "'Formidability' dùng đúng sắc thái: sức mạnh khiến đối thủ phải dè chừng.",
        corrected_sentence: "The team's formidability became clear after they won ten matches in a row.",
        c1_upgrade_sentence: "It was only after their ten-match winning streak that the team's true formidability came to light."
      },
      {
        id: "ex-mock-2",
        text: "Nobody should underestimate the formidability of her memory.",
        score: 7.5,
        grammar_feedback: "Câu đúng ngữ pháp.",
        nuance_feedback: "Hơi gượng: 'formidability' hợp với 'intellect' hơn là 'memory'.",
        corrected_sentence: "Nobody should underestimate the formidability of her intellect.",
        c1_upgrade_sentence: "One would be ill-advised to underestimate the sheer formidability of her intellect."
      }
    ]
  }
};
