# Zed Surface 언어 확장 개발 가이드

이 문서는 Surface `.sface` 파일을 위한 Zed 언어 확장을 별도 저장소에서 개발하는
절차를 설명한다. 완성된 확장의 목표는 단순히 `.sface`를 HEEx로 취급하는 것을 넘어,
Surface 고유 문법을 정확하게 파싱하고 강조하는 것이다.

## 목표

첫 번째 버전에서는 다음 기능을 지원한다.

- `.sface` 파일 자동 인식
- HTML 태그와 Surface 컴포넌트 구문 강조
- `{#if}`, `{#for}`, `{/if}` 등의 Surface 블록 강조
- `:if`, `:for`, `:attrs`, `:props` 등의 Surface directive 강조
- `{expression}` 내부 Elixir 구문 강조
- 괄호 매칭과 자동 들여쓰기
- Zed의 문서 outline 지원

코드 완성, 진단, go-to-definition 같은 기능은 Tree-sitter grammar만으로 제공되지
않는다. 이 기능들은 Surface를 이해하는 language server가 별도로 필요하므로 초기
범위에서는 제외한다.

## 사전 조사

Surface용 Tree-sitter grammar가 이미 존재한다.

- <https://github.com/connorlay/tree-sitter-surface>

이 grammar는 Surface 0.5 이상 문법을 기준으로 만들어졌으며 마지막 활동이 오래됐을
수 있다. Surface 0.12 문법을 모두 지원한다고 가정하지 말고, 먼저 현재 프로젝트의
`.sface` 파일을 corpus로 추가해 파싱 결과를 확인한다.

Zed 확장 개발 문서:

- <https://zed.dev/docs/extensions/developing-extensions>
- <https://zed.dev/docs/extensions/languages>

## 권장 저장소 구조

새 Git 저장소를 다음과 같이 만든다.

```text
zed-surface/
├── extension.toml
├── LICENSE
├── README.md
└── languages/
    └── surface/
        ├── config.toml
        ├── highlights.scm
        ├── brackets.scm
        ├── indents.scm
        ├── outline.scm
        └── injections.scm
```

language server나 다른 실행 로직이 없다면 `Cargo.toml`과 Rust 코드는 필요하지 않다.

## 프로젝트 이름

Zed registry의 언어 확장은 일반적으로 registry ID와 표시 이름에는 언어 자체의
이름을 사용한다.

```text
elixir → Elixir
svelte → Svelte
astro  → Astro
zig    → Zig
```

공식 `zed-extensions` 조직의 저장소는 `zed-extensions/elixir`처럼 언어 이름만
사용한다. 개인 계정의 언어 확장 저장소는 `zed-latex`, `zed-laravel-blade`처럼
`zed-<language>` 형식이 흔하다.

이 프로젝트에서는 다음 조합을 사용한다.

```text
GitHub repository: zed-surface
Project directory: zed-surface
Extension ID: surface
Display name: Surface
Language name: Surface
Grammar ID: surface
```

`zed-surface`는 저장소와 로컬 프로젝트를 식별하기 위한 이름이다. Zed registry에
노출되는 확장 ID와 표시 이름에는 `zed` 또는 `extension`을 붙이지 않는다.

## 1. 저장소 생성

```shell
mkdir zed-surface
cd zed-surface
git init
mkdir -p languages/surface
```

공개 배포할 계획이라면 처음부터 GitHub 저장소를 만들고 MIT 또는 Apache-2.0 같은
Zed가 허용하는 라이선스를 추가한다. Zed registry 등록 시 라이선스 파일이 필수다.

## 2. 확장 manifest 작성

루트에 `extension.toml`을 만든다.

```toml
id = "surface"
name = "Surface"
version = "0.0.1"
schema_version = 1
authors = ["Your Name <you@example.com>"]
description = "Surface language support for Zed"
repository = "https://github.com/your-name/zed-surface"

[grammars.surface]
repository = "https://github.com/connorlay/tree-sitter-surface"
rev = "REPLACE_WITH_FULL_COMMIT_SHA"
```

`rev`에는 branch나 tag가 아니라 검증한 commit의 전체 SHA를 사용한다. 그래야
upstream 변경으로 확장 빌드가 갑자기 깨지지 않는다.

grammar를 수정해야 한다면 `tree-sitter-surface`를 fork하고 `repository`를 fork
주소로 변경한다.

## 3. 언어 metadata 작성

`languages/surface/config.toml`:

