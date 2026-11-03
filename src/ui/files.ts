// Giving the user a file. On phones (notably an iPhone home-screen app, where a plain download
// link may do nothing) the share sheet is used so the file can be saved to Files; elsewhere a
// normal download.

export async function saveFile(blob: Blob, filename: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error | undefined)?.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}
