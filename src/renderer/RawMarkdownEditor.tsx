import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef
} from "react";

interface RawMarkdownEditorProps {
  isActive: boolean;
  onChange: (markdown: string) => void;
  toolbar?: ReactNode;
  value: string;
}

export function RawMarkdownEditor({
  isActive,
  onChange,
  toolbar,
  value
}: RawMarkdownEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [value]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!isActive || !textarea || document.activeElement === textarea) {
      return;
    }

    textarea.focus({
      preventScroll: true
    });
  }, [isActive]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Tab") {
      return;
    }

    event.preventDefault();

    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? textarea.value.length;
    const nextValue = `${textarea.value.slice(0, selectionStart)}\t${textarea.value.slice(selectionEnd)}`;
    const nextCursorPosition = selectionStart + 1;

    onChange(nextValue);

    requestAnimationFrame(() => {
      const currentTextarea = textareaRef.current;

      if (!currentTextarea) {
        return;
      }

      currentTextarea.selectionStart = nextCursorPosition;
      currentTextarea.selectionEnd = nextCursorPosition;
      resizeTextarea(currentTextarea);
    });
  };

  return (
    <div className="editor-shell">
      {toolbar ? <div className="editor-toolbar">{toolbar}</div> : null}
      <div className="editor-surface editor-surface--raw">
        <textarea
          aria-label="Markdown 本文テキストエディター"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="raw-markdown-editor"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          ref={textareaRef}
          spellCheck={false}
          value={value}
          wrap="off"
        />
      </div>
    </div>
  );
}

function resizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
