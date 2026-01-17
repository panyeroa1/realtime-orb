
/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality} from '@google/genai';
import {LitElement, css, html, PropertyValues} from 'lit';
import {customElement, state, query} from 'lit/decorators.js';
import {createClient} from '@supabase/supabase-js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-2d';

const SUPABASE_URL = 'https://xscdwdnjujpkczfhqrgu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzY2R3ZG5qdWpwa2N6Zmhxcmd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzMzEwNjgsImV4cCI6MjA3NjkwNzA2OH0.xuVAkWA5y1oDW_jC52I8JJXF-ovU-5LIBsY9yXzy6cA';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEFAULT_PERSONA = `You are Miles — warm, upbeat, and neighborly (Sesame-inspired).
* Mission: Help fast, kindly, and clearly. Sound naturally human in each language.

## Core Voice (unchanged, now multilingual-aware)
* Texture: Soft, breathable; smiles you can “hear.”
* Expressions (sparingly, ~1 per 1–2 sentences): [breathes], [exhales softly], [soft chuckle], [giggles], ahhmm, uhm, mm-hmm, yup, [whistles softly].
* Never place expressions in the same sentence as numbers, dates, addresses, or sensitive topics.

---

## Multilingual Native-Like Shifting — Rules & Patterns

### A) Detect → Mirror → Maintain
1. Detect language from the user’s last message.
2. Mirror language and match register (casual/formal) and regional cues.
3. Maintain the chosen language until the user switches or asks for another.

### B) Register & Politeness
* Casual: Use light fillers and friendly particles. Short sentences.
* Formal/Respectful: Drop playful tags (no laughs/whistles), add honorifics/politeness markers, slower pacing.

### C) Language-Specific Cues (use modestly)
* Filipino/Tagalog (PH): particles po/opo (respect), sige, ayos, tara, salamat. Fillers: ahm, mm-hmm, oo/opo.
* English (US): yup, sure, got it, light [soft chuckle].
* Spanish (LatAm/ES): claro, vale, listo, gracias, ¿te parece?
* French: d’accord, bien sûr, merci, on y va.
* Japanese (polite default): はい, 承知しました, ありがとうございます.

### D) Turn Mechanics
1. Empathize in the user’s language (1 short line).
2. Answer directly first (1–2 sentences).
3. Optional tiny extra (one tip/example).
4. Close with one question to confirm next step, in the same language/register.`;

const VOICE_MAP = [
  { name: 'Orus (New Default)', value: 'Orus' },
  { name: 'Aoede (Expressive)', value: 'Aoede' },
  { name: 'Charon (Calm)', value: 'Charon' },
  { name: 'Fenrir (Deep)', value: 'Fenrir' },
  { name: 'Kore (Neutral)', value: 'Kore' },
  { name: 'Puck (Energetic)', value: 'Puck' },
];

interface TranscriptionSegment {
  text: string;
  type: 'user' | 'agent';
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isMicMuted = false;
  @state() isSpeakerMuted = false;
  @state() status = '';
  @state() error = '';
  @state() isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  @state() isSettingsOpen = false;
  @state() systemPrompt = DEFAULT_PERSONA;
  @state() selectedVoice = 'Orus';
  @state() transcriptionHistory: TranscriptionSegment[] = [];
  @state() currentTurnSegments: TranscriptionSegment[] = [];

  @query('textarea') private textarea!: HTMLTextAreaElement;
  @query('select') private select!: HTMLSelectElement;
  @query('.transcription-container') private transcriptionContainer!: HTMLElement;

  private sessionPromise: Promise<any> | null = null;
  private session: any = null;

  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      --bg-gradient: radial-gradient(circle at 50% 50%, #ffffff 0%, #f1f3f4 100%);
      --text-color: #202124;
      --control-bg: rgba(255, 255, 255, 0.85);
      --control-border: rgba(0, 0, 0, 0.08);
      --control-shadow: 0 8px 32px rgba(0,0,0,0.06);
      --icon-color: #5f6368;
      --status-color: #5f6368;
      --accent-color: #4285f4;
      --modal-bg: rgba(255, 255, 255, 0.95);
      --danger-color: #ea4335;
      --user-text-color: #8b5cf6;
      --agent-text-color: var(--accent-color);
      
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      background: var(--bg-gradient);
      color: var(--text-color);
      font-family: 'Google Sans', Arial, sans-serif;
      overflow: hidden;
      position: relative;
      transition: background 0.5s ease;
    }

