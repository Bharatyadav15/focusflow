export type AmbientPreset = 'off' | 'brown' | 'rain' | 'warm';

class AmbientSoundEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioNode | null = null;
  private preset: AmbientPreset = 'off';
  private volume = 0.25;

  getPreset(): AmbientPreset {
    return this.preset;
  }

  setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  stop() {
    if (this.sourceNode) {
      try {
        if ('stop' in this.sourceNode && typeof (this.sourceNode as AudioBufferSourceNode).stop === 'function') {
          (this.sourceNode as AudioBufferSourceNode).stop();
        }
        this.sourceNode.disconnect();
      } catch {
        // Ignore already stopped
      }
      this.sourceNode = null;
    }
    this.preset = 'off';
  }

  start(preset: AmbientPreset) {
    if (preset === 'off') {
      this.stop();
      return;
    }
    this.stop();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const masterGain = this.ctx.createGain();
    masterGain.gain.value = this.volume;
    masterGain.connect(this.ctx.destination);
    this.gainNode = masterGain;

    if (preset === 'warm') {
      // Soft harmonic ambient pad drone
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      osc1.type = 'sine';
      osc1.frequency.value = 110;
      osc2.type = 'triangle';
      osc2.frequency.value = 164.81;
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const padGain = this.ctx.createGain();
      padGain.gain.value = 0.22;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(padGain);
      padGain.connect(masterGain);
      osc1.start();
      osc2.start();
      this.sourceNode = padGain;
      this.preset = preset;
      return;
    }

    // 4-second looping procedural noise buffer (brown noise or filtered rain)
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = sampleRate * 4;
    const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (preset === 'brown') {
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 3.0;
      } else {
        // Gentle rain texture
        data[i] = white * 0.35;
      }
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = preset === 'rain' ? 'bandpass' : 'lowpass';
    filter.frequency.value = preset === 'rain' ? 1100 : 380;
    filter.Q.value = preset === 'rain' ? 0.5 : 0.7;

    noise.connect(filter);
    filter.connect(masterGain);
    noise.start();
    this.sourceNode = noise;
    this.preset = preset;
  }
}

export const ambientEngine = new AmbientSoundEngine();
