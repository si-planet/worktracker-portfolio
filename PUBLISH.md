# 공개 저장소 · GitHub Pages 배포

## 이 저장소의 공개 방식

대상 저장소는 `https://github.com/si-planet/worktracker-portfolio.git`입니다. 검수한 파일만 새 Git 이력으로 옮겼으며, 기존 비공개 저장소 이력은 포함하지 않습니다. 아래 초기 생성 절차는 다른 새 저장소로 옮길 때의 참고용입니다. 현재 저장소를 수정할 때는 아래의 **이후 변경과 복구** 절차를 사용하세요.

## 다른 새 저장소에 소스 올리기

이 폴더의 파일만 새 빈 폴더로 복사합니다. 비공개 프로젝트의 `.git`, 실제 자료, `.env`, `node_modules`는 포함하지 않습니다. 검수된 파일 묶음에는 원본 Git 이력이 없습니다.

새 폴더에서:

```sh
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial Work Tracker portfolio demo"
git rev-list --count HEAD
```

첫 커밋 수는 `1`이어야 합니다. GitHub에서 **새 Public 저장소**를 만들고 README/.gitignore/LICENSE 자동 생성은 끕니다. 기존 비공개 저장소를 공개로 전환하지 않습니다.

```sh
git remote add origin <새_공개_저장소_HTTPS_주소>
git remote -v
git push -u origin main
```

위 `<...>`는 GitHub가 보여 주는 본인의 새 저장소 주소로 교체합니다. 비공개 브랜치 자체를 공개 저장소로 push하지 않습니다.

## 웹 데모 켜기

1. 새 저장소의 Settings → Pages를 엽니다.
2. Source: **Deploy from a branch**를 선택합니다.
3. Branch: **main**, Folder: **/docs**를 선택하고 Save합니다.
4. 배포 완료 후 Pages 화면의 **Visit site**에서 실제 주소를 확인합니다.
5. README와 GitHub About의 Website에 확인한 주소를 넣습니다.

준비된 `docs/`는 설치 없이 게시 가능한 정적 출력입니다. 상대 경로와 `#/` 라우팅을 사용하여 저장소 이름이 달라도 동작하고, 일간·주간 화면 새로고침에 SPA fallback이 필요하지 않습니다. `.nojekyll`도 포함했습니다.

공개 주소는 `https://<계정>.github.io/<저장소>/` 형식입니다. 아직 실제 저장소를 만들고 배포하지 않았다면 이 주소가 열리는 것으로 표현하지 않습니다. GitHub Pages는 공개 저장소에 무료로 제공되며 별도 도메인 구매는 필요 없습니다.

## 실행·검사

```sh
python3 scripts/audit.py --export
python3 scripts/serve.py --port 8899 --base /worktracker-portfolio/
```

로컬 주소: `http://127.0.0.1:8899/worktracker-portfolio/`. HTML을 더블클릭하여 실행하지 않습니다.

소스를 수정하여 다시 빌드할 때는 Node 24 이상과 npm에서:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run audit
```

의존성이 없는 공개 사본에서는 `--export` 검사를 사용합니다. 개발 폴더의 `.git`과 `node_modules`를 그대로 복사하지 않습니다.

## CI와 배포의 차이

- 로컬 검사: 내 컴퓨터에서 현재 코드와 파일의 동작을 확인합니다.
- 사용자 정의 CI: GitHub가 push/PR마다 같은 검사를 자동 반복합니다. 현재 별도 CI 파일은 포함하지 않았습니다.
- Pages 배포: 준비된 `docs/` 파일을 실제 주소에 게시합니다. branch 게시도 GitHub 내부의 Pages 배포 workflow를 이용합니다.
- 실주소 검수: 배포된 월간/주간/일간, 상세 URL 새 탭 열기와 새로고침, 가상 업무 추가·수정·완료·초기화, 모바일 화면을 확인합니다.

CI가 통과했다고 배포·실물 모바일 검수까지 완료된 것은 아닙니다. 반대로 현재는 커스텀 CI 없이 준비된 정적 출력을 게시할 수 있습니다. 브라우저의 데이터는 가상 자료이고 다른 기기로 동기화되지 않습니다.

## 이후 변경과 복구

비공개 운영 코드의 변경 중 공개 가능한 부분만 데모에 반영합니다. 테스트하고 `docs/`를 재빌드한 뒤 공개 저장소의 새 커밋으로 올립니다. 원본 비공개 브랜치를 merge하지 않습니다. 잘못된 공개 변경은 해당 공개 커밋을 revert하여 복구합니다.

자체 코드의 일반 재사용 오픈소스 라이선스는 부여하지 않았습니다. `NOTICE.md`와 `THIRD_PARTY_NOTICES.md`를 유지하세요. 공개 플랫폼에서의 열람·fork 권리는 별개입니다.

[Pages 게시 원본](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [사이트 생성](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) · [표준 실행기](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) · [라이선스 안내](https://docs.github.com/articles/licensing-a-repository)
