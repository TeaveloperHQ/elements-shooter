# ⚛️ 원소 슈터 (Elements Shooter)

몰려오는 좀비를 막으면서, 내려오는 **원소 게이트** 중 **안전한 원소**(금속·비활성기체)를
골라 쏘면 동료와 무기가 강해지는 캐주얼 슈팅 게임입니다.
**방사능·독성 원소**를 잘못 고르면 약해져요. 놀면서 원소 특성을 익히는 교육용 웹게임입니다.

> 순수 HTML/CSS/JavaScript로만 만들어 **빌드 과정 없이 GitHub Pages에 바로 배포**됩니다.
> 교사분들이 git + GitHub Pages 워크플로우를 익히기 좋은 예제 프로젝트입니다.

## 🎮 플레이 방법

- **이동**: 마우스 / 터치 / 키보드 `←` `→`
- **사격**: 자동
- 화면 아래 방어선을 좀비가 넘으면 보호막 → 동료 순으로 감소, 동료가 0이면 게임 오버
- 게이트는 **초록=안전 / 빨강=위험**. 안전한 원소 아래에서 통과하세요. 쏠수록 효과 배수가 커집니다.

## 📁 폴더 구조

```
elements-shooter/
├── index.html        # 화면 구조
├── css/style.css     # 디자인
├── js/elements.js    # 원소 데이터 (안전/위험 + 효과)
└── js/game.js        # 게임 로직 (캔버스)
```

## 💻 로컬에서 실행하기

별도 설치 없이 `index.html`을 브라우저로 열면 됩니다.
(권장) 로컬 서버로 띄우면 실제 배포 환경과 동일합니다:

```bash
# Python 3 가 있으면
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

## 🚀 GitHub Pages 배포 (한 번만 설정)

이 저장소는 `TeaveloperHQ/elements-shooter` 입니다. 코드를 푸시하면 자동으로 웹에 올라갑니다.

### 1) 코드 올리기

```bash
git add .
git commit -m "내용 수정"
git push
```

### 2) Pages 켜기 (최초 1회)

- GitHub 저장소 → **Settings** → **Pages**
- **Source**: `Deploy from a branch`
- **Branch**: `main` / `/(root)` 선택 후 **Save**
- 1~2분 뒤 아래 주소로 접속됩니다:

```
https://teaveloperhq.github.io/elements-shooter/
```

> 이후에는 `git push` 만 하면 자동으로 사이트가 갱신됩니다.

## 🧪 원소 추가/수정하기

`js/elements.js` 의 `ELEMENTS` 배열에 한 줄 추가하면 게임에 바로 등장합니다.

```js
{ symbol: "Ag", name: "은", number: 47, kind: "buff", effect: "firerate", value: 1,
  color: "#cfd8e3", fact: "은은 전기가 가장 잘 통해요! 연사 속도 UP." },
```

- `kind`: `"buff"`(안전) / `"trap"`(위험)
- `effect`: `squad`(동료) · `weapon`(무기) · `shield`(보호막) · `firerate`(연사) · `bomb`(폭발) · `score`(점수)

## 📝 라이선스

교육용으로 자유롭게 사용·수정하세요.