    :host([dark]) {
      --bg-gradient: radial-gradient(circle at 50% 50%, #1a1c1e 0%, #0a0b0c 100%);
      --text-color: #e8eaed;
      --control-bg: rgba(32, 33, 36, 0.85);
      --control-border: rgba(255, 255, 255, 0.1);
      --control-shadow: 0 8px 32px rgba(0,0,0,0.4);
      --icon-color: #bdc1c6;
      --status-color: #9aa0a6;
      --accent-color: #8ab4f8;
      --modal-bg: rgba(32, 33, 36, 0.98);
      --danger-color: #f28b82;
      --user-text-color: #a78bfa;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      z-index: 100;
    }

    .header-left h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 500;
      background: linear-gradient(90deg, var(--accent-color), #a142f4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .orb-container {
      width: 45px;
      height: 45px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    gdm-live-audio-visuals-2d {
      width: 100%;
      height: 100%;
    }

    .transcription-viewport {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
      overflow: hidden;
    }

    .transcription-container {
      max-width: 800px;
      width: 100%;
      font-size: 1.75rem;
      line-height: 1.4;
      font-weight: 400;
      color: var(--text-color);
      overflow-y: auto;
      max-height: 70vh;
      scrollbar-width: none;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .transcription-container::-webkit-scrollbar {
      display: none;
    }

    .segment {
      display: inline;
    }

    .segment-user {
      color: var(--user-text-color);
    }

    .segment-agent {
      color: var(--agent-text-color);
    }

    .transcription-word {
      display: inline-block;
      margin-right: 0.25em;
      animation: word-fade-in 0.3s ease-out forwards;
      opacity: 0;
      transform: translateY(4px);
    }

    @keyframes word-fade-in {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    #status {
      position: absolute;
      bottom: 24px;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      font-size: 14px;
      color: var(--status-color);
      font-weight: 500;
      letter-spacing: 0.2px;
      pointer-events: none;
      opacity: 0.8;
      transition: opacity 0.3s, color 0.3s;
    }

    .controls {
      z-index: 100;
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 14px;
      background: var(--control-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 40px;
      box-shadow: var(--control-shadow);
      border: 1px solid var(--control-border);
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);

      button {
        outline: none;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 50%;
        width: 40px;
        height: 40px;

        &:hover {
          background: rgba(128, 128, 128, 0.1);
          transform: translateY(-1px);
        }

        &:active {
          background: rgba(128, 128, 128, 0.2);
          transform: translateY(0) scale(0.92);
        }

        svg {
          fill: var(--icon-color);
          width: 20px;
          height: 20px;
        }

        &.muted svg {
          fill: var(--danger-color);
        }
      }

      button#startButton {
        background: var(--accent-color);
        width: 44px;
        height: 44px;
        box-shadow: 0 4px 12px rgba(66, 133, 244, 0.3);
        svg { fill: white; width: 24px; height: 24px; }
        &:hover { 
          box-shadow: 0 6px 16px rgba(66, 133, 244, 0.4);
        }
      }

      button#stopButton {
        background: #202124;
        width: 44px;
        height: 44px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        svg { fill: white; }
        &:hover { background: #000; }
      }

      .divider {
        width: 1px;
        height: 20px;
        background: var(--control-border);
        margin: 0 4px;
      }
    }

    .settings-modal {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
      animation: fadeIn 0.3s ease;
    }

    .settings-content {
      background: var(--modal-bg);
      width: 90%;
      max-width: 500px;
      max-height: 85vh;
      overflow-y: auto;
      padding: 32px;
      border-radius: 24px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.2);
      border: 1px solid var(--control-border);
      display: flex;
      flex-direction: column;
      gap: 20px;
      animation: slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    label {
      font-size: 13px;
      font-weight: 500;
      color: var(--status-color);
    }

    textarea, select {
      padding: 12px;
      border-radius: 12px;
      border: 1px solid var(--control-border);
      background: rgba(128, 128, 128, 0.05);
      color: var(--text-color);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    textarea:focus, select:focus {
      border-color: var(--accent-color);
    }

    textarea {
      height: 300px;
      resize: vertical;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 8px;
      position: sticky;
      bottom: -32px;
      background: var(--modal-bg);
      padding: 16px 0;
      margin-bottom: -32px;
      border-bottom-left-radius: 24px;
      border-bottom-right-radius: 24px;
    }

    .btn-save {
      background: var(--accent-color);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .btn-cancel {
      background: transparent;
      color: var(--status-color);
      border: 1px solid var(--control-border);
      padding: 10px 20px;
      border-radius: 12px;
      font-weight: 500;
      cursor: pointer;
    }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `;

  constructor() {
    super();
    this.initSupabase();
    this.initClient();
  }

  async initSupabase() {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 'user-config')
        .single();
      
      if (data && !error) {
        this.systemPrompt = data.system_prompt || DEFAULT_PERSONA;
        this.selectedVoice = data.selected_voice || 'Orus';
        this.reset();
      }
    } catch (err) {
      console.warn('Could not load settings from Supabase, using local defaults.');
    }
  }

  updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);
    if (changedProperties.has('isDarkMode')) {
      if (this.isDarkMode) {
        (this as unknown as HTMLElement).setAttribute('dark', '');
      } else {
        (this as unknown as HTMLElement).removeAttribute('dark');
      }
    }
    if ((changedProperties.has('currentTurnSegments') || changedProperties.has('transcriptionHistory')) && this.transcriptionContainer) {
      this.transcriptionContainer.scrollTop = this.transcriptionContainer.scrollHeight;
    }
  }

  private toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
  }

  private toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    this.inputNode.gain.setValueAtTime(this.isMicMuted ? 0 : 1, this.inputAudioContext.currentTime);
  }

  private toggleSpeaker() {
    this.isSpeakerMuted = !this.isSpeakerMuted;
    this.outputNode.gain.setValueAtTime(this.isSpeakerMuted ? 0 : 1, this.outputAudioContext.currentTime);
  }

  private toggleSettings() {
    this.isSettingsOpen = !this.isSettingsOpen;
  }

  private async saveSettings() {
    const prompt = this.textarea?.value || DEFAULT_PERSONA;
    const voice = this.select?.value || 'Orus';
    
    this.systemPrompt = prompt;
    this.selectedVoice = voice;
    this.isSettingsOpen = false;

    try {
      await supabase
        .from('settings')
        .upsert({ 
          id: 'user-config', 
          system_prompt: prompt, 
          selected_voice: voice 
        });
    } catch (err) {
      console.error('Error persisting to Supabase:', err);
    }

    this.reset();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
    this.inputNode.gain.setValueAtTime(this.isMicMuted ? 0 : 1, this.inputAudioContext.currentTime);
    this.outputNode.gain.setValueAtTime(this.isSpeakerMuted ? 0 : 1, this.outputAudioContext.currentTime);
  }

  private async initClient() {
    this.initAudio();
    this.outputNode.connect(this.outputAudioContext.destination);
    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      this.sessionPromise = ai.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Connected to Gemini');
          },
          onmessage: async (message: LiveServerMessage) => {
            // Audio output
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
              const audioBuffer = await decodeAudioData(decode(audio.data), this.outputAudioContext, 24000, 1);
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            // Transcription
            if (message.serverContent?.outputTranscription) {
              this.appendToTranscription(message.serverContent.outputTranscription.text, 'agent');
            } else if (message.serverContent?.inputTranscription) {
              this.appendToTranscription(message.serverContent.inputTranscription.text, 'user');
            }

            if (message.serverContent?.turnComplete) {
              this.transcriptionHistory = [...this.transcriptionHistory, ...this.currentTurnSegments];
              this.currentTurnSegments = [];
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                try { source.stop(); } catch(e) {}
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
              this.currentTurnSegments = [];
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message || 'API Error');
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session closed');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: this.selectedVoice as any}},
          },
          systemInstruction: this.systemPrompt,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      });
      this.session = await this.sessionPromise;
    } catch (e) {
      console.error('Session init failed:', e);
      this.updateError('Failed to connect to Gemini');
    }
  }

  private appendToTranscription(text: string, type: 'user' | 'agent') {
    const lastSegment = this.currentTurnSegments[this.currentTurnSegments.length - 1];
    if (lastSegment && lastSegment.type === type) {
      // Create new array with updated last segment to trigger Lit's state update
      const newSegments = [...this.currentTurnSegments];
      newSegments[newSegments.length - 1] = {
        ...lastSegment,
        text: lastSegment.text + text
      };
      this.currentTurnSegments = newSegments;
    } else {
      this.currentTurnSegments = [...this.currentTurnSegments, { text, type }];
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = '';
  }

  private async startRecording() {
    if (this.isRecording) return;
    try {
      if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);
      
      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const pcmData = e.inputBuffer.getChannelData(0);
        this.sessionPromise?.then((session) => {
          session.sendRealtimeInput({ media: createBlob(pcmData) });
        });
      };
      
      this.inputNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      
      this.isRecording = true;
      this.updateStatus('Listening...');
    } catch (err) {
      console.error('Recording error:', err);
      this.updateError('Microphone access denied');
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    try { this.inputNode.disconnect(); } catch(e) {}
    this.updateStatus('Stopped');
  }

  private reset() {
    this.stopRecording();
    this.session?.close();
    this.initSession();
    this.updateStatus('Session reset');
  }

  render() {
    const allSegments = [...this.transcriptionHistory, ...this.currentTurnSegments];

    return html`
      <header>
        <div class="header-left">
          <h1>Miles Neighborly</h1>
        </div>
        <div class="header-right">
          <div class="orb-container">
            <gdm-live-audio-visuals-2d
              .inputNode=${this.inputNode}
              .outputNode=${this.outputNode}
              .isActive=${this.isRecording}
              .isDarkMode=${this.isDarkMode}
            ></gdm-live-audio-visuals-2d>
          </div>
        </div>
      </header>

      <div class="transcription-viewport">
        <div class="transcription-container">
          ${allSegments.map((segment) => {
            const words = segment.text.split(' ').filter(w => w.length > 0);
            return html`
              <div class="segment segment-${segment.type}">
                ${words.map((word, idx) => html`
                  <span class="transcription-word" style="animation-delay: ${idx * 0.02}s">${word}</span>
                `)}
              </div>
            `;
          })}
        </div>
      </div>

      <div class="controls">
        <button 
          title=${this.isMicMuted ? "Unmute Microphone" : "Mute Microphone"} 
          @click=${this.toggleMic}
          class=${this.isMicMuted ? 'muted' : ''}
          style="opacity: ${this.isRecording ? '1' : '0.4'}"
        >
          ${this.isMicMuted ? html`
            <svg viewBox="0 0 24 24"><path d="M19.73 17.3L18.4 15.97c.36-.61.6-1.28.6-2h-2c0 .4-.1.79-.28 1.14l-1.42-1.42c.42-.4.7-.96.7-1.59v-6c0-1.66-1.34-3-3-3s-3 1.34-3 3v.14L3.7 3.7c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41l16.03 16.03c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41l-1.41-1.41zM9 5c0-1.66 1.34-3 3-3s3 1.34 3 3v6c0 .17-.03.34-.07.5l-5.93-5.93V5zM5 11h2c0 1.34.46 2.57 1.22 3.54L6.78 16c-1.12-1.39-1.78-3.12-1.78-5zM11 17.92v3.08h2v-3.08c3.39-.49 6-3.39 6-6.92h-2c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92z"/></svg>
          ` : html`
            <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          `}
        </button>

        <button 
          title=${this.isSpeakerMuted ? "Unmute Speaker" : "Mute Speaker"} 
          @click=${this.toggleSpeaker}
          class=${this.isSpeakerMuted ? 'muted' : ''}
        >
          ${this.isSpeakerMuted ? html`
            <svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
          ` : html`
            <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          `}
        </button>

        <div class="divider"></div>

        <button @click=${this.toggleDarkMode} title="Toggle Theme">
          ${this.isDarkMode ? html`
            <svg viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L17.3 15.9l1.06 1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
          ` : html`
            <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
          `}
        </button>

        <button id="startButton" title="Connect Orb" @click=${this.startRecording} style="display: ${this.isRecording ? 'none' : 'flex'}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        
        <button id="stopButton" title="Disconnect Orb" @click=${this.stopRecording} style="display: ${this.isRecording ? 'flex' : 'none'}">
          <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
        </button>

        <button @click=${this.toggleSettings} title="Settings">
          <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        </button>
      </div>

      ${this.isSettingsOpen ? html`
        <div class="settings-modal" @click=${this.toggleSettings}>
          <div class="settings-content" @click=${(e: Event) => e.stopPropagation()}>
            <h2>Miles Settings</h2>
            
            <div class="field">
              <label>Persona & Multilingual Rules (System Prompt)</label>
              <textarea placeholder="Describe how Miles should behave..." .value=${this.systemPrompt}></textarea>
            </div>

            <div class="field">
              <label>Gemini Voice</label>
              <select>
                ${VOICE_MAP.map(v => html`
                  <option value="${v.value}" ?selected=${this.selectedVoice === v.value}>${v.name}</option>
                `)}
              </select>
            </div>

            <div class="modal-actions">
              <button class="btn-cancel" @click=${this.toggleSettings}>Cancel</button>
              <button class="btn-save" @click=${this.saveSettings}>Save & Sync</button>
            </div>
          </div>
        </div>
      ` : ''}

      <div id="status">
        ${this.error ? html`<span style="color: #ea4335; font-weight: 600;">${this.error}</span>` : this.status}
      </div>
    `;
  }
}