```toml
name = "Surface"
grammar = "surface"
path_suffixes = ["sface"]
tab_size = 2
hard_tabs = false
autoclose_before = ">})%"
```

이 설정으로 Zed가 `.sface` 파일을 `Surface` 언어로 자동 감지한다.

## 4. grammar를 먼저 검증

highlight query를 작성하기 전에 grammar가 최신 Surface 구문을 파싱하는지 확인한다.
특히 다음 구문을 corpus에 포함한다.

```surface
<Layouts.app flash={@flash}>
  {#if @visible}
    <Card :for={item <- @items} title={item.title} />
  {#else}
    <p>비어 있음</p>
  {/if}

  <button :attrs={@rest} :on-click="save">저장</button>
  <.link navigate={~p"/books"}>도서</.link>
</Layouts.app>
```

확인할 Surface 0.12 문법:

- 대문자로 시작하는 Surface 컴포넌트
- 점으로 시작하는 Phoenix function component
- `{#if}`, `{#for}`, `{#case}` 블록
- `:if`, `:for`, `:attrs`, `:props`, `:on-*` directive
- `{@assign}` 및 일반 Elixir expression
- `~p` verified route sigil
- self-closing tag와 slot

grammar가 이 문법을 파싱하지 못하면 Zed query를 작성하기 전에 grammar fork에서
수정하고 테스트를 추가한다.

## 5. 구문 강조 query 작성

`languages/surface/highlights.scm`은 Tree-sitter가 만든 node를 Zed의 highlight
capture에 연결한다.

아래 코드는 개념 예시다. 실제 node 이름은 grammar 저장소의 `node-types.json`,
기존 `queries/highlights.scm`, `tree-sitter parse` 결과를 기준으로 작성해야 한다.

```scheme
(tag_name) @tag
(component_name) @type
(attribute_name) @attribute
(directive_name) @keyword
(string) @string
(comment) @comment
(block_name) @keyword
```

자주 사용하는 Zed capture:

- `@tag`
- `@type`
- `@function`
- `@attribute`
- `@keyword`
- `@string`
- `@number`
- `@boolean`
- `@comment`
- `@variable`
- `@variable.special`

처음에는 최소 query로 시작한다. 존재하지 않는 node 이름을 query에 사용하면 확장
로드 자체가 실패할 수 있으므로 한 번에 많은 규칙을 작성하지 않는다.

## 6. Elixir expression injection

Surface 표현식 내부는 Surface grammar로 색칠하는 것보다 Elixir grammar에 넘기는
것이 좋다. `languages/surface/injections.scm`에 injection query를 작성한다.

개념 예시:

```scheme
(expression
  (raw_text) @content
  (#set! injection.language "elixir"))
```

`expression`과 `raw_text`는 예시 이름이다. 실제 grammar node 이름으로 교체해야 한다.
다음 코드에서 `@detail`, 함수 호출, `~p` 등이 Elixir로 강조되는지 확인한다.

```surface
<h1>{display(@detail.book.title)}</h1>
<.link navigate={~p"/books"}>돌아가기</.link>
```

Elixir injection을 사용하려면 사용자의 Zed에 Elixir 확장이 설치되어 있어야 한다.
README에 이 의존성을 명시한다.

## 7. 괄호와 들여쓰기

`languages/surface/brackets.scm`은 열고 닫는 태그 및 표현식 괄호를 정의한다.

```scheme
("<" @open ">" @close)
("{" @open "}" @close)
("[" @open "]" @close)
("(" @open ")" @close)
```

정확한 query는 grammar AST에 맞춰 조정한다. 문자열 내부 괄호는 rainbow bracket
대상에서 제외하는 편이 좋다.

`languages/surface/indents.scm`에서는 element와 block body를 들여쓰기 대상으로,
closing tag와 closing block을 outdent 대상으로 지정한다.

개념 예시:

```scheme
(element) @indent
(block) @indent
(closing_tag) @outdent
(block_end) @outdent
```

## 8. outline 작성

`languages/surface/outline.scm`에서는 페이지 구조를 빠르게 탐색할 수 있게 주요
컴포넌트와 HTML section을 노출한다.

```scheme
(component
  name: (component_name) @name) @item
```

모든 `div`를 outline에 표시하면 잡음이 심해진다. 대문자 Surface 컴포넌트와
`id`가 있는 주요 section 정도부터 시작하는 것이 좋다.

