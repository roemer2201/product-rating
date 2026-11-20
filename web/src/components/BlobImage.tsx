import { useEffect, useState } from 'react';

/**
 * An `<img>` for bytes kept on the device, such as a picture waiting in the
 * offline queue. The object URL is a reference the browser holds until it is
 * told otherwise, so it lives exactly as long as the element.
 */
export function BlobImage({
  blob,
  alt,
  className,
}: {
  blob: Blob;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  if (src === null) return null;
  return <img className={className} src={src} alt={alt} />;
}
