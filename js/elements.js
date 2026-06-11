/*
 * elements.js
 * 게임에 등장하는 원소 데이터.
 *
 * kind: "buff"  -> 안전한 원소(금속/비활성기체). 쏘면 강해진다.
 *       "trap"  -> 위험한 원소(방사능/독성). 피하거나 잘못 고르면 약해진다.
 *
 * effect: 게이트를 통과할 때 적용되는 효과 종류
 *   squad   : 동료(사수) 수 증가/감소
 *   weapon  : 무기 레벨 증가/감소
 *   shield  : 보호막 획득
 *   firerate: 연사 속도 증가
 *   bomb    : 화면의 좀비 일부 제거(폭발)
 *   score   : 점수 보너스
 *
 * value: 효과의 기본 크기 (게이트에서 쏜 횟수만큼 더 커진다)
 * fact:  통과 시 보여줄 한 줄 교육 설명
 */
const ELEMENTS = [
  // ---------- 안전한 원소 (buff) ----------
  { symbol: "Fe", name: "철",        number: 26, kind: "buff", effect: "weapon",   value: 1, color: "#9aa7b0",
    fact: "철은 강철의 핵심! 무기가 단단해집니다. (무기 강화)" },
  { symbol: "Ti", name: "타이타늄",  number: 22, kind: "buff", effect: "shield",   value: 1, color: "#7fb0c8",
    fact: "타이타늄은 가볍고 튼튼해 방어막이 됩니다. (보호막)" },
  { symbol: "Cu", name: "구리",      number: 29, kind: "buff", effect: "firerate", value: 1, color: "#d98f5a",
    fact: "구리는 전기가 잘 통해요. 연사 속도 UP! (연사 강화)" },
  { symbol: "C",  name: "탄소",      number: 6,  kind: "buff", effect: "squad",    value: 2, color: "#5d6b73",
    fact: "탄소는 생명의 기본! 동료가 늘어납니다. (동료 +)" },
  { symbol: "Au", name: "금",        number: 79, kind: "buff", effect: "score",    value: 500, color: "#e8c349",
    fact: "금은 변하지 않는 귀금속! 점수 보너스. (점수 +)" },
  { symbol: "Na", name: "나트륨",    number: 11, kind: "buff", effect: "bomb",     value: 1, color: "#c97fd9",
    fact: "나트륨은 물과 만나면 펑! 좀비를 폭발로 쓸어버립니다. (폭발)" },
  { symbol: "He", name: "헬륨",      number: 2,  kind: "buff", effect: "shield",   value: 1, color: "#86e0d0",
    fact: "헬륨은 반응하지 않는 비활성기체. 안정적인 보호막! (보호막)" },
  { symbol: "Ne", name: "네온",      number: 10, kind: "buff", effect: "firerate", value: 1, color: "#ff8fb0",
    fact: "네온은 빛나는 비활성기체! 연사 속도 UP. (연사 강화)" },
  { symbol: "Li", name: "리튬",      number: 3,  kind: "buff", effect: "squad",    value: 1, color: "#b8c46a",
    fact: "리튬은 배터리의 원소! 동료가 충전됩니다. (동료 +)" },
  { symbol: "O",  name: "산소",      number: 8,  kind: "buff", effect: "squad",    value: 1, color: "#79c0ff",
    fact: "산소는 숨 쉬는 데 꼭 필요해요. 동료 회복! (동료 +)" },

  // ---------- 위험한 원소 (trap) ----------
  { symbol: "U",  name: "우라늄",    number: 92, kind: "trap", effect: "squad",    value: -2, color: "#5fae5f",
    fact: "우라늄은 방사능 원소! 가까이 가면 동료가 줄어요. (위험)" },
  { symbol: "Hg", name: "수은",      number: 80, kind: "trap", effect: "weapon",   value: -1, color: "#aab2bd",
    fact: "수은은 독성 중금속! 무기가 약해집니다. (위험)" },
  { symbol: "Cl", name: "염소",      number: 17, kind: "trap", effect: "firerate", value: -1, color: "#b6d957",
    fact: "염소는 독가스가 될 수 있어요. 연사 속도 DOWN. (위험)" },
  { symbol: "As", name: "비소",      number: 33, kind: "trap", effect: "squad",    value: -1, color: "#8d7fb0",
    fact: "비소는 유명한 독! 동료가 줄어듭니다. (위험)" },
  { symbol: "Pb", name: "납",        number: 82, kind: "trap", effect: "weapon",   value: -1, color: "#6b7077",
    fact: "납은 몸에 쌓이는 중금속! 무기가 무거워져 약해집니다. (위험)" },
];

// buff / trap 분리해 두면 게이트 짝을 만들 때 편하다.
const BUFF_ELEMENTS = ELEMENTS.filter(function (e) { return e.kind === "buff"; });
const TRAP_ELEMENTS = ELEMENTS.filter(function (e) { return e.kind === "trap"; });
