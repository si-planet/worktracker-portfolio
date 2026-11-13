# Work Tracker · Portfolio Demo

기존 UI에서 분리한 **가상 데이터 전용 포트폴리오 데모**입니다. 10월 다섯 주와 여러 날 이어지는 업무를 포함하는 2026년 10월의 가상 회사와 기록 24개 (업무 21개·회의 2개·행사 1개)로 월간·주간·일간 화면을 체험합니다. 실제 계정·업무 자료·운영 서버·원본 Git 이력은 포함하지 않습니다.

- 가상 업무 추가·수정·완료, 업무와 분류 색상, 개인 중요 표시
- 변경은 이 브라우저에만 저장되며 **데모 초기화**로 예시 24개를 복원
- JSON 내려받기는 업무와 업무 색상만 포함
- 로그인·계정 관리·실제 WBS 가져오기·서버 저장·문서 확정은 비활성

## 웹 데모

**[Work Tracker 데모 열기](https://si-planet.github.io/worktracker-portfolio/)**

복사할 주소: `https://si-planet.github.io/worktracker-portfolio/`

로그인 없이 가상 업무를 체험할 수 있습니다. 수정 내용은 현재 브라우저에만 저장되며 실제 서비스나 다른 기기와 동기화되지 않습니다.

2026-11-13 공개 주소에서 월간 → 일간 → 주간 이동, 상세 주소 새로고침, 가상 업무 추가·완료·새로고침 유지와 배포 자산 8개의 해시를 확인했습니다. 브라우저 확인창 제어가 응답하지 않아 데모 초기화 수락 결과는 미검증이며, 실휴대폰 검수는 별도입니다. [배포 검증 기록](verification/pages.json)

## 화면 개선

월간 제목과 이전·다음 이동을 중앙에 정렬하고 중복 조회 메뉴를 제거했습니다. 색상 설정의 버튼·선택창 높이는 PC 40px, 모바일 44px로 통일했습니다. 일간 화면의 중복 보기 전환과 별도 메모 조회 버튼도 정리했습니다. 기존 브라우저의 업무 수정·삭제는 유지하면서 추가 예시 14개를 한 번만 보완합니다.

## 실행 / 게시 설정

`docs/`에 미리 빌드한 정적 파일이 포함되어 있습니다. GitHub Pages에서 **Deploy from a branch → main → /docs**를 선택하면 됩니다. 저장소 이름을 바꿔도 빌드 설정 수정이 필요하지 않습니다. 공유 링크는 `/#/c/…/day?date=…` 형태이며 새로고침도 동작합니다.

공개 소스: [si-planet/worktracker-portfolio](https://github.com/si-planet/worktracker-portfolio). 비공개 이력 없이 정제한 파일로 새 이력을 시작했습니다.

웹 데모는 GitHub Pages의 `main /docs`에서 게시됩니다. 이후 게시·검사·업데이트 절차는 [GitHub Pages 안내](PUBLISH.md)에 있습니다.

로컬 실행은 Python 3만 필요합니다.

```sh
python3 scripts/serve.py --port 8899
```

`http://127.0.0.1:8899/`를 엽니다. 실제 데이터는 입력하지 마세요.

## 개발 / 확인

Node.js 24 이상, npm, Python 3을 사용합니다. 호스팅 자체에는 Node나 npm이 필요하지 않습니다.

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

`npm run build`는 `docs/`의 생성 파일을 갱신합니다. 경로·로컬 어댑터·가상 자료 보완 및 저장 보존·정적 HTTP 테스트와 소스 SHA-256 검사가 포함됩니다. `verification/`의 기록은 공개 후보의 파일 검증이며 실제 운영 서비스 전체나 실물 휴대폰 검수를 의미하지 않습니다.

`web/`, `shared/`는 검토된 UI 소스 스냅샷입니다. 브라우저 라우팅·합성 API·저장은 `demo/`가 담당하며 제품 소스의 라우팅은 빌드 중에만 어댑터로 연결합니다. 재사용 권한은 [NOTICE.md](NOTICE.md), 제3자 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.

![가상 데이터 월간 화면](assets/latest-month-desktop.jpg)

![가상 데이터 모바일 화면](assets/latest-month-mobile.jpg)
