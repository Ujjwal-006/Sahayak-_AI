"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSamples = listSamples;
exports.getSampleAudioFiles = getSampleAudioFiles;
exports.loadSample = loadSample;
exports.readWavHeader = readWavHeader;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function getSamplesDir() {
    const envDir = process.env.SAMPLES_DIR ?? "./samples";
    if (path_1.default.isAbsolute(envDir))
        return envDir;
    const fromCwd = path_1.default.resolve(process.cwd(), envDir);
    if (fs_1.default.existsSync(fromCwd))
        return fromCwd;
    return path_1.default.resolve(__dirname, envDir);
}
function listSamples() {
    const dir = getSamplesDir();
    if (!fs_1.default.existsSync(dir))
        return [];
    return fs_1.default
        .readdirSync(dir)
        .filter((d) => {
        try {
            return fs_1.default.statSync(path_1.default.join(dir, d)).isDirectory();
        }
        catch {
            return false;
        }
    })
        .map((id) => {
        const sampleDir = path_1.default.join(dir, id);
        const wavs = fs_1.default
            .readdirSync(sampleDir)
            .filter((f) => f.startsWith("SPEAKER_") && f.endsWith(".wav"));
        const transcriptPath = path_1.default.join(sampleDir, "transcript.json");
        let durationS = 90;
        if (wavs.length > 0) {
            try {
                const w = readWavHeader(path_1.default.join(sampleDir, wavs[0]));
                durationS = Math.round(w.durationS);
            }
            catch {
                durationS = 90;
            }
        }
        return {
            id,
            speakers: wavs.length,
            durationS,
            hasTranscript: fs_1.default.existsSync(transcriptPath),
        };
    });
}
function getSampleAudioFiles(id) {
    const dir = path_1.default.join(getSamplesDir(), id);
    if (!fs_1.default.existsSync(dir))
        return [];
    return fs_1.default
        .readdirSync(dir)
        .filter((f) => f.startsWith("SPEAKER_") && f.endsWith(".wav"))
        .sort();
}
async function loadSample(id, maxDurationSec) {
    const dir = getSamplesDir();
    const sampleDir = path_1.default.join(dir, id);
    const transcriptPath = path_1.default.join(sampleDir, "transcript.json");
    if (!fs_1.default.existsSync(transcriptPath)) {
        throw new Error(`No transcript for sample ${id}. Run \`npm run transcribe-samples\` or \`bun run transcribe-samples\` first.`);
    }
    const raw = JSON.parse(fs_1.default.readFileSync(transcriptPath, "utf-8"));
    let transcript = raw.transcript || [];
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
function readWavHeader(file) {
    const buf = fs_1.default.readFileSync(file);
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
