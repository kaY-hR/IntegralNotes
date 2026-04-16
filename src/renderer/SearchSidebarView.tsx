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

function SearchRefreshIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="sidebar-search__icon-svg" viewBox="0 0 16 16">
      <path d="M13 4.6V1.9m0 0H10.3m2.7 0A5.6 5.6 0 1 0 13.8 11" />
    </svg>
  );
}

function SearchReplaceIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="sidebar-search__icon-svg" viewBox="0 0 16 16">
      <path d="M2.1 4.4h8.5" />
      <path d="m8 1.8 2.6 2.6L8 7" />
      <path d="M13.9 11.6H5.4" />
      <path d="M8 9l-2.6 2.6L8 14.2" />
    </svg>
  );
}

function SearchFilterIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="sidebar-search__icon-svg" viewBox="0 0 16 16">
      <path d="M2.3 4.2h11.4" />
      <path d="M4.2 8h7.6" />
      <path d="M6.1 11.8h3.8" />
    </svg>
  );
}

function SearchCollapseIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" className="sidebar-search__icon-svg" viewBox="0 0 16 16">
      <path d="M3 5.1h10" />
      <path d="M3 8h10" />
      <path d="M3 10.9h10" />
      <path d="m6.2 3.5 1.8 1.6 1.8-1.6" />
      <path d="m6.2 12.5 1.8-1.6 1.8 1.6" />
    </svg>
  );
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
  const hasExpandedPanels = state.showReplace || state.showFileFilters;
  const statusText = queryIsEmpty
    ? ""
    : searchPending
      ? "検索中..."
      : result
        ? `${result.totalMatchCount} 件の一致 / ${result.searchedFileCount} files${
            result.truncated ? " / truncated" : ""
          }`
        : "一致なし";

  return (
    <div className="sidebar-search">
      <div className="sidebar-search__topbar">
        <h2 className="sidebar-search__heading">検索</h2>

        <div className="sidebar-search__topbar-actions">
          <button
            className="button button--ghost sidebar-search__icon-button"
            onClick={onSearchNow}
            title="再検索"
            type="button"
          >
            <SearchRefreshIcon />
          </button>
          <button
            aria-pressed={state.showReplace}
            className={`button button--ghost sidebar-search__icon-button${
              state.showReplace ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                showReplace: !state.showReplace
              });
            }}
            title="置換を表示"
            type="button"
          >
            <SearchReplaceIcon />
          </button>
          <button
            aria-pressed={state.showFileFilters}
            className={`button button--ghost sidebar-search__icon-button${
              state.showFileFilters ? " is-active" : ""
            }`}
            onClick={() => {
              onChange({
                ...state,
                showFileFilters: !state.showFileFilters
              });
            }}
            title="ファイル条件を表示"
            type="button"
          >
            <SearchFilterIcon />
          </button>
          <button
            className="button button--ghost sidebar-search__icon-button"
            disabled={!hasExpandedPanels}
            onClick={() => {
              onChange({
                ...state,
                showFileFilters: false,
                showReplace: false
              });
            }}
            title="補助パネルを閉じる"
            type="button"
          >
            <SearchCollapseIcon />
          </button>
        </div>
      </div>

      <div className="sidebar-search__fields">
        <div className="sidebar-search__input-row">
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

          <div className="sidebar-search__inline-options">
            <button
              aria-pressed={state.caseSensitive}
              className={`button button--ghost sidebar-search__option-button${
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
              className={`button button--ghost sidebar-search__option-button${
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
              ab
            </button>
            <button
              aria-pressed={state.regex}
              className={`button button--ghost sidebar-search__option-button${
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
              *
            </button>
          </div>
        </div>

        {state.showReplace ? (
          <div className="sidebar-search__input-row sidebar-search__input-row--replace">
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
              className="button button--ghost sidebar-search__replace-action"
              disabled={queryIsEmpty || !hasResults || replacePending || searchPending}
              onClick={onReplaceAll}
              type="button"
            >
              {replacePending ? "..." : "AB"}
            </button>
          </div>
        ) : null}

        {state.showFileFilters ? (
          <div className="sidebar-search__filters">
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
                placeholder="例: *.ts, src/**/*.md"
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
                placeholder="例: node_modules/**"
                type="text"
                value={state.excludePattern}
              />
            </label>
          </div>
        ) : null}
      </div>

      {statusText.length > 0 || errorMessage ? (
        <div className="sidebar-search__meta">
          {statusText.length > 0 ? <span>{statusText}</span> : <span />}
          {errorMessage ? <strong className="sidebar-search__error">{errorMessage}</strong> : null}
        </div>
      ) : null}

      <div className="sidebar-search__results">
        {queryIsEmpty ? (
          <div className="sidebar-search__empty">検索語を入力してください。</div>
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
          <div className="sidebar-search__empty">検索中...</div>
        ) : (
          <div className="sidebar-search__empty">一致は見つかりませんでした。</div>
        )}
      </div>
    </div>
  );
}
