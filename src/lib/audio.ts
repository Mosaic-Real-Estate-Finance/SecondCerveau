// A stored recording as the transcription stream takes it: 16 kHz mono PCM.
// Only used when the live stream did not carry the whole dictation.
export async function decodeTo16k(bytes: ArrayBuffer): Promise<Float32Array> {
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
