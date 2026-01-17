
/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality} from '@google/genai';
import {LitElement, css, html, PropertyValues} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-2d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() orbPos = { x: window.innerWidth / 2 - 75, y: window.innerHeight / 2 - 150 };
  @state() isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  @state() private isDragging = false;

  private ai: GoogleGenAI;
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

  private dragOffset = { x: 0, y: 0 };

  static styles = css`
    :host {
      --bg-gradient: radial-gradient(circle at 50% 50%, #ffffff 0%, #f1f3f4 100%);
      --text-color: #202124;
      --control-bg: rgba(255, 255, 255, 0.85);
      --control-border: rgba(0, 0, 0, 0.08);
      --control-shadow: 0 8px 32px rgba(0,0,0,0.06);
      --icon-color: #5f6368;
      --status-color: #5f6368;
      
      display: block;
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
      gap: 12px;
      padding: 8px 16px;
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
        width: 44px;
        height: 44px;

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
          width: 24px;
          height: 24px;
        }
      }

      button#startButton {
        background: #ea4335;
        width: 48px;
        height: 48px;
        box-shadow: 0 4px 12px rgba(234, 67, 53, 0.3);
        svg { fill: white; }
        &:hover { 
          background: #d93025; 
          box-shadow: 0 6px 16px rgba(234, 67, 53, 0.4);
        }
      }

      button#stopButton {
        background: #202124;
        width: 48px;
        height: 48px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        svg { fill: white; }
        &:hover { background: #000; }
      }

      .divider {
        width: 1px;
        height: 24px;
        background: var(--control-border);
        margin: 0 4px;
      }
    }

    .draggable-orb {
      position: absolute;
      cursor: grab;
      touch-action: none;
      z-index: 50;
      user-select: none;
      transition: transform 0.05s linear;
    }

    .draggable-orb.dragging {
      cursor: grabbing;
      transition: transform 0s;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  // Fix: Use PropertyValues type and call super.updated.
  // Cast this to HTMLElement to access setAttribute/removeAttribute to avoid TS errors.
  updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);
    if (changedProperties.has('isDarkMode')) {
      if (this.isDarkMode) {
        (this as unknown as HTMLElement).setAttribute('dark', '');
      } else {
        (this as unknown as HTMLElement).removeAttribute('dark');
      }
    }
  }

  private toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.outputNode.connect(this.outputAudioContext.destination);
    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    try {
      this.sessionPromise = this.ai.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Connected to Gemini');
          },
          onmessage: async (message: LiveServerMessage) => {
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

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                try { source.stop(); } catch(e) {}
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
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
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Puck'}},
          },
          systemInstruction: 'You are a friendly, helpful AI orb. Keep responses concise and engaging.',
        },
      });
      this.session = await this.sessionPromise;
    } catch (e) {
      console.error('Session init failed:', e);
      this.updateError('Failed to connect to Gemini');
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
      const bufferSize = 2048;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const pcmData = e.inputBuffer.getChannelData(0);
        this.sessionPromise?.then((session) => {
          session.sendRealtimeInput({ media: createBlob(pcmData) });
        });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
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
    this.updateStatus('Stopped');
  }

  private reset() {
    this.stopRecording();
    this.session?.close();
    this.initSession();
    this.updateStatus('Session reset');
  }

  private handlePointerDown(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    this.isDragging = true;
    this.dragOffset = {
      x: e.clientX - this.orbPos.x,
      y: e.clientY - this.orbPos.y
    };
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.isDragging) return;
    this.orbPos = {
      x: e.clientX - this.dragOffset.x,
      y: e.clientY - this.dragOffset.y
    };
  }

  private handlePointerUp(e: PointerEvent) {
    this.isDragging = false;
  }

  render() {
    return html`
      <div 
        class="draggable-orb ${this.isDragging ? 'dragging' : ''}"
        style="transform: translate(${this.orbPos.x}px, ${this.orbPos.y}px)"
        @pointerdown=${this.handlePointerDown}
        @pointermove=${this.handlePointerMove}
        @pointerup=${this.handlePointerUp}
      >
        <gdm-live-audio-visuals-2d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}
          .isActive=${this.isRecording}
          .isDarkMode=${this.isDarkMode}
        ></gdm-live-audio-visuals-2d>
      </div>

      <div class="controls">
        <button @click=${this.toggleDarkMode} title="Toggle Theme">
          ${this.isDarkMode ? html`
            <svg viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
          ` : html`
            <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
          `}
        </button>

        <div class="divider"></div>

        <button id="resetButton" title="Reset Session" @click=${this.reset}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
            <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
          </svg>
        </button>
        
        ${!this.isRecording ? html`
          <button id="startButton" title="Start Listening" @click=${this.startRecording}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
              <path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm40-400q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-520Z"/>
            </svg>
          </button>
        ` : html`
          <button id="stopButton" title="Stop Listening" @click=${this.stopRecording}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
              <path d="M320-320h320v-320H320v320ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
            </svg>
          </button>
        `}
      </div>

      <div id="status">
        ${this.error ? html`<span style="color: #ea4335; font-weight: 600;">${this.error}</span>` : this.status}
      </div>
    `;
  }
}
