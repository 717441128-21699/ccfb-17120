import { FRAME_HEIGHT, FRAME_WIDTH } from '../config';
import type { ChannelConfig } from '../types';
import type { ColorCalibration } from './calibration';
import { COLOR_FRAGMENT, FINAL_FRAGMENT, MOTION_FRAGMENT, STACK_FRAGMENT, VERTEX_SHADER } from './shaders';

const MAX_HISTORY = 3;
const RING_SIZE = 4;
const BLOCK = 8;
const ENCODE_RANGE = 8;

export interface ProcessOptions {
  calibration: ColorCalibration;
  channel: ChannelConfig;
  temporalFrames: number;
  motionRange: number;
  denoiseStrength: number;
  colorCorrection: boolean;
  flatField: number;
  sharpen: number;
  showMotionVectors: boolean;
}

interface TextureTarget {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

interface ChannelGLState {
  input: WebGLTexture;
  ring: TextureTarget[];
  write: number;
  frames: number;
}

type UniformMap = Record<string, WebGLUniformLocation | null>;

interface ProgramInfo {
  program: WebGLProgram;
  uniforms: UniformMap;
}

export class WebGLStackRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private readonly channels = new Map<string, ChannelGLState>();
  private readonly mvTargets: TextureTarget[] = [];
  private readonly stackTarget: TextureTarget;
  private readonly color: ProgramInfo;
  private readonly motion: ProgramInfo;
  private readonly stack: ProgramInfo;
  private readonly final: ProgramInfo;
  private readonly vao: WebGLVertexArrayObject;
  private readonly bottomPixels: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  private readonly mvWidth: number;
  private readonly mvHeight: number;

