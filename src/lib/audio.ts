// Whisper takes 16 kHz mono PCM. Decoding happens on the main thread because
// workers have no AudioContext; the samples are then transferred, not copied.
export async function decodeForWhisper(bytes: ArrayBuffer): Promise<Float32Array> {
  if (!bytes.byteLength) throw new Error("enregistrement vide");
  const context = new OfflineAudioContext(1, 1, 16000);
  // decodeAudioData detaches what it is given, and the same bytes are held in
  // the note: it gets a copy, so a second attempt still has something to read.
  const buffer = await context.decodeAudioData(bytes.slice(0));
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}
