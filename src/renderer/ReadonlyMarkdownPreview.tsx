import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/kit/utils";
import { useEffect, useRef } from "react";

interface ReadonlyMarkdownPreviewProps {
  className?: string;
  content: string;
  proxyDomURL?: (url: string) => Promise<string>;
}

export function ReadonlyMarkdownPreview({
  className,
  content,
  proxyDomURL
}: ReadonlyMarkdownPreviewProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const lastSyncedMarkdownRef = useRef(content);

  useEffect(() => {
    const rootElement = rootRef.current;

    if (!rootElement) {
      return;
    }

    let shouldDestroyAfterCreate = false;
    let preview: Crepe | null = null;

    void (async () => {
      preview = new Crepe({
        featureConfigs: proxyDomURL
          ? {
              [Crepe.Feature.ImageBlock]: {
                proxyDomURL
              }
            }
          : undefined,
        root: rootElement,
        defaultValue: content
      });
      preview.setReadonly(true);
      await preview.create();

      if (shouldDestroyAfterCreate) {
        void preview.destroy();
        return;
      }

      editorRef.current = preview;
      lastSyncedMarkdownRef.current = content;
    })();

    return () => {
      shouldDestroyAfterCreate = true;

      if (preview) {
        if (editorRef.current === preview) {
          editorRef.current = null;
        }

        void preview.destroy();
      }
    };
  }, [proxyDomURL]);

  useEffect(() => {
    const preview = editorRef.current;

    if (!preview || content === lastSyncedMarkdownRef.current) {
      return;
    }

    preview.editor.action((ctx) => {
      replaceAll(content)(ctx);
    });
    lastSyncedMarkdownRef.current = content;
  }, [content]);

  return (
    <div
      className={className ? `readonly-markdown-preview ${className}` : "readonly-markdown-preview"}
      ref={rootRef}
    />
  );
}