  static isSupported(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor(width = FRAME_WIDTH, height = FRAME_HEIGHT) {
    this.width = width;
    this.height = height;
    this.mvWidth = Math.ceil(width / BLOCK);
    this.mvHeight = Math.ceil(height / BLOCK);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('当前浏览器或预览环境未提供 WebGL2');
    this.gl = gl;
    this.bottomPixels = new Uint8Array(width * height * 4);

    this.color = this.createProgram(VERTEX_SHADER, COLOR_FRAGMENT);
    this.motion = this.createProgram(VERTEX_SHADER, MOTION_FRAGMENT);
    this.stack = this.createProgram(VERTEX_SHADER, STACK_FRAGMENT);
    this.final = this.createProgram(VERTEX_SHADER, FINAL_FRAGMENT);
    this.vao = this.createQuad();

    for (let i = 0; i < MAX_HISTORY; i++) {
      this.mvTargets.push(this.createTarget(this.mvWidth, this.mvHeight, gl.LINEAR));
    }
    this.stackTarget = this.createTarget(width, height, gl.LINEAR);
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('无法创建 WebGL shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader 编译失败: ${log ?? 'unknown error'}\n${source}`);
    }
    return shader;
  }

  private createProgram(vertexSource: string, fragmentSource: string): ProgramInfo {
    const gl = this.gl;
    const vertex = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('无法创建 WebGL program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL program 链接失败: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    const uniforms: UniformMap = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const baseName = info.name.replace(/\[0\]$/, '');
      if (info.name.endsWith('[0]')) {
        uniforms[`${baseName}[0]`] = gl.getUniformLocation(program, `${baseName}[0]`);
      } else {
        uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
    }
    return { program, uniforms };
  }

  private createQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('无法创建 VAO');
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Oversized triangle covers the framebuffer.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const info of [this.color, this.motion, this.stack, this.final]) {
      const loc = gl.getAttribLocation(info.program, 'aPosition');
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    return vao;
  }

  private createTarget(width: number, height: number, filter: number): TextureTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error('无法创建 WebGL 渲染目标');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`WebGL framebuffer 不完整: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, fbo, width, height };
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('无法创建纹理');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private ensureChannel(channelId: string): ChannelGLState {
    const existing = this.channels.get(channelId);
    if (existing) return existing;
    const ring = Array.from({ length: RING_SIZE }, () => this.createTarget(this.width, this.height, this.gl.LINEAR));
    const state: ChannelGLState = {
      input: this.createTexture(),
      ring,
      write: 0,
      frames: 0,
    };
    this.channels.set(channelId, state);
    return state;
  }

  private u(info: ProgramInfo, name: string): WebGLUniformLocation | null {
    return info.uniforms[name] ?? null;
  }

  process(channelId: string, source: TexImageSource, options: ProcessOptions): Uint8ClampedArray {
    const gl = this.gl;
    const state = this.ensureChannel(channelId);
    const cal = options.calibration;

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // 1. Upload raw night-camera frame.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.input);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // 2. Color/flat-field correction into this channel's ring slot.
    const current = state.ring[state.write];
    gl.bindFramebuffer(gl.FRAMEBUFFER, current.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.color.program);
    gl.uniform1i(this.u(this.color, 'uRaw'), 0);
    gl.uniform1i(this.u(this.color, 'uColorEnabled'), options.colorCorrection ? 1 : 0);
    gl.uniform3fv(this.u(this.color, 'uOffset'), cal.offset);
    gl.uniform3fv(this.u(this.color, 'uGain'), cal.gain);
    gl.uniform3fv(this.u(this.color, 'uRow0'), cal.rows[0]);
    gl.uniform3fv(this.u(this.color, 'uRow1'), cal.rows[1]);
    gl.uniform3fv(this.u(this.color, 'uRow2'), cal.rows[2]);
    gl.uniform1f(this.u(this.color, 'uExposure'), cal.exposure);
    gl.uniform1f(this.u(this.color, 'uGamma'), cal.gamma);
    gl.uniform1f(this.u(this.color, 'uIrPseudo'), cal.irPseudo);
    gl.uniform1f(this.u(this.color, 'uFlatStrength'), options.flatField);
    gl.uniform1f(this.u(this.color, 'uFlatRef'), cal.flatRef);
    gl.uniform2f(this.u(this.color, 'uLamp'), options.channel.lamp.x, options.channel.lamp.y);
    gl.uniform1f(this.u(this.color, 'uLampRadius'), options.channel.lamp.radius);
    gl.uniform1f(this.u(this.color, 'uAmbient'), options.channel.lamp.ambient);
    gl.uniform1f(this.u(this.color, 'uPeak'), options.channel.lamp.peak);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const requestedFrames = Math.max(1, Math.min(RING_SIZE, Math.round(options.temporalFrames)));
    const historyCount = Math.min(MAX_HISTORY, requestedFrames - 1, state.frames);

    // 3. One local block-motion search. Slow crawling lets the stack shader
    // scale this vector for the two older frames without two extra full searches.
    gl.useProgram(this.motion.program);
    gl.uniform2f(this.u(this.motion, 'uResolution'), this.width, this.height);
    gl.uniform1f(this.u(this.motion, 'uRange'), Math.min(4, options.motionRange));
    gl.uniform1f(this.u(this.motion, 'uEncodeRange'), ENCODE_RANGE);

    const mv = this.mvTargets[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, mv.fbo);
    gl.viewport(0, 0, this.mvWidth, this.mvHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.texture);
    gl.uniform1i(this.u(this.motion, 'uCurrent'), 0);
    const previousIndex = (state.write - 1 + RING_SIZE * 2) % RING_SIZE;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, historyCount >= 1 ? state.ring[previousIndex].texture : current.texture);
    gl.uniform1i(this.u(this.motion, 'uHistory'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Motion-compensated robust temporal stack.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stackTarget.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.stack.program);
    gl.uniform1i(this.u(this.stack, 'uCurrent'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.texture);

    for (let age = 1; age <= MAX_HISTORY; age++) {
      const histUniform = `uHist${age - 1}`;
      const histUnit = age; // 1,2,3
      const histIndex = (state.write - age + RING_SIZE * 2) % RING_SIZE;
      const hasHistory = age <= historyCount;
      gl.activeTexture(gl.TEXTURE0 + histUnit);
      gl.bindTexture(gl.TEXTURE_2D, hasHistory ? state.ring[histIndex].texture : current.texture);
      gl.uniform1i(this.u(this.stack, histUniform), histUnit);
    }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.mvTargets[0].texture);
    gl.uniform1i(this.u(this.stack, 'uMv'), 4);

    gl.uniform1i(this.u(this.stack, 'uFrames'), historyCount + 1);
    gl.uniform1f(this.u(this.stack, 'uEncodeRange'), ENCODE_RANGE);
    gl.uniform1f(this.u(this.stack, 'uStrength'), 0.34 + options.denoiseStrength * 0.56);
    gl.uniform1f(this.u(this.stack, 'uSigma'), cal.sigma);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 5. Unsharp masking / optional motion-vector overlay.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.final.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stackTarget.texture);
    gl.uniform1i(this.u(this.final, 'uTexture'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mvTargets[0].texture);
    gl.uniform1i(this.u(this.final, 'uMv'), 1);
    gl.uniform2f(this.u(this.final, 'uResolution'), this.width, this.height);
    gl.uniform1f(this.u(this.final, 'uSharpen'), options.sharpen);
    gl.uniform1f(this.u(this.final, 'uDenoise'), 0.25 + options.denoiseStrength * 0.5);
    gl.uniform1f(this.u(this.final, 'uShowMv'), options.showMotionVectors ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bottomPixels);
    const topDown = new Uint8ClampedArray(this.width * this.height * 4);
    const rowBytes = this.width * 4;
    for (let y = 0; y < this.height; y++) {
      const srcStart = y * rowBytes;
      const destStart = (this.height - 1 - y) * rowBytes;
      topDown.set(this.bottomPixels.subarray(srcStart, srcStart + rowBytes), destStart);
    }

    state.write = (state.write + 1) % RING_SIZE;
    state.frames++;
    return topDown;
  }

  dispose(): void {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
