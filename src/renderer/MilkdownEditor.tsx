import { Crepe } from "@milkdown/crepe";
import { useEffect, useRef } from "react";

import { installIntegralCodeBlockFeature } from "./integralCodeBlockFeature";
import { initializeIntegralPluginRuntime } from "./integralPluginRuntime";
import { createIntegralSnippetFeatureConfigs } from "./integralSnippetMenu";

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

    let shouldDestroyAfterCreate = false;
    let editor: Crepe | null = null;

    void (async () => {
      try {
        await initializeIntegralPluginRuntime();
      } catch (error) {
        console.error("Failed to initialize plugin runtime.", error);
      }

      if (shouldDestroyAfterCreate) {
        return;
      }

      editor = new Crepe({
        featureConfigs: createIntegralSnippetFeatureConfigs(),
        root: rootElement,
        defaultValue: initialValue
      });

      installIntegralCodeBlockFeature(editor);

      editor.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          onChangeRef.current(markdown);
        });
      });

      await editor.create();

      if (shouldDestroyAfterCreate) {
        void editor.destroy();
        return;
      }

      editorRef.current = editor;
    })();

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
