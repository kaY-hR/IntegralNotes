import type {
  WorkspaceSearchMatch,
  WorkspaceSearchResult
} from "../shared/workspace";

export interface SearchSidebarState {
  caseSensitive: boolean;
  excludePattern: string;
  includePattern: string;
  query: string;
  regex: boolean;
  replacement: string;
  showFileFilters: boolean;
  showReplace: boolean;
  wholeWord: boolean;
}

interface SearchSidebarViewProps {
  errorMessage: string | null;
  onChange: (nextState: SearchSidebarState) => void;
  onOpenResult: (relativePath: string, match: WorkspaceSearchMatch) => void;
  onReplaceAll: () => void;
  onSearchNow: () => void;
  replacePending: boolean;
  result: WorkspaceSearchResult | null;
  searchPending: boolean;
  state: SearchSidebarState;
}

function highlightSearchLine(lineText: string, match: WorkspaceSearchMatch): JSX.Element {
  const startIndex = Math.max(0, match.startColumn - 1);
  const endIndex = Math.max(startIndex, match.endColumn - 1);
  const leading = lineText.slice(0, startIndex);
  const highlighted = lineText.slice(startIndex, endIndex);
  const trailing = lineText.slice(endIndex);

  return (
    <span className="sidebar-search__match-line">
      <span>{leading}</span>
      <mark>{highlighted || " "}</mark>
      <span>{trailing}</span>
    </span>
  );
}

export function SearchSidebarView({
  errorMessage,
  onChange,
  onOpenResult,
  onReplaceAll,
  onSearchNow,
  replacePending,
  result,
  searchPending,
  state
}: SearchSidebarViewProps): JSX.Element {
  const queryIsEmpty = state.query.trim().length === 0;
  const hasResults = (result?.totalMatchCount ?? 0) > 0;
  const summaryText = queryIsEmpty
    ? "検索語を入力すると workspace 全体を検索します。"
    : searchPending
      ? "検索中..."
      : result
        ? `${result.searchedFileCount} files / ${result.totalMatchCount} matches${
            result.truncated ? " (truncated)" : ""
          }`
        : "一致はまだありません。";

  return (
    <div className="sidebar-search">
      <div className="sidebar-search__header">
        <div>
          <p className="sidebar__eyebrow">Workspace Search</p>
          <h2 className="sidebar-search__title">Search</h2>
          <p className="sidebar-search__description">
            text file を横断検索し、必要なら一括置換します。
          </p>
        </div>
      </div>

      <div className="sidebar-search__toolbar">
        <div className="sidebar-search__query-box">
          <input
            className="sidebar-search__input"
            onChange={(event) => {
              onChange({
                ...state,
                query: event.target.value
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearchNow();
              }
            }}
            placeholder="検索"
            type="search"
            value={state.query}
          />
          <button
            className="button button--ghost sidebar-search__submit"
            onClick={onSearchNow}
            type="button"
          >
            Search
          </button>
        </div>

        <div className="sidebar-search__controls">
          <button
            className={`button button--ghost sidebar-search__chip${
              state.showReplace ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                showReplace: !state.showReplace
              });
            }}
            type="button"
          >
            置換
          </button>
          <button
            className={`button button--ghost sidebar-search__chip${
              state.showFileFilters ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                showFileFilters: !state.showFileFilters
              });
            }}
            type="button"
          >
            ファイル条件
          </button>
          <button
            aria-pressed={state.caseSensitive}
            className={`button button--ghost sidebar-search__chip${
              state.caseSensitive ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                caseSensitive: !state.caseSensitive
              });
            }}
            title="Case Sensitive"
            type="button"
          >
            Aa
          </button>
          <button
            aria-pressed={state.wholeWord}
            className={`button button--ghost sidebar-search__chip${
              state.wholeWord ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                wholeWord: !state.wholeWord
              });
            }}
            title="Whole Word"
            type="button"
          >
            Ab
          </button>
          <button
            aria-pressed={state.regex}
            className={`button button--ghost sidebar-search__chip${
              state.regex ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                regex: !state.regex
              });
            }}
            title="Use Regular Expression"
            type="button"
          >
            .*
          </button>
        </div>
      </div>

      {state.showReplace ? (
        <div className="sidebar-search__advanced">
          <input
            className="sidebar-search__input"
            onChange={(event) => {
              onChange({
                ...state,
                replacement: event.target.value
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                onReplaceAll();
              }
            }}
            placeholder="置換"
            type="text"
            value={state.replacement}
          />
          <button
            className="button button--primary"
            disabled={queryIsEmpty || !hasResults || replacePending || searchPending}
            onClick={onReplaceAll}
            type="button"
          >
            {replacePending ? "置換中..." : "Replace All"}
          </button>
        </div>
      ) : null}

      {state.showFileFilters ? (
        <div className="sidebar-search__advanced sidebar-search__advanced--filters">
          <label className="sidebar-search__field">
            <span>含めるファイル</span>
            <input
              className="sidebar-search__input"
              onChange={(event) => {
                onChange({
                  ...state,
                  includePattern: event.target.value
                });
              }}
              placeholder="例: src/**/*.ts, docs/**/*.md"
              type="text"
              value={state.includePattern}
            />
          </label>
          <label className="sidebar-search__field">
            <span>除外するファイル</span>
            <input
              className="sidebar-search__input"
              onChange={(event) => {
                onChange({
                  ...state,
                  excludePattern: event.target.value
                });
              }}
              placeholder="例: node_modules/**, dist/**"
              type="text"
              value={state.excludePattern}
            />
          </label>
        </div>
      ) : null}

      <div className="sidebar-search__summary">
        <span>{summaryText}</span>
        {errorMessage ? <strong className="sidebar-search__error">{errorMessage}</strong> : null}
      </div>

      <div className="sidebar-search__results">
        {queryIsEmpty ? (
          <div className="sidebar-search__empty">
            <strong>検索語を入力してください。</strong>
            <span>query は入力ごとに自動検索されます。</span>
          </div>
        ) : hasResults && result ? (
          result.files.map((file) => (
            <section className="sidebar-search__file" key={file.relativePath}>
              <button
                className="sidebar-search__file-button"
                onClick={() => {
                  const firstMatch = file.matches[0];

                  if (firstMatch) {
                    onOpenResult(file.relativePath, firstMatch);
                  }
                }}
                type="button"
              >
                <span className="sidebar-search__file-path">{file.relativePath}</span>
                <span className="sidebar-search__file-count">{file.matchCount}</span>
              </button>

              <div className="sidebar-search__match-list">
                {file.matches.map((match, index) => (
                  <button
                    className="sidebar-search__match"
                    key={`${file.relativePath}:${match.lineNumber}:${match.startColumn}:${index}`}
                    onClick={() => {
                      onOpenResult(file.relativePath, match);
                    }}
                    type="button"
                  >
                    <span className="sidebar-search__line-number">{match.lineNumber}</span>
                    {highlightSearchLine(match.lineText, match)}
                  </button>
                ))}
              </div>
            </section>
          ))
        ) : searchPending ? (
          <div className="sidebar-search__empty">
            <strong>検索中...</strong>
            <span>workspace file を走査しています。</span>
          </div>
        ) : (
          <div className="sidebar-search__empty">
            <strong>一致は見つかりませんでした。</strong>
            <span>query や file filter を見直してください。</span>
          </div>
        )}
      </div>
    </div>
  );
}
