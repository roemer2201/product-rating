import { useState } from 'react';

/**
 * Copying a text to the clipboard, and remembering how it went.
 *
 * `copied` holds the key of the entry that was copied last, so a list of
 * invites can say "Kopiert." next to the one that was tapped and nowhere else.
 * A refusal is not swallowed: without clipboard permission or without a secure
 * context there is no clipboard, and the screen has to say so - the text is on
 * it and can be selected by hand.
 */
export function useClipboard(): {
  copied: string | null;
  failed: boolean;
  copy: (key: string, text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const copy = async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return { copied, failed, copy };
}
