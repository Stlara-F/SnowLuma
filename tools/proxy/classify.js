import { CFG, log } from './config.js';

export const CLASS_ULTRA_REPETITIVE = 'ultra-repetitive';
export const CLASS_STATIC_RECORDING = 'static-recording';
export const CLASS_COMPRESSIBLE = 'compressible';
export const CLASS_ALREADY_COMPRESSED = 'already-compressed';

export function classifyContent(probeData, sceneData, fileSize, durationSec) {
  const vStream = (probeData.streams || []).find(s => s.codec_type === 'video');
  if (!vStream) return CLASS_ALREADY_COMPRESSED;

  const width = vStream.width || 0;
  const height = vStream.height || 0;
  const resolution = width * height;

  const fpsParts = (vStream.r_frame_rate || '30/1').split('/');
  const fps = parseInt(fpsParts[0], 10) / (parseInt(fpsParts[1], 10) || 1);

  const fmt = probeData.format || {};
  const totalBitrate = fmt.bit_rate
    ? parseInt(fmt.bit_rate, 10)
    : Math.round(fileSize * 8 / Math.max(durationSec, 1));

  const sampleFrames = parseInt(vStream.nb_read_frames || '0', 10);
  const expectedFrames = Math.round(fps * CFG.probeSampleSeconds);

  if (sceneData.sceneChanges >= 0 && sampleFrames > 0 && expectedFrames > 0) {
    const changeRatio = sceneData.sceneChanges / expectedFrames;
    if (changeRatio < 0.01) {
      log('CLASSIFY', 'ultra-repetitive (change_ratio=%.4f)', changeRatio);
      return CLASS_ULTRA_REPETITIVE;
    }
    if (changeRatio < 0.05) {
      log('CLASSIFY', 'static-recording (change_ratio=%.4f)', changeRatio);
      return CLASS_STATIC_RECORDING;
    }
  }

  if (totalBitrate > 0 && totalBitrate < 500000 && resolution <= 640 * 360) {
    log('CLASSIFY', 'already-compressed (bitrate=%d, res=%dx%d)', totalBitrate, width, height);
    return CLASS_ALREADY_COMPRESSED;
  }

  if (resolution > 0) {
    log('CLASSIFY', 'compressible (bitrate=%d, res=%dx%d)', totalBitrate, width, height);
    return CLASS_COMPRESSIBLE;
  }

  return CLASS_ALREADY_COMPRESSED;
}
