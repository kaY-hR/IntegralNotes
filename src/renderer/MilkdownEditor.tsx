import { Crepe } from "@milkdown/crepe";
import { insert } from "@milkdown/kit/utils";
import { useEffect, useRef } from "react";

import { installIntegralCodeBlockFeature } from "./integralCodeBlockFeature";
import { initializeIntegralPluginRuntime } from "./integralPluginRuntime";
import {
  createIntegralSnippetFeatureConfigs,
  INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT
} from "./integralSnippetMenu";

interface MilkdownEditorProps {
  initialValue: string;
  isActive: boolean;
  onChange: (markdown: string) => void;
}

export function MilkdownEditor({
  initialValue,
  isActive,
  onChange
}: MilkdownEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

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

      await editor.create();

      if (shouldDestroyAfterCreate) {
        void editor.destroy();
        return;
      }

      editor.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          onChangeRef.current(markdown);
        });
      });

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

  useEffect(() => {
    const handleInsertBlockMarkdown = (event: Event): void => {
      if (!isActiveRef.current) {
        return;
      }

      const customEvent = event as CustomEvent<string>;
      const markdown = customEvent.detail;

      if (typeof markdown !== "string" || markdown.trim().length === 0) {
        return;
      }

      const editor = editorRef.current;

      if (!editor) {
        return;
      }

      editor.editor.action(insert(markdown));
    };

    window.addEventListener(
      INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT,
      handleInsertBlockMarkdown as EventListener
    );

    return () => {
      window.removeEventListener(
        INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT,
        handleInsertBlockMarkdown as EventListener
      );
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


