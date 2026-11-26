export const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const COLOR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uRaw;
uniform bool uColorEnabled;
uniform vec3 uOffset;
uniform vec3 uGain;
uniform vec3 uRow0;
uniform vec3 uRow1;
uniform vec3 uRow2;
uniform float uExposure;
uniform float uGamma;
uniform float uIrPseudo;
uniform float uFlatStrength;
uniform float uFlatRef;
uniform vec2 uLamp;
uniform float uLampRadius;
uniform float uAmbient;
uniform float uPeak;

float lampIllum(vec2 uv) {
  vec2 d = uv - uLamp;
  float d2 = d.x * d.x + d.y * d.y * 1.15;
  float beam = exp(-d2 / max(0.001, uLampRadius * uLampRadius * 0.72));
  float edge = 0.92 + 0.08 * cos((uv.x - 0.5) * 3.14159265);
  return clamp(uAmbient + (uPeak - uAmbient) * beam * edge, 0.08, 1.45);
}

vec3 irPseudoColor(float y) {
  vec3 shadowBrown = vec3(0.34, 0.235, 0.13);
  vec3 matMid = vec3(0.58, 0.45, 0.29);
  vec3 bodyIvory = vec3(0.82, 0.82, 0.70);
  vec3 matureWarm = vec3(0.96, 0.92, 0.70);
  vec3 c = mix(shadowBrown, matMid, smoothstep(0.10, 0.32, y));
  c = mix(c, bodyIvory, smoothstep(0.32, 0.58, y));
  c = mix(c, matureWarm, smoothstep(0.68, 0.9, y));
  return c;
}

void main() {
  vec3 raw = texture(uRaw, vUv).rgb;
  vec3 c = max(vec3(0.0), raw - uOffset);
  c *= uGain;
  c = vec3(dot(uRow0, c), dot(uRow1, c), dot(uRow2, c));
  c *= uExposure;

  float illum = lampIllum(vUv);
  float flatTarget = clamp(uFlatRef / illum, 0.72, 1.42);
  float flatScale = mix(1.0, flatTarget, clamp(uFlatStrength, 0.0, 1.0));
  c *= flatScale;

  if (uIrPseudo > 0.001) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 pseudo = irPseudoColor(clamp(y, 0.0, 1.0));
    c = mix(c, pseudo, uIrPseudo);
  }

  if (uColorEnabled) {
    c = pow(clamp(c, 0.0, 1.0), vec3(uGamma));
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(luma), c, 1.18);
    c = (c - 0.5) * 1.08 + 0.5;
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export const MOTION_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outMv;

uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform vec2 uResolution;
uniform float uRange;
uniform float uEncodeRange;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float patchCost(vec2 centerPx, vec2 deltaPx) {
  float cost = 0.0;
  // Center plus a compact cross patch. Ring markings make this aperture meaningful.
  for (int k = 0; k < 5; k++) {
    vec2 off;
    if (k == 0) off = vec2(0.0);
    else if (k == 1) off = vec2(2.0, 0.0);
    else if (k == 2) off = vec2(-2.0, 0.0);
    else if (k == 3) off = vec2(0.0, 2.0);
    else off = vec2(0.0, -2.0);

    vec2 aUv = (centerPx + off) / uResolution;
    vec2 bUv = (centerPx + deltaPx + off) / uResolution;
    vec3 a = texture(uCurrent, aUv).rgb;
    vec3 b = texture(uHistory, bUv).rgb;
    vec3 d = abs(a - b);
    cost += d.r + d.g * 1.15 + d.b * 0.75;
    cost += abs(luma(a) - luma(b)) * 1.5;
  }
  return cost;
}

