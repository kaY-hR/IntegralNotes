import { Crepe } from "@milkdown/crepe";
import { useEffect, useRef } from "react";

interface MilkdownEditorProps {
  initialValue: string;
  onChange: (markdown: string) => void;
}

export function MilkdownEditor({
  initialValue,
  onChange
}: MilkdownEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const rootElement = rootRef.current;

    if (!rootElement) {
      return;
    }

    const editor = new Crepe({
      root: rootElement,
      defaultValue: initialValue
    });

    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
      });
    });

    let shouldDestroyAfterCreate = false;

    void editor.create().then(() => {
      if (shouldDestroyAfterCreate) {
        void editor.destroy();
        return;
      }

      editorRef.current = editor;
    });

    return () => {
      shouldDestroyAfterCreate = true;

      if (editorRef.current === editor) {
        editorRef.current = null;
        void editor.destroy();
      }
    };
  }, []);

  return (
    <div className="editor-shell">
      <div
        className="editor-surface"
        ref={rootRef}
      />
    </div>
  );
}
