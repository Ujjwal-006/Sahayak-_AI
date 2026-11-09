import fs from "fs";
import path from "path";

function getSamplesDir(): string {
  const envDir = process.env.SAMPLES_DIR ?? "./samples";
  if (path.isAbsolute(envDir)) return envDir;
  const fromCwd = path.resolve(process.cwd(), envDir);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(__dirname, envDir);
}

export interface SampleEntry {
  at_s: number;
  speaker: "agent" | "customer";
  text: string;
  confidence: number;
}

export interface SampleData {
  id: string;
  durationS: number;
  language: string;
  transcript: SampleEntry[];
}

export interface SampleInfo {
  id: string;
  speakers: number;
  durationS: number;
  hasTranscript: boolean;
}

export function listSamples(): SampleInfo[] {
  const dir = getSamplesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => {
      try {
        return fs.statSync(path.join(dir, d)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((id) => {
      const sampleDir = path.join(dir, id);
      const wavs = fs
        .readdirSync(sampleDir)
        .filter((f) => f.startsWith("SPEAKER_") && f.endsWith(".wav"));
      const transcriptPath = path.join(sampleDir, "transcript.json");
      let durationS = 90;
      if (wavs.length > 0) {
        try {
          const w = readWavHeader(path.join(sampleDir, wavs[0]));
          durationS = Math.round(w.durationS);
        } catch {
          durationS = 90;
        }
      }
      return {
        id,
        speakers: wavs.length,
        durationS,
        hasTranscript: fs.existsSync(transcriptPath),
      };
    });
}

export function getSampleAudioFiles(id: string): string[] {
  const dir = path.join(getSamplesDir(), id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("SPEAKER_") && f.endsWith(".wav"))
    .sort();
}

export async function loadSample(
  id: string,
  maxDurationSec?: number
): Promise<SampleData> {
  const dir = getSamplesDir();
  const sampleDir = path.join(dir, id);
  const transcriptPath = path.join(sampleDir, "transcript.json");

  if (!fs.existsSync(transcriptPath)) {
    throw new Error(
      `No transcript for sample ${id}. Run \`npm run transcribe-samples\` or \`bun run transcribe-samples\` first.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
  let transcript: SampleEntry[] = raw.transcript || [];
  if (maxDurationSec) {
    transcript = transcript.filter((e) => e.at_s <= maxDurationSec);
  }

  return {
    id,
    durationS: raw.durationS ?? 90,
    language: raw.language ?? "Hinglish",
    transcript,
  };
}

export function readWavHeader(file: string): { durationS: number; sampleRate: number } {
  const buf = fs.readFileSync(file);
  const dataOffset = buf.indexOf(Buffer.from("data"));
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28) || sampleRate * 2;
  let dataChunkSize = buf.length - 44;

  if (dataOffset !== -1 && dataOffset + 8 <= buf.length) {
    const declaredSize = buf.readUInt32LE(dataOffset + 4);
    if (declaredSize > 0 && declaredSize < buf.length) {
      dataChunkSize = declaredSize;
    }
  }

  const durationS = byteRate > 0 ? dataChunkSize / byteRate : dataChunkSize / (sampleRate * 2);
  return { durationS, sampleRate };
}

