/*
 * elements.js
 * 원소 1~25번(H~Mn). 통조림(수집 아이템)으로 등장.
 * period(주기)·group(족)으로 상단 미니 주기율표에 배치되고,
 * cat(분류)에 따라 표준 주기율표 색을 라벨에 쓴다.
 */

// 표준 주기율표 분류 색
const ELEM_CAT_COLOR = {
  nonmetal:   "#a0e878",  // 반응성 비금속
  halogen:    "#ffe24e",  // 할로젠
  noble:      "#7fe0e0",  // 비활성 기체
  alkali:     "#ff6b6b",  // 알칼리 금속
  alkaline:   "#ffce8a",  // 알칼리 토금속
  metalloid:  "#cccc99",  // 준금속
  posttrans:  "#cfd6dd",  // 전이후 금속
  transition: "#ffb0c4",  // 전이 금속
};

function E(number, symbol, name, period, group, cat) {
  return { number: number, symbol: symbol, name: name, period: period, group: group,
    cat: cat, color: ELEM_CAT_COLOR[cat], kind: "buff" };
}

const ELEMENTS = [
  E(1,  "H",  "수소",     1, 1,  "nonmetal"),
  E(2,  "He", "헬륨",     1, 18, "noble"),
  E(3,  "Li", "리튬",     2, 1,  "alkali"),
  E(4,  "Be", "베릴륨",   2, 2,  "alkaline"),
  E(5,  "B",  "붕소",     2, 13, "metalloid"),
  E(6,  "C",  "탄소",     2, 14, "nonmetal"),
  E(7,  "N",  "질소",     2, 15, "nonmetal"),
  E(8,  "O",  "산소",     2, 16, "nonmetal"),
  E(9,  "F",  "플루오린", 2, 17, "halogen"),
  E(10, "Ne", "네온",     2, 18, "noble"),
  E(11, "Na", "나트륨",   3, 1,  "alkali"),
  E(12, "Mg", "마그네슘", 3, 2,  "alkaline"),
  E(13, "Al", "알루미늄", 3, 13, "posttrans"),
  E(14, "Si", "규소",     3, 14, "metalloid"),
  E(15, "P",  "인",       3, 15, "nonmetal"),
  E(16, "S",  "황",       3, 16, "nonmetal"),
  E(17, "Cl", "염소",     3, 17, "halogen"),
  E(18, "Ar", "아르곤",   3, 18, "noble"),
  E(19, "K",  "칼륨",     4, 1,  "alkali"),
  E(20, "Ca", "칼슘",     4, 2,  "alkaline"),
  E(21, "Sc", "스칸듐",   4, 3,  "transition"),
  E(22, "Ti", "타이타늄", 4, 4,  "transition"),
  E(23, "V",  "바나듐",   4, 5,  "transition"),
  E(24, "Cr", "크로뮴",   4, 6,  "transition"),
  E(25, "Mn", "망가니즈", 4, 7,  "transition"),
];

// 통조림은 모든 원소에서 등장
const BUFF_ELEMENTS = ELEMENTS;
const TRAP_ELEMENTS = [];
