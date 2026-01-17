
import {LitElement, css, html} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {Analyser} from './analyser';

@customElement('gdm-live-audio-visuals-2d')
export class GdmLiveAudioVisuals2D extends LitElement {
  @property({ type: Boolean }) isActive = false;
  @property({ type: Boolean }) isDarkMode = false;
  
  private _inputNode?: AudioNode;
  private _outputNode?: AudioNode;
  private inputAnalyser?: Analyser;
  private outputAnalyser?: Analyser;
  
  @query('canvas') canvas!: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private animationFrame?: number;

  // Smoothed values for animation
  private smoothedInputEnergy = 0;
  private smoothedOutputEnergy = 0;
  private colorTransition = 0; // 0: Idle, 1: Responding, -1: Listening

  @property()
  set inputNode(node: AudioNode | undefined) {
    this._inputNode = node;
    if (node) this.inputAnalyser = new Analyser(node);
  }

  @property()
  set outputNode(node: AudioNode | undefined) {
    this._outputNode = node;
    if (node) this.outputAnalyser = new Analyser(node);
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      user-select: none;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    canvas {
      width: 100%;
      height: 100%;
      filter: drop-shadow(0 2px 8px rgba(0,0,0,0.1));
    }
  `;

  firstUpdated() {
    this.ctx = this.canvas.getContext('2d')!;
    this.renderVisuals();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
  }

  private lerp(start: number, end: number, amt: number) {
    return (1 - amt) * start + amt * end;
  }

  private renderVisuals() {
    this.animationFrame = requestAnimationFrame(() => this.renderVisuals());
    if (!this.ctx) return;

    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    // Base radius scaled to canvas size (45px container)
    const baseRadius = width * 0.35;

    this.inputAnalyser?.update();
    this.outputAnalyser?.update();

    const inputData = this.inputAnalyser?.data || new Uint8Array(32);
    const outputData = this.outputAnalyser?.data || new Uint8Array(32);

    const inputEnergy = inputData.reduce((a, b) => a + b, 0) / (inputData.length * 255);
    const outputEnergy = outputData.reduce((a, b) => a + b, 0) / (outputData.length * 255);

    this.smoothedInputEnergy = this.lerp(this.smoothedInputEnergy, inputEnergy, 0.15);
    this.smoothedOutputEnergy = this.lerp(this.smoothedOutputEnergy, outputEnergy, 0.15);

    let targetTransition = 0; 
    if (this.smoothedOutputEnergy > 0.02) targetTransition = 1; 
    else if (this.isActive) targetTransition = -1; 
    
    this.colorTransition = this.lerp(this.colorTransition, targetTransition, 0.1);

    const time = performance.now() / 1000;
    const floatY = Math.sin(time * 1.5) * 2;
    const floatX = Math.cos(time * 1.2) * 1;
    const breathe = Math.sin(time * 2.5) * 1.5;
    const radius = baseRadius + breathe + (this.smoothedOutputEnergy * (width * 0.25)) + (this.smoothedInputEnergy * (width * 0.1));

    this.ctx.save();
    this.ctx.translate(floatX, floatY);

    const glowRadius = radius * 1.6;
    const gradient = this.ctx.createRadialGradient(centerX, centerY, radius * 0.4, centerX, centerY, glowRadius);
    
    let idleColorStart = this.isDarkMode ? { r: 80, g: 84, b: 87, a: 0.4 } : { r: 218, g: 220, b: 224, a: 0.5 };
    let idleColorEnd = { r: 0, g: 0, b: 0, a: 0 };

    let glowColorStart = { ...idleColorStart };
    let glowColorEnd = { ...idleColorEnd };

    if (this.colorTransition > 0) {
      const t = this.colorTransition;
      glowColorStart = {
        r: this.lerp(idleColorStart.r, 66, t),
        g: this.lerp(idleColorStart.g, 133, t),
        b: this.lerp(idleColorStart.b, 244, t),
        a: this.lerp(idleColorStart.a, 0.8, t)
      };
      glowColorEnd = { r: 161, g: 66, b: 244, a: 0 };
    } else if (this.colorTransition < 0) {
      const t = Math.abs(this.colorTransition);
      glowColorStart = {
        r: this.lerp(idleColorStart.r, 234, t),
        g: this.lerp(idleColorStart.g, 67, t),
        b: this.lerp(idleColorStart.b, 53, t),
        a: this.lerp(idleColorStart.a, 0.8, t)
      };
      glowColorEnd = { r: 251, g: 188, b: 5, a: 0 };
    }

    gradient.addColorStop(0, `rgba(${glowColorStart.r}, ${glowColorStart.g}, ${glowColorStart.b}, ${glowColorStart.a})`);
    gradient.addColorStop(0.5, `rgba(${glowColorStart.r}, ${glowColorStart.g}, ${glowColorStart.b}, ${glowColorStart.a * 0.4})`);
    gradient.addColorStop(1, `rgba(${glowColorEnd.r}, ${glowColorEnd.g}, ${glowColorEnd.b}, 0)`);

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
    this.ctx.fill();

    const coreGrad = this.ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
    
    let coreColor1 = this.isDarkMode ? { r: 50, g: 52, b: 54 } : { r: 228, g: 230, b: 234 };
    let coreColor2 = this.isDarkMode ? { r: 30, g: 31, b: 32 } : { r: 164, g: 170, b: 176 };

    if (this.colorTransition > 0) {
      const t = this.colorTransition;
      coreColor1 = { r: this.lerp(coreColor1.r, 66, t), g: this.lerp(coreColor1.g, 133, t), b: this.lerp(coreColor1.b, 244, t) };
      coreColor2 = { r: this.lerp(coreColor2.r, 161, t), g: this.lerp(coreColor2.g, 66, t), b: this.lerp(coreColor2.b, 244, t) };
    } else if (this.colorTransition < 0) {
      const t = Math.abs(this.colorTransition);
      coreColor1 = { r: this.lerp(coreColor1.r, 234, t), g: this.lerp(coreColor1.g, 67, t), b: this.lerp(coreColor1.b, 53, t) };
      coreColor2 = { r: this.lerp(coreColor2.r, 251, t), g: this.lerp(coreColor2.g, 188, t), b: this.lerp(coreColor2.b, 5, t) };
    }

    coreGrad.addColorStop(0, `rgb(${coreColor1.r}, ${coreColor1.g}, ${coreColor1.b})`);
    coreGrad.addColorStop(1, `rgb(${coreColor2.r}, ${coreColor2.g}, ${coreColor2.b})`);

    this.ctx.fillStyle = coreGrad;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.ctx.fill();

    const sheenGrad = this.ctx.createRadialGradient(centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.1, centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.8);
    sheenGrad.addColorStop(0, this.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.4)');
    sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    this.ctx.fillStyle = sheenGrad;
    this.ctx.fill();

    this.ctx.restore();
  }

  render() {
    return html`<canvas width="100" height="100"></canvas>`;
  }
}