## 9. 로컬 개발 확장 설치

Zed에서 다음 절차를 사용한다.

1. Command Palette를 연다.
2. `zed: extensions`를 실행한다.
3. `Install Dev Extension`을 선택한다.
4. `extension.toml`이 있는 `zed-surface` 디렉터리를 선택한다.
5. `.sface` 파일을 닫았다가 다시 연다.

변경 사항이 반영되지 않으면 dev extension을 다시 설치하거나 Zed를 재시작한다.

오류 확인:

1. Command Palette에서 `zed: open log`를 실행한다.
2. 더 자세한 로그가 필요하면 터미널에서 `zed --foreground`로 실행한다.
3. grammar build 또는 query 오류를 찾는다.

grammar를 포함하는 확장은 Tree-sitter parser를 WebAssembly로 빌드한다. Zed가 필요한
WASI SDK를 보통 자동으로 준비하지만, 환경에 따라 `WASI_SDK_PATH` 설정이 필요할 수
있다.

## 10. 실제 프로젝트로 회귀 테스트

이 프로젝트의 다음 파일들을 테스트 fixture로 활용한다.

```text
lib/app_web/pages/books/production.sface
lib/app_web/pages/books/components/pagination_template.sface
lib/app_web/pages/books/components/book_drawer_template.sface
lib/app_web/components/layouts/root.sface
```

다음을 육안과 AST 양쪽에서 확인한다.

- HTML 태그, 컴포넌트, attribute의 색이 구분되는가
- Surface block이 오류 없이 파싱되는가
- Elixir expression이 Elixir 문법으로 강조되는가
- Tailwind class 문자열이 문자열로 유지되는가
- 자동 들여쓰기와 태그 접기가 정상인가
- 큰 `.sface` 파일에서도 성능 문제가 없는가

## 11. 버전별 작업 순서

### 0.0.1

- `.sface` 자동 인식
- 기본 HTML/Surface highlighting
- Elixir expression injection

### 0.0.2

- Surface 0.12 block/directive 지원 보완
- brackets와 indentation
- 실제 프로젝트 corpus 확대

### 0.0.3

- outline
- snippets
- 문서와 스크린샷 보강

초기 버전에서 language server까지 만들려고 하지 않는다. parser와 highlighting의
정확성을 먼저 확보한다.

## 12. 공개 배포

로컬 테스트가 끝나면 확장 저장소를 공개 GitHub 저장소로 push한다. 이후
`zed-industries/extensions` 저장소를 fork하여 다음 작업을 한다.

1. `extensions/<extension-id>`에 확장 저장소를 HTTPS submodule로 추가한다.
2. 최상위 `extensions.toml`에 `surface` 항목과 버전을 추가한다.
3. 저장소 지침에 따라 정렬 및 검증 명령을 실행한다.
4. Zed extensions 저장소에 PR을 연다.

확장 ID는 공개 후 변경할 수 없는 식별자로 취급되므로 처음부터 `surface`처럼
명확하고 안정적인 이름을 선택한다.

## 구현 시 주의사항

- 기존 Elixir 확장을 복사해 전체를 재배포하지 않는다.
- `.sface`를 인식시키는 것만 필요하면 Zed `file_types` 설정으로 충분하다.
- 별도 확장은 Surface 고유 grammar와 편집 기능을 제공할 때 의미가 있다.
- upstream `tree-sitter-surface`가 오래됐다면 먼저 fork와 corpus 테스트부터 한다.
- query 오류와 grammar 오류를 구분한다. 파싱 트리가 틀렸다면 query로 고칠 수 없다.
- repository URL과 grammar commit SHA를 placeholder 상태로 배포하지 않는다.
- registry 제출 전 허용된 라이선스 파일을 반드시 포함한다.

## 완료 기준

다음을 모두 만족하면 첫 공개 버전을 준비할 수 있다.

- 새 Zed 설치에서 dev extension만으로 `.sface`가 자동 인식된다.
- Surface 0.12 대표 문법이 parse error 없이 처리된다.
- HTML, Surface component, directive, Elixir expression이 구분되어 표시된다.
- 실제 Memoreal 템플릿에서 들여쓰기와 괄호 매칭이 정상이다.
- Zed 로그에 grammar/query 로드 오류가 없다.
- README에 설치법, 지원 범위, 알려진 제약, Elixir 확장 의존성이 적혀 있다.
- 라이선스와 고정 grammar commit SHA가 포함되어 있다.
