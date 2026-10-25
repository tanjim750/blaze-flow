"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks,
  ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2, Unlink,
} from "@/components/icons";
import { briefToEditorHtml } from "@/lib/rich-brief";
import "./rich-text.css";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (keys: string) => (isMac() ? keys.replace("Mod", "⌘").replace("Shift", "⇧").replace(/\+/g, "") : keys.replace("Mod", "Ctrl"));

/** Only web and mail links; anything else typed into the link box is refused. */
export function normaliseLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
  if (/^[\w.-]+@[\w-]+\.[\w.-]+$/.test(value)) return `mailto:${value}`;
  if (/^[a-z][\w+.-]*:/i.test(value)) return null;
  return `https://${value.replace(/^\/+/, "")}`;
}

export const briefExtensions = (placeholder: string) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    code: false, codeBlock: false, horizontalRule: false, trailingNode: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Placeholder.configure({ placeholder }),
];

type Tool = { key: string; label: string; shortcut?: string; icon: ReactNode; active?: (e: Editor) => boolean; run: (e: Editor) => void; can?: (e: Editor) => boolean };

const TOOL_GROUPS: Tool[][] = [
  [
    { key: "undo", label: "Undo", shortcut: "Mod+Z", icon: <Undo2 />, run: (e) => e.chain().focus().undo().run(), can: (e) => e.can().undo() },
    { key: "redo", label: "Redo", shortcut: "Mod+Shift+Z", icon: <Redo2 />, run: (e) => e.chain().focus().redo().run(), can: (e) => e.can().redo() },
  ],
  [
    { key: "h1", label: "Heading 1", shortcut: "Mod+Alt+1", icon: <Heading1 />, active: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { key: "h2", label: "Heading 2", shortcut: "Mod+Alt+2", icon: <Heading2 />, active: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: "h3", label: "Heading 3", shortcut: "Mod+Alt+3", icon: <Heading3 />, active: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { key: "bold", label: "Bold", shortcut: "Mod+B", icon: <Bold />, active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { key: "italic", label: "Italic", shortcut: "Mod+I", icon: <Italic />, active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { key: "underline", label: "Underline", shortcut: "Mod+U", icon: <Underline />, active: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
    { key: "strike", label: "Strikethrough", shortcut: "Mod+Shift+S", icon: <Strikethrough />, active: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
  ],
  [
    { key: "bullet", label: "Bulleted list", shortcut: "Mod+Shift+8", icon: <List />, active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: "ordered", label: "Numbered list", shortcut: "Mod+Shift+7", icon: <ListOrdered />, active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: "task", label: "Checklist", shortcut: "Mod+Shift+9", icon: <ListChecks />, active: (e) => e.isActive("taskList"), run: (e) => e.chain().focus().toggleTaskList().run() },
    { key: "quote", label: "Quote", shortcut: "Mod+Shift+B", icon: <Quote />, active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  ],
  [
    { key: "left", label: "Align left", shortcut: "Mod+Shift+L", icon: <AlignLeft />, active: (e) => e.isActive({ textAlign: "left" }), run: (e) => e.chain().focus().setTextAlign("left").run() },
    { key: "center", label: "Align centre", shortcut: "Mod+Shift+E", icon: <AlignCenter />, active: (e) => e.isActive({ textAlign: "center" }), run: (e) => e.chain().focus().setTextAlign("center").run() },
    { key: "right", label: "Align right", shortcut: "Mod+Shift+R", icon: <AlignRight />, active: (e) => e.isActive({ textAlign: "right" }), run: (e) => e.chain().focus().setTextAlign("right").run() },
    { key: "justify", label: "Justify", shortcut: "Mod+Shift+J", icon: <AlignJustify />, active: (e) => e.isActive({ textAlign: "justify" }), run: (e) => e.chain().focus().setTextAlign("justify").run() },
  ],
];

function Toolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  // Re-render on selection and history changes so active and disabled states stay right.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => Object.fromEntries(TOOL_GROUPS.flat().map((tool) => [tool.key, { on: tool.active?.(e) ?? false, can: tool.can?.(e) ?? true }]).concat([["link", { on: e.isActive("link"), can: true }]])),
  });
  return (
    <div className="rt-toolbar" role="toolbar" aria-label="Formatting" aria-orientation="horizontal">
      {TOOL_GROUPS.map((group, index) => (
        <div className="rt-group" key={index} role="group">
          {group.map((tool) => (
            <button key={tool.key} type="button" className="rt-tool" aria-label={tool.label} title={tool.shortcut ? `${tool.label} (${mod(tool.shortcut)})` : tool.label}
              aria-pressed={tool.active ? state[tool.key].on : undefined} disabled={!state[tool.key].can}
              onMouseDown={(event) => event.preventDefault()} onClick={() => tool.run(editor)}>
              {tool.icon}
            </button>
          ))}
          {index === 3 && (
            <button type="button" className="rt-tool" aria-label="Link" title={`Link (${mod("Mod+K")})`} aria-pressed={state.link.on}
              onMouseDown={(event) => event.preventDefault()} onClick={onLink}>
              <Link2 />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function LinkBar({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [value, setValue] = useState(() => (editor.getAttributes("link").href as string | undefined) ?? "");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const apply = () => {
    if (!value.trim()) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onDone(); return; }
    const href = normaliseLink(value);
    if (!href) { setError("Use a web address (https://…) or an email address."); return; }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: value.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onDone();
  };
  return (
    <div className="rt-linkbar">
      <label className="rt-sr" htmlFor="rt-link-input">Link address</label>
      <input id="rt-link-input" ref={input} type="url" inputMode="url" placeholder="Paste or type a link" value={value} aria-invalid={!!error}
        aria-describedby={error ? "rt-link-error" : undefined}
        onChange={(event) => { setValue(event.target.value); setError(null); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply(); } if (event.key === "Escape") { event.preventDefault(); onDone(); editor.commands.focus(); } }} />
      <button type="button" className="rt-linkbar-apply" onClick={apply}>Apply</button>
      {editor.isActive("link") && <button type="button" className="rt-linkbar-remove" aria-label="Remove link" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onDone(); }}><Unlink /></button>}
      {error && <p id="rt-link-error" className="rt-linkbar-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The Brief editor: Word-style formatting on Tiptap. Markdown shortcuts come with the
 * starter kit ("- " bullets, "1. " numbers, "# " headings, "> " quotes, "[ ] " checklist).
 * Emits HTML ("" when empty); the API sanitises it before it is stored.
 */
export function BriefEditor({ id, value, onChange, onBlur, placeholder, label }: {
  id: string; value: string | null; onChange: (html: string) => void; onBlur?: () => void; placeholder: string; label: string;
}) {
  const [linking, setLinking] = useState(false);
  const changed = useRef(onChange);
  const blurred = useRef(onBlur);
  useEffect(() => { changed.current = onChange; blurred.current = onBlur; });
  const editor = useEditor({
    immediatelyRender: false,
    extensions: briefExtensions(placeholder),
    content: briefToEditorHtml(value),
    editorProps: {
      attributes: { id, class: "rt-content rt-editable", role: "textbox", "aria-multiline": "true", "aria-label": label },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setLinking(true); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => changed.current(e.isEmpty ? "" : e.getHTML()),
    onBlur: () => blurred.current?.(),
  });
  if (!editor) return <div className="rt-editor is-loading" aria-busy="true"><div className="rt-toolbar" /><div className="rt-content rt-editable" /></div>;
  return (
    <div className="rt-editor">
      <Toolbar editor={editor} onLink={() => setLinking((open) => !open)} />
      {linking && <LinkBar editor={editor} onDone={() => setLinking(false)} />}
      <EditorContent editor={editor} />
    </div>
  );
}