void main() {
  vec2 block = floor(gl_FragCoord.xy);
  vec2 centerPx = (block + 0.5) * 8.0;
  vec2 best = vec2(0.0);
  float bestCost = 1e6;
  float range = floor(clamp(uRange, 1.0, 6.0) + 0.5);

  for (int dy = -6; dy <= 6; dy++) {
    if (abs(float(dy)) > range) continue;
    for (int dx = -6; dx <= 6; dx++) {
      if (abs(float(dx)) > range) continue;
      vec2 d = vec2(float(dx), float(dy));
      float cost = patchCost(centerPx, d);
      // Small-motion prior: resolves blank-aperture ties toward static tray.
      cost += 0.018 * dot(d, d);
      if (cost < bestCost) {
        bestCost = cost;
        best = d;
      }
    }
  }

  vec2 encoded = best / uEncodeRange * 0.5 + 0.5;
  outMv = vec4(clamp(encoded, 0.0, 1.0), bestCost, 1.0);
}
`;

export const STACK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uCurrent;
uniform sampler2D uHist0;
uniform sampler2D uHist1;
uniform sampler2D uHist2;
uniform sampler2D uMv;
uniform int uFrames;
uniform float uEncodeRange;
uniform float uStrength;
uniform float uSigma;

vec2 decodeMv(vec2 uv) {
  vec2 e = texture(uMv, uv).rg * 2.0 - 1.0;
  return e * uEncodeRange;
}

float historyWeight(vec3 cur, vec3 hist, float base) {
  vec3 d = cur - hist;
  float lumaDiff = dot(d, vec3(0.299, 0.587, 0.114));
  float dist2 = dot(d, d) / 3.0 + lumaDiff * lumaDiff * 1.4;
  float w = exp(-dist2 / max(0.012, uSigma * uSigma));
  // Hard rejection for edge/ring pixels where a wrong vector would ghost.
  if (sqrt(dist2) > uSigma * 2.8) w *= 0.08;
  return base * w;
}

void main() {
  vec3 cur = texture(uCurrent, vUv).rgb;
  vec2 mv1 = decodeMv(vUv);
  vec2 pixelSize = vec2(1.0) / vec2(textureSize(uCurrent, 0));
  vec3 acc = cur;
  float sumW = 1.0;

  if (uFrames >= 2) {
    vec2 uv = clamp(vUv + mv1 * pixelSize, vec2(0.002), vec2(0.998));
    vec3 h = texture(uHist0, uv).rgb;
    float w = historyWeight(cur, h, uStrength);
    acc += h * w; sumW += w;
  }
  if (uFrames >= 3) {
    // Larvae crawl slowly; scale the estimated one-frame vector for older frames.
    vec2 uv = clamp(vUv + mv1 * 2.0 * pixelSize, vec2(0.002), vec2(0.998));
    vec3 h = texture(uHist1, uv).rgb;
    float w = historyWeight(cur, h, uStrength * 0.9);
    acc += h * w; sumW += w;
  }
  if (uFrames >= 4) {
    vec2 uv = clamp(vUv + mv1 * 3.0 * pixelSize, vec2(0.002), vec2(0.998));
    vec3 h = texture(uHist2, uv).rgb;
    float w = historyWeight(cur, h, uStrength * 0.78);
    acc += h * w; sumW += w;
  }

  outColor = vec4(acc / sumW, 1.0);
}
`;

export const FINAL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform sampler2D uMv;
uniform vec2 uResolution;
uniform float uSharpen;
uniform float uDenoise;
uniform float uShowMv;

void main() {
  vec3 original = texture(uTexture, vUv).rgb;
  vec2 px = 1.0 / uResolution;

  // Small edge-preserving cleanup after temporal stacking. It suppresses
  // residual color speckle without averaging across ring/body edges.
  vec3 acc = original * 2.2;
  float weightSum = 2.2;
  for (int ox = -1; ox <= 1; ox++) {
    for (int oy = -1; oy <= 1; oy++) {
      if (ox == 0 && oy == 0) continue;
      vec3 q = texture(uTexture, vUv + vec2(float(ox), float(oy)) * px).rgb;
      float colorWeight = exp(-dot(q - original, q - original) * 20.0);
      float w = 0.72 * colorWeight;
      acc += q * w;
      weightSum += w;
    }
  }
  vec3 c = mix(original, acc / weightSum, clamp(uDenoise, 0.0, 0.72));

  vec3 blur =
    texture(uTexture, vUv + vec2(px.x, 0.0)).rgb +
    texture(uTexture, vUv - vec2(px.x, 0.0)).rgb +
    texture(uTexture, vUv + vec2(0.0, px.y)).rgb +
    texture(uTexture, vUv - vec2(0.0, px.y)).rgb;
  blur *= 0.25;
  vec3 high = c - blur;
  c = clamp(c + high * uSharpen * 1.35, 0.0, 1.0);

  if (uShowMv > 0.5) {
    vec2 mv = texture(uMv, vUv).rg * 2.0 - 1.0;
    float mag = length(mv);
    c += vec3(mag * 0.9, abs(mv.x) * 0.25, abs(mv.y) * 0.8);
    // Block grid makes the local alignment tiles visible.
    vec2 blockUv = fract(gl_FragCoord.xy / 8.0);
    float grid = max(step(0.94, blockUv.x), step(0.94, blockUv.y));
    c = mix(c, vec3(1.0, 0.2, 0.1), grid * 0.55);
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
